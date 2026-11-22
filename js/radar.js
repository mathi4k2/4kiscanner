/* 4kiscan · radar.js
 * Radar de destino: busca en la wallet receptora una transferencia entrante que
 * corresponda a la operación de origen (mismo activo con 97–100 % del monto, o
 * activo distinto con valor USD histórico entre 85 % y 98 %). Primero la red
 * elegida y luego las demás. Depende de util.js, data.js y rpc.js (API inyectada).
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const { RpcError, PriceError } = K;

  const RADAR_WINDOWS = [
    ["1 min", 60],
    ["5 min", 5 * 60],
    ["30 min", 30 * 60],
    ["4 h", 4 * 3600],
    ["48 h", 48 * 3600],
  ];
  const MAX_PAGES_PER_WINDOW = 5;
  const MIN_RECEIVED_PERCENT = 97n;
  const SWAP_MIN_PERCENT = 85;
  const SWAP_MAX_PERCENT = 98;
  const MAX_CANDIDATES = 25;
  const lower = (v) => String(v == null ? "" : v).toLowerCase();

  // ───────────── Bloques y tiempo ─────────────
  function parseTransferTimestamp(transfer) {
    const raw = transfer && transfer.metadata ? transfer.metadata.blockTimestamp : null;
    if (typeof raw !== "string" || !raw.trim()) return null;
    const ms = Date.parse(raw.trim());
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  async function estimateAverageBlockTime(api, chain, latestNumber, latestTimestamp) {
    const fallback = K.CHAINS[chain].averageBlockTime;
    const sampleCount = Math.max(1, Math.floor(RADAR_WINDOWS[RADAR_WINDOWS.length - 1][1] / fallback));
    const sampleNumber = Math.max(0, latestNumber - sampleCount);
    if (sampleNumber === latestNumber) return { seconds: fallback, source: "estimación de referencia de la red" };
    let sampleTimestamp;
    try {
      sampleTimestamp = await api.blockTimestamp(chain, sampleNumber);
    } catch (error) {
      return { seconds: fallback, source: "estimación de referencia (no se pudo leer un bloque histórico)" };
    }
    const blocks = latestNumber - sampleNumber;
    const seconds = latestTimestamp - sampleTimestamp;
    if (blocks <= 0 || seconds <= 0) return { seconds: fallback, source: "estimación de referencia (muestra de bloques inválida)" };
    return { seconds: seconds / blocks, source: "promedio observado en las últimas ~48 horas" };
  }

  function approximateBlockForTimestamp(target, latestNumber, latestTimestamp, avgBlockTime) {
    if (target > latestTimestamp) return latestNumber + 1;
    const blocksAgo = Math.round((latestTimestamp - target) / avgBlockTime);
    return Math.max(0, Math.min(latestNumber, latestNumber - blocksAgo));
  }

  function transferCategories(chain) {
    const categories = ["external", "erc20", "erc721", "erc1155", "specialnft"];
    if (K.CHAINS[chain].internalTransfers) categories.splice(1, 0, "internal");
    return categories;
  }

  // ───────────── Activos ─────────────
  function normalizeAssetLabel(value) {
    if (typeof value !== "string") return null;
    let n = value.replace(/₮/g, "T").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (n.startsWith("BRIDGED")) n = n.slice("BRIDGED".length);
    const aliases = { USDT0: "USDT", TETHERUSD: "USDT", USDCOIN: "USDC" };
    n = aliases[n] || n;
    return n || null;
  }
  function assetLabels(asset) {
    const labels = new Set();
    const address = asset.tokenAddress;
    for (const field of ["symbol", "name"]) {
      const label = asset[field];
      if (typeof label !== "string") continue;
      if (typeof address === "string" && label.toLowerCase() === address.toLowerCase()) continue;
      const n = normalizeAssetLabel(label);
      if (n) labels.add(n);
    }
    return labels;
  }
  const intersects = (a, b) => [...a].some((x) => b.has(x));

  function toBigInt(value) {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
    return null;
  }
  function parseDecimals(raw) {
    if (typeof raw === "number" && Number.isInteger(raw)) return raw >= 0 && raw <= 255 ? raw : null;
    if (typeof raw === "string") {
      const n = /^0x/i.test(raw) ? parseInt(raw, 16) : /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
      return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
    }
    return null;
  }

  /** Normaliza una transferencia de alchemy_getAssetTransfers a un activo comparable. */
  async function parseDestinationAsset(api, transfer, chain) {
    const rawContract = transfer.rawContract && typeof transfer.rawContract === "object" ? transfer.rawContract : {};
    const tokenAddress = typeof rawContract.address === "string" && K.ADDRESS_RE.test(rawContract.address) ? rawContract.address.toLowerCase() : null;
    const category = lower(transfer.category);
    if (tokenAddress === null && category !== "external" && category !== "internal") return null;
    const amountRaw = toBigInt(rawContract.value);
    if (amountRaw === null || amountRaw < 0n) return null;

    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const id = K.tokenIdentity(chain, tokenAddress, nativeSymbol);
    let decimals = id.decimals;
    if (decimals === null) decimals = parseDecimals(rawContract.decimal != null ? rawContract.decimal : rawContract.decimals);

    let symbol = id.symbol;
    let name = typeof transfer.name === "string" ? transfer.name : null;
    if (tokenAddress !== null && symbol === tokenAddress && typeof transfer.asset === "string" && transfer.asset) symbol = transfer.asset;
    if (tokenAddress !== null && !id.known) {
      const labels = await api.tokenLabels(chain, tokenAddress);
      if (labels.symbol && symbol === tokenAddress) symbol = labels.symbol;
      if (!name || !name.trim()) name = labels.name;
    }
    return {
      assetId: id.assetId,
      symbol,
      name,
      tokenAddress,
      amountRaw,
      decimals,
      amount: K.formatUnits(amountRaw, decimals),
      variant: id.variant,
    };
  }

  function assetAmountNumber(asset) {
    if (typeof asset.amountRaw !== "bigint" || asset.amountRaw <= 0n) return null;
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) return null;
    return Number(K.formatUnits(asset.amountRaw, asset.decimals));
  }

  /** Mismo activo lógico, monto recibido entre 97 % y 100 % del enviado. */
  function findFeeTolerantAssetMatch(originAssets, destAsset) {
    for (const origin of originAssets) {
      const sameId = origin.assetId === destAsset.assetId;
      const shared = [...assetLabels(origin)].filter((l) => assetLabels(destAsset).has(l));
      if (!sameId && !shared.length) continue;
      if (typeof origin.amountRaw !== "bigint" || typeof destAsset.amountRaw !== "bigint") continue;
      if (!Number.isInteger(origin.decimals) || !Number.isInteger(destAsset.decimals)) continue;
      if (origin.amountRaw <= 0n || destAsset.amountRaw <= 0n) continue;
      const common = Math.max(origin.decimals, destAsset.decimals);
      const o = origin.amountRaw * 10n ** BigInt(common - origin.decimals);
      const d = destAsset.amountRaw * 10n ** BigInt(common - destAsset.decimals);
      if (d > o) continue;
      if (d * 100n < o * MIN_RECEIVED_PERCENT) continue;
      const scaled = ((o - d) * 100n * 1000000n * 2n + o) / (2n * o); // redondeo a 6 decimales
      const feePercent = K.formatUnits(scaled, 6);
      return {
        originAsset: origin,
        originAmount: K.formatUnits(origin.amountRaw, origin.decimals),
        destinationAmount: K.formatUnits(destAsset.amountRaw, destAsset.decimals),
        feePercent,
        assetId: origin.assetId,
        symbol: shared.length ? shared.sort()[0] : origin.symbol || "Activo",
      };
    }
    return null;
  }

  // ───────────── Precios (swap) ─────────────
  function coinId(chain, asset) {
    const chainId = K.CHAINS[chain] && K.CHAINS[chain].defillamaId;
    if (!chainId) return null;
    if (asset.tokenAddress == null) return K.CHAINS[chain].nativeCoin;
    return K.ADDRESS_RE.test(asset.tokenAddress) ? `${chainId}:${asset.tokenAddress.toLowerCase()}` : null;
  }
  async function compareHistoricalUsd(api, originAsset, destAsset, originChain, destChain, originTs, destTs) {
    const oAmount = assetAmountNumber(originAsset);
    const dAmount = assetAmountNumber(destAsset);
    const oCoin = coinId(originChain, originAsset);
    const dCoin = coinId(destChain, destAsset);
    if (oAmount === null || dAmount === null || !oCoin || !dCoin) return null;
    const [oPrice, dPrice] = await Promise.all([api.historicalPrice(originTs, oCoin), api.historicalPrice(destTs, dCoin)]);
    if (oPrice === null || dPrice === null) return null;
    const originUsd = oAmount * oPrice;
    const destinationUsd = dAmount * dPrice;
    if (!(originUsd > 0) || !(destinationUsd > 0)) return null;
    return { originUsd, destinationUsd, efficiencyPercent: (destinationUsd * 100) / originUsd };
  }

  /** Activo distinto con valor USD histórico entre 85 % y 98 %. Lanza PriceError si no hubo precio. */
  async function findUsdSwapMatch(api, originAssets, candidates, originChain, destChain, originTs) {
    let priceUnavailable = false;
    for (const candidate of candidates) {
      const destAsset = candidate.destinationAsset;
      if (!destAsset || !Number.isInteger(candidate.timestamp)) continue;
      const candidateChain = candidate.candidateChain || destChain;
      if (assetAmountNumber(destAsset) === null || !coinId(candidateChain, destAsset)) continue;
      for (const origin of originAssets) {
        if (origin.assetId === destAsset.assetId) continue;
        if (intersects(assetLabels(origin), assetLabels(destAsset))) continue;
        if (assetAmountNumber(origin) === null || !coinId(originChain, origin)) continue;
        const cmp = await compareHistoricalUsd(api, origin, destAsset, originChain, candidateChain, originTs, candidate.timestamp);
        if (cmp === null) {
          priceUnavailable = true;
          continue;
        }
        if (cmp.efficiencyPercent < SWAP_MIN_PERCENT || cmp.efficiencyPercent > SWAP_MAX_PERCENT) continue;
        const originSymbol = String(origin.symbol || "Activo desconocido");
        const destSymbol = String(destAsset.symbol || "Activo desconocido");
        return {
          ...candidate,
          matchType: "swap",
          matchedOriginAsset: origin,
          originAmount: K.formatUnits(origin.amountRaw, origin.decimals),
          destinationAmount: K.formatUnits(destAsset.amountRaw, destAsset.decimals),
          originSymbol,
          destinationSymbol: destSymbol,
          matchedAsset: `${originSymbol} → ${destSymbol}`,
          originUsd: cmp.originUsd,
          destinationUsd: cmp.destinationUsd,
          originValueUsd: cmp.originUsd.toFixed(2),
          destinationValueUsd: cmp.destinationUsd.toFixed(2),
          efficiencyPercent: cmp.efficiencyPercent.toFixed(2),
        };
      }
    }
    if (priceUnavailable) throw new PriceError("DefiLlama no devolvió un precio histórico en USD para uno o más activos candidatos.");
    return null;
  }

  // ───────────── Radar en una red ─────────────
  async function scanDestinationRadar(api, opts) {
    const { destChain, originTimestamp, originChain } = opts;
    const originAssets = opts.originAssets || [];
    const wallet = lower(opts.wallet);
    const latest = await api.latestBlock(destChain);
    const avg = await estimateAverageBlockTime(api, destChain, latest.number, latest.timestamp);
    const averageBlockTime = avg.seconds > 0 ? avg.seconds : K.CHAINS[destChain].averageBlockTime;
    const lastWindowSeconds = RADAR_WINDOWS[RADAR_WINDOWS.length - 1][1];

    const result = {
      state: "not_found",
      transfer: null,
      candidates: [],
      windows: [],
      latestTimestamp: latest.timestamp,
      searchedThrough: Math.min(latest.timestamp, originTimestamp + lastWindowSeconds),
      full48hAvailable: latest.timestamp >= originTimestamp + lastWindowSeconds,
      averageBlockTime,
      estimateSource: avg.source,
      partial: false,
      swapMatchingEnabled: true,
    };
    if (latest.timestamp < originTimestamp) {
      result.state = "waiting_for_destination_chain";
      return result;
    }

    const categories = transferCategories(destChain);
    const candidateIds = new Set();
    let priorEnd = 0;
    let lastPageKey = null;

    for (const [windowName, windowSeconds] of RADAR_WINDOWS) {
      let windowStart = originTimestamp + priorEnd;
      if (priorEnd) windowStart += 1;
      const windowEnd = originTimestamp + windowSeconds;
      priorEnd = windowSeconds;
      if (windowStart > latest.timestamp) {
        result.windows.push({ name: windowName, state: "not_reached", transfersChecked: 0 });
        continue;
      }
      const effectiveEnd = Math.min(windowEnd, latest.timestamp);
      const startBlock = approximateBlockForTimestamp(windowStart, latest.number, latest.timestamp, averageBlockTime);
      const endBlock = approximateBlockForTimestamp(effectiveEnd, latest.number, latest.timestamp, averageBlockTime);
      const padding = Math.max(10, Math.floor(((latest.timestamp - windowStart) / averageBlockTime) * 0.02));
      const fromBlock = Math.max(0, startBlock - padding);
      const toBlock = Math.min(latest.number, endBlock + padding);
      if (fromBlock > toBlock) {
        result.windows.push({ name: windowName, state: "not_reached", transfersChecked: 0 });
        continue;
      }

      let pageKey = null;
      let pagesRead = 0;
      let checked = 0;
      let found = null;
      let windowCandidates = 0;
      while (pagesRead < MAX_PAGES_PER_WINDOW) {
        const filter = {
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
          toAddress: wallet,
          category: categories,
          excludeZeroValue: true,
          withMetadata: true,
          order: "asc",
          maxCount: "0x3e8",
        };
        if (pageKey) filter.pageKey = pageKey;
        const response = await api.assetTransfers(destChain, filter);
        const transfers = response.transfers || [];
        pagesRead++;
        checked += transfers.length;

        for (const transfer of transfers) {
          if (!transfer || typeof transfer !== "object") continue;
          const recipient = transfer.to;
          if (typeof recipient !== "string" || recipient.toLowerCase() !== wallet) continue;
          let timestamp = parseTransferTimestamp(transfer);
          if (timestamp === null) {
            try {
              timestamp = await api.blockTimestamp(destChain, transfer.blockNum);
            } catch (error) {
              continue;
            }
          }
          if (timestamp < windowStart || timestamp > effectiveEnd) continue;

          const destAsset = await parseDestinationAsset(api, transfer, destChain);
          let blockInt = null;
          try {
            blockInt = K.hexToInt(transfer.blockNum, "transfer.blockNum");
          } catch (error) {
            blockInt = null;
          }
          const item = {
            hash: transfer.hash || null,
            from: transfer.from || null,
            to: recipient,
            asset: destAsset ? destAsset.symbol : transfer.asset || "Activo sin identificar",
            value: destAsset ? destAsset.amount : transfer.value,
            category: transfer.category,
            blockNumber: transfer.blockNum,
            blockNumberInt: blockInt,
            timestamp,
            rawContract: transfer.rawContract || null,
            destinationAsset: destAsset,
            candidateChain: destChain,
          };
          const match = destAsset ? findFeeTolerantAssetMatch(originAssets, destAsset) : null;
          if (match) {
            Object.assign(item, {
              matchedOriginAsset: match.originAsset,
              originAmount: match.originAmount,
              destinationAmount: match.destinationAmount,
              feePercent: match.feePercent,
              matchedAsset: match.symbol,
              matchType: "same_token",
            });
            found = item;
            break;
          }
          const key = `${item.hash}|${destAsset ? destAsset.assetId : ""}|${destAsset ? destAsset.amountRaw : ""}`;
          if (!candidateIds.has(key)) {
            candidateIds.add(key);
            if (result.candidates.length < MAX_CANDIDATES) {
              result.candidates.push(item);
              windowCandidates++;
            }
          }
        }
        if (found) break;
        pageKey = typeof response.pageKey === "string" && response.pageKey.trim() ? response.pageKey.trim() : null;
        if (pageKey === null) break;
      }
      lastPageKey = pageKey;
      result.windows.push({
        name: windowName,
        state: found ? "found" : windowCandidates ? "candidates" : "searched",
        fromBlock,
        toBlock,
        transfersChecked: checked,
      });
      if (found) {
        result.state = "found";
        result.transfer = found;
        result.matchType = "same_token";
        return result;
      }
      if (pageKey !== null && pagesRead >= MAX_PAGES_PER_WINDOW) result.partial = true;
    }
    void lastPageKey;

    if (result.candidates.length) {
      try {
        const swap = await findUsdSwapMatch(api, originAssets, result.candidates, originChain, destChain, originTimestamp);
        if (swap) {
          result.state = "found";
          result.transfer = swap;
          result.matchType = "swap";
          return result;
        }
      } catch (error) {
        if (!(error instanceof PriceError)) throw error;
        result.swapError = error.message;
      }
    }
    if (result.partial) result.state = "incomplete";
    else if (result.candidates.length) result.state = "candidates";
    else if (result.windows.every((w) => w.state === "not_reached")) result.state = "waiting_for_destination_chain";
    return result;
  }

  const sumChecked = (r) => (r.windows || []).reduce((n, w) => n + (w.transfersChecked || 0), 0);

  /**
   * Busca primero en la red elegida y después en las demás redes soportadas.
   * Con `exhaustive` (búsqueda sin transacción de origen) recorre todas las redes
   * aunque ya haya un acierto, para informar si hay coincidencias en varias.
   */
  async function scanWithFallback(api, opts) {
    const { primaryChain, originChain, wallet, originTimestamp, originAssets } = opts;
    const exhaustive = !!opts.exhaustive;
    const searches = [];
    let primary = null;
    const scan = (destChain) => scanDestinationRadar(api, { destChain, wallet, originTimestamp, originAssets, originChain });
    const summary = (chain, r) => ({ chain, state: r.state, transfersChecked: sumChecked(r), full48hAvailable: r.full48hAvailable });

    try {
      primary = await scan(primaryChain);
      searches.push(summary(primaryChain, primary));
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      searches.push({ chain: primaryChain, state: "error", error: error.message, transfersChecked: 0 });
    }
    if (primary && primary.state === "found" && !exhaustive) {
      return Object.assign(primary, {
        primaryChain,
        matchedChain: primaryChain,
        fallbackMatch: false,
        fallbackSearches: searches,
        globalSearchState: "primary_match",
        searchedNetworks: searches.map((s) => s.chain),
      });
    }

    const fallbackResults = [];
    const found = primary && primary.state === "found" ? [{ chain: primaryChain, result: primary }] : [];
    for (const chain of Object.keys(K.CHAINS)) {
      if (chain === originChain || chain === primaryChain) continue;
      let r;
      try {
        r = await scan(chain);
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        searches.push({ chain, state: "error", error: error.message, transfersChecked: 0 });
        continue;
      }
      r.searchChain = chain;
      fallbackResults.push(r);
      searches.push(summary(chain, r));
      if (r.state === "found") {
        found.push({ chain, result: r });
        if (!exhaustive) break;
      }
    }

    if (found.length) {
      const winner = found[0];
      return Object.assign(winner.result, {
        primaryChain,
        matchedChain: winner.chain,
        fallbackMatch: winner.chain !== primaryChain,
        fallbackSearches: searches,
        globalSearchState: winner.chain === primaryChain ? "primary_match" : "fallback_match",
        primaryState: primary ? primary.state : "error",
        primaryError: searches[0].state === "error" ? searches[0].error : null,
        searchedNetworks: searches.map((s) => s.chain),
        allMatches: found.map((f) => ({ chain: f.chain, transfer: f.result.transfer })),
      });
    }

    // Un negativo global exige búsquedas completas en todas las redes consultadas.
    const complete = new Set(["not_found", "candidates"]);
    const globalState = searches.every((s) => complete.has(s.state)) ? "no_match_global" : "fallback_incomplete";
    const result = { ...(primary || { windows: [], candidates: [], transfer: null, swapMatchingEnabled: true }) };
    Object.assign(result, {
      state: globalState,
      primaryChain,
      matchedChain: null,
      fallbackMatch: false,
      fallbackSearches: searches,
      globalSearchState: globalState,
      searchedNetworks: searches.map((s) => s.chain),
    });
    result.candidates = primary ? [...primary.candidates] : [];
    for (const r of fallbackResults) {
      for (const c of r.candidates) {
        if (result.candidates.length < MAX_CANDIDATES) result.candidates.push({ ...c, candidateChain: r.searchChain });
      }
    }
    return result;
  }

  /** Firma posicional usada por evidence.js. Sin red de origen ("") la búsqueda es exhaustiva. */
  function scanDestinationRadarWithFallback(api, primaryChain, originChain, wallet, originTimestamp, originAssets) {
    return scanWithFallback(api, { primaryChain, originChain, wallet, originTimestamp, originAssets, exhaustive: !originChain });
  }

  // ───────────── Referencia en la tx de destino ─────────────
  function payloadContainsHash(payload, hash) {
    if (typeof payload !== "string") return false;
    const p = payload.toLowerCase().replace(/^0x/, "");
    const h = hash.toLowerCase().replace(/^0x/, "");
    return !!h && p.includes(h);
  }

  /** Busca referencias explícitas al origen en la tx de destino (calldata y logs). */
  async function verifyDestinationBridgeReference(api, opts) {
    const { destChain, destinationTxHash, originTxHash, originSender } = opts;
    if (typeof destinationTxHash !== "string" || !K.TX_HASH_RE.test(destinationTxHash)) {
      return { status: "Not checked", detail: "La transferencia de destino no incluyó un hash de transacción válido." };
    }
    let transaction, receipt;
    try {
      ({ transaction, receipt } = await api.getTxAndReceipt(destChain, destinationTxHash));
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      return { status: "Lookup failed", detail: error.message };
    }
    if (!receipt) return { status: "Receipt unavailable", detail: "La transacción de destino todavía no tiene recibo." };

    const logs = Array.isArray(receipt.logs) ? receipt.logs.filter((l) => l && typeof l === "object") : [];
    const input = transaction.input || "";
    const sender = typeof originSender === "string" && K.ADDRESS_RE.test(originSender) ? originSender.toLowerCase() : null;
    // Solo contratos de puente: un router de DEX no vincula origen y destino.
    const bridgeCatalog = Object.fromEntries(Object.entries(K.CATALOG[destChain] || {}).filter(([, e]) => e.category === "bridge"));
    const to = lower(transaction.to);
    const bridgeTarget = Object.prototype.hasOwnProperty.call(bridgeCatalog, to);

    const hashInInput = payloadContainsHash(input, originTxHash);
    const senderInInput = !!sender && K.addressesInHexPayload(input).includes(sender);
    let hashInLogs = false, senderInLogs = false, bridgeHashLog = false, bridgeSenderLog = false;
    for (const log of logs) {
      const payloads = (Array.isArray(log.topics) ? log.topics : []).filter((v) => typeof v === "string");
      if (typeof log.data === "string") payloads.push(log.data);
      const hashMatch = payloads.some((p) => payloadContainsHash(p, originTxHash));
      const senderMatch = !!sender && payloads.some((p) => K.addressesInHexPayload(p).includes(sender));
      hashInLogs = hashInLogs || hashMatch;
      senderInLogs = senderInLogs || senderMatch;
      const emitter = lower(log.address);
      const emitterIsBridge = Object.prototype.hasOwnProperty.call(bridgeCatalog, emitter);
      if (emitterIsBridge && hashMatch) bridgeHashLog = true;
      if (emitterIsBridge && senderMatch) bridgeSenderLog = true;
    }
    const verified = (hashInInput && bridgeTarget) || bridgeHashLog || (senderInInput && bridgeTarget) || bridgeSenderLog;
    const bridgeNames = [
      ...new Set(
        K.identifyBridges(destChain, to, logs, input)
          .filter((m) => m.category === "bridge" && (m.evidence.includes("tx.to") || m.evidence.includes("log.address")))
          .map((m) => m.name)
      ),
    ];
    let status, detail;
    if (verified) {
      status = "Verified Bridge Reference";
      detail = "El hash o el remitente de origen aparece en la llamada a un puente/router del catálogo o en un log emitido por uno.";
    } else if (hashInInput || hashInLogs) {
      status = "Origin transaction hash referenced";
      detail = "El hash de origen aparece en la llamada o en los logs de destino, pero no se verificó una referencia vinculante de un puente/router del catálogo.";
    } else if (senderInInput || senderInLogs) {
      status = "Sender wallet referenced (unverified)";
      detail = "La dirección remitente de origen aparece en la llamada o en los logs de destino; por sí sola no demuestra un vínculo de puente.";
    } else {
      status = "No explicit origin reference found";
      detail = "No se encontró el hash de origen ni al remitente de origen en la llamada o los logs de la transacción de destino.";
    }
    return {
      status,
      detail,
      originHashInInput: hashInInput,
      originHashInLogs: hashInLogs,
      originSenderInInput: senderInInput,
      originSenderInLogs: senderInLogs,
      bridgeSenderLogMatch: bridgeSenderLog,
      bridgeNames,
    };
  }

  // ───────────── Clasificación de la operación ─────────────
  function classifyOperation(result) {
    const sourceChain = String(result.chain || "Desconocida");
    const radar = result.radar;
    const destChain = String((radar && radar.matchedChain) || result.destinationChain || "Desconocida");
    const same = sourceChain.toLowerCase() === destChain.toLowerCase();
    const transfer = radar && radar.state === "found" ? radar.transfer : null;

    if (!transfer) {
      const symbols = [...new Set((result.originAssets || []).map((a) => String(a.symbol || a.assetId || "Activo desconocido")))];
      return {
        category: "Operación no confirmada",
        operationType: "Unconfirmed",
        networkRoute: `${sourceChain} → ${destChain}`,
        assetFlow: `${symbols.join(", ") || "Activo desconocido"} → activo de destino sin confirmar`,
        verificationMethod: "Sin transferencia de destino que cumpla los criterios",
        verdict: "Operación de destino no confirmada",
      };
    }
    const matchType = (radar && radar.matchType) || transfer.matchType || "same_token";
    const verifiedRef = radar && radar.referenceCheck && radar.referenceCheck.status === "Verified Bridge Reference";
    let category, operationType, verificationMethod;
    if (matchType === "swap") {
      category = same ? "Swap en la misma red" : "Swap entre redes";
      operationType = same ? "Swap" : "Cross-Chain Swap";
      verificationMethod = "Equivalente en USD histórico (DefiLlama)";
    } else {
      category = same ? "Transferencia en la misma red" : "Puente entre redes";
      operationType = same ? "Transfer" : "Bridge";
      verificationMethod = verifiedRef
        ? "Firma de router de puente"
        : "Coincidencia directa de logs (transferencia indexada: wallet, activo y monto)";
    }
    const oa = transfer.matchedOriginAsset;
    const da = transfer.destinationAsset;
    const originSymbol = transfer.originSymbol || (oa && oa.symbol) || transfer.matchedAsset || "Activo desconocido";
    const destSymbol = transfer.destinationSymbol || (da && da.symbol) || transfer.matchedAsset || "Activo desconocido";
    return {
      category,
      operationType,
      networkRoute: `${sourceChain} → ${destChain}`,
      assetFlow: `${transfer.originAmount} ${originSymbol} → ${transfer.destinationAmount} ${destSymbol}`,
      verificationMethod,
      verdict: `${category} confirmada`,
    };
  }

  // ───────────── Integración: radar + verificaciones + semáforo ─────────────
  const STATUS_BY_TYPE = { Transfer: "SAME_NETWORK_TRANSFER_CONFIRMED", Swap: "SAME_NETWORK_SWAP_CONFIRMED", Bridge: "CROSS_CHAIN_BRIDGE_CONFIRMED", "Cross-Chain Swap": "CROSS_CHAIN_SWAP_CONFIRMED" };

  /**
   * Corre el radar sobre un diagnóstico de origen exitoso y devuelve el diagnóstico
   * actualizado (semáforo, clasificación), el radar y, si no corrió, el motivo.
   * Los errores de red del radar se propagan como RpcError; lo decide quien llama.
   */
  async function analyzeDestination(api, diagnosis) {
    const D = { ...diagnosis };
    if (D.status !== "0x1") return { diagnosis: D, radar: null, skipped: "origin_failed" };
    if (D.blockNumber == null) return { diagnosis: D, radar: null, skipped: "no_block" };

    const originTimestamp = await api.blockTimestamp(D.chain, D.blockNumber);
    const radar = await scanWithFallback(api, {
      primaryChain: D.destinationChain,
      originChain: D.chain,
      wallet: D.destinationWallet,
      originTimestamp,
      originAssets: D.originAssets,
    });
    D.originTimestamp = originTimestamp;

    const matchedChain = radar.matchedChain || D.destinationChain;
    const subject = radar.state === "found" ? radar.transfer : radar.candidates[0] || null;
    if (subject) {
      const subjectChain = subject.candidateChain || matchedChain;
      const oa = subject.matchedOriginAsset;
      const da = subject.destinationAsset;
      if (oa && da) {
        try {
          const cmp = await compareHistoricalUsd(api, oa, da, D.chain, subjectChain, originTimestamp, subject.timestamp);
          if (cmp) {
            subject.originValueUsd = cmp.originUsd.toFixed(2);
            subject.destinationValueUsd = cmp.destinationUsd.toFixed(2);
            subject.efficiencyPercent = cmp.efficiencyPercent.toFixed(2);
          } else if (!radar.priceError) {
            radar.priceError = "DefiLlama no devolvió un precio histórico para el activo de origen o de destino.";
          }
        } catch (error) {
          if (!(error instanceof PriceError)) throw error;
          radar.priceError = error.message;
        }
      }
      radar.referenceCheck = await verifyDestinationBridgeReference(api, {
        destChain: subjectChain,
        destinationTxHash: subject.hash,
        originTxHash: D.txHash,
        originSender: D.transaction ? D.transaction.from : D.from,
      });
      subject.referenceCheck = radar.referenceCheck;
    }

    const wanted = D.destinationChain;
    if (radar.state === "found") {
      const t = radar.transfer;
      const classification = classifyOperation({ chain: D.chain, destinationChain: wanted, originAssets: D.originAssets, radar });
      D.operationClassification = classification;
      if (radar.fallbackMatch) {
        D.color = "yellow";
        D.indicator = "🟡";
        D.title = "Coincidencia en otra red (búsqueda de respaldo)";
        D.statusCode = "CROSS_NETWORK_FALLBACK_MATCH";
        D.notes =
          radar.primaryState === "error"
            ? `La búsqueda en ${wanted} no pudo completarse, pero se detectó una transferencia compatible hacia la wallet en ${matchedChain}.`
            : `No se encontró la liquidación en ${wanted}, pero se detectó una transferencia compatible hacia la wallet en ${matchedChain}.`;
      } else {
        D.color = "green";
        D.indicator = "🟢";
        D.title = classification.verdict;
        D.statusCode = STATUS_BY_TYPE[classification.operationType] || "CROSS_CHAIN_SWAP_CONFIRMED";
        D.notes =
          radar.matchType === "swap"
            ? `Transferencia de otro token compatible por valor USD histórico: US$${t.destinationValueUsd} recibidos frente a US$${t.originValueUsd} enviados (${t.efficiencyPercent} % de eficiencia).`
            : `El radar encontró una transferencia entrante compatible hacia la wallet en ${matchedChain}: ${t.destinationAmount} ${t.matchedAsset} recibidos de ${t.originAmount} enviados en el origen. Variación estimada: ${t.feePercent} %.`;
      }
    } else if (radar.state === "no_match_global") {
      D.color = "red";
      D.indicator = "🔴";
      D.title = "Sin coincidencia en ninguna red";
      D.statusCode = "NO_MATCH_GLOBAL";
      D.notes =
        "La wallet no recibió fondos compatibles en la red elegida ni en las demás redes soportadas dentro de las ventanas de tiempo revisadas." +
        (radar.candidates.length ? ` Se observaron ${radar.candidates.length} transferencia(s) entrante(s) que no cumplen el criterio de activo y monto; quedan listadas como referencia.` : "");
    } else if (radar.state === "fallback_incomplete") {
      D.color = "yellow";
      D.indicator = "🟡";
      D.title = "Búsqueda global incompleta";
      D.statusCode = "GLOBAL_SEARCH_INCOMPLETE";
      D.notes = "No se confirmó ninguna coincidencia, pero la búsqueda no pudo completarse en todas las redes soportadas.";
    } else if ((radar.state === "candidates" || radar.state === "incomplete") && radar.candidates.length) {
      D.color = "yellow";
      D.indicator = "🟡";
      D.title = `Origen exitoso; hay entradas ${wanted === D.chain ? "en la misma red" : "en otra red"} sin coincidencia verificada de activo/monto`;
      D.statusCode = "DESTINATION_CANDIDATES_UNVERIFIED";
      D.notes = "Se encontraron transferencias entrantes a la wallet, pero ninguna cumple el rango de monto del mismo token ni el rango de valor USD de otro token. La operación no está confirmada.";
    }
    return { diagnosis: D, radar, skipped: null };
  }

  Object.assign(K, {
    RADAR_WINDOWS,
    parseTransferTimestamp,
    estimateAverageBlockTime,
    approximateBlockForTimestamp,
    transferCategories,
    normalizeAssetLabel,
    assetLabels,
    parseDestinationAsset,
    findFeeTolerantAssetMatch,
    findUsdSwapMatch,
    compareHistoricalUsd,
    scanDestinationRadar,
    scanWithFallback,
    scanDestinationRadarWithFallback,
    analyzeDestination,
    verifyDestinationBridgeReference,
    classifyOperation,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
