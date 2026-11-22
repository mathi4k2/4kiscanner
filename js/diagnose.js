/* 4kiscan · diagnose.js
 * Diagnóstico de la transacción de ORIGEN: estado, activos movidos, puentes/DEX
 * detectados y un detector de errores comunes de usuario (red equivocada, envío
 * al contrato del token, address poisoning, wallet de contrato inexistente en la
 * red destino, solo approve, etc.). Depende de util.js y data.js.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const { RpcError } = K;

  const SEVERITY_RANK = { critical: 0, error: 1, warn: 2, info: 3, ok: 4 };
  const lower = (v) => String(v == null ? "" : v).toLowerCase();

  // ───────────── Tokens ─────────────
  function tokenIdentity(chain, tokenAddress, nativeSymbol) {
    if (tokenAddress == null) {
      const symbol = String(nativeSymbol).toUpperCase();
      return { assetId: `native:${symbol}`, symbol, decimals: 18, variant: null, known: true };
    }
    const address = lower(tokenAddress);
    for (const [assetId, deployments] of Object.entries(K.TOKEN_GROUPS)) {
      const tokens = deployments[chain] || {};
      if (Object.prototype.hasOwnProperty.call(tokens, address)) {
        return {
          assetId,
          symbol: assetId,
          decimals: tokens[address],
          variant: K.TOKEN_VARIANTS[`${chain}:${address}`] || null,
          known: true,
        };
      }
    }
    return { assetId: address, symbol: address, decimals: null, variant: null, known: false };
  }

  function isKnownTokenAddress(address) {
    const a = lower(address);
    return Object.values(K.TOKEN_GROUPS).some((byChain) =>
      Object.values(byChain).some((tokens) => Object.prototype.hasOwnProperty.call(tokens, a))
    );
  }

  // ───────────── Logs ─────────────
  function analyzeTransferLogs(logs, wallet) {
    const transfers = [];
    const matching = [];
    const expected = wallet ? lower(wallet) : null;
    for (const log of logs) {
      if (!log || typeof log !== "object") continue;
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 3 || lower(topics[0]) !== K.TRANSFER_TOPIC) continue;
      const from = K.addressFromTopic(topics[1]);
      const to = K.addressFromTopic(topics[2]);
      const isNft = topics.length >= 4; // ERC-721: tokenId indexado
      let amountRaw = null;
      if (!isNft) {
        try {
          amountRaw = K.hexToBigInt(typeof log.data === "string" ? log.data : "0x0", "data");
        } catch (error) {
          amountRaw = null;
        }
      }
      const transfer = {
        tokenContract: lower(log.address),
        from,
        to,
        amountRaw,
        isNft,
        tokenId: isNft ? topics[3] : null,
        transactionHash: log.transactionHash || null,
      };
      transfers.push(transfer);
      if (!isNft && from !== null && expected && to === expected && amountRaw !== null && amountRaw > 0n) {
        matching.push(transfer);
      }
    }
    return { transfers, matching };
  }

  // ───────────── Puentes / DEX ─────────────
  function identifyBridges(chain, transactionTo, logs, transactionInput) {
    const catalog = K.CATALOG[chain] || {};
    const evidence = new Map();
    const add = (address, source) => {
      const a = lower(address);
      if (!Object.prototype.hasOwnProperty.call(catalog, a)) return;
      if (!evidence.has(a)) evidence.set(a, []);
      if (!evidence.get(a).includes(source)) evidence.get(a).push(source);
    };
    if (transactionTo) add(transactionTo, "tx.to");
    for (const address of K.addressesInHexPayload(transactionInput)) add(address, "tx.input");
    for (const log of logs) {
      if (!log || typeof log !== "object") continue;
      const emitter = lower(log.address);
      if (K.ADDRESS_RE.test(emitter)) add(emitter, "log.address");
      if (Array.isArray(log.topics)) {
        for (const topic of log.topics) for (const a of K.addressesInHexPayload(topic)) add(a, "log.topic");
      }
      for (const a of K.addressesInHexPayload(log.data)) add(a, "log.data");
    }
    return [...evidence.entries()].map(([address, sources]) => ({
      ...catalog[address],
      address,
      evidence: sources,
    }));
  }

  // ───────────── Llamada de la transacción ─────────────
  const KNOWN_SELECTORS = {
    "0xa9059cbb": "transfer(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0xd0e30db0": "deposit()",
    "0x2e1a7d4d": "withdraw(uint256)",
  };
  function describeCall(tx) {
    if (!tx.to) return { kind: "deploy", selector: null, name: "Creación de contrato" };
    const input = lower(typeof tx.input === "string" ? tx.input : "0x");
    if (input === "0x" || input === "") return { kind: "native", selector: null, name: "Transferencia nativa" };
    const selector = input.slice(0, 10);
    const name = KNOWN_SELECTORS[selector] || null;
    const word = (i) => (input.length >= 10 + 64 * (i + 1) ? input.slice(10 + 64 * i, 10 + 64 * (i + 1)) : null);
    const address = (i) => {
      const w = word(i);
      return w && /^0{24}[0-9a-f]{40}$/.test(w) ? "0x" + w.slice(24) : null;
    };
    const amount = (i) => {
      const w = word(i);
      return w ? BigInt("0x" + w) : null;
    };
    if (selector === "0xa9059cbb") return { kind: "erc20_transfer", selector, name, recipient: address(0), amountRaw: amount(1) };
    if (selector === "0x23b872dd") {
      return { kind: "erc20_transfer_from", selector, name, sender: address(0), recipient: address(1), amountRaw: amount(2) };
    }
    if (selector === "0x095ea7b3") return { kind: "approve", selector, name, spender: address(0), amountRaw: amount(1) };
    return { kind: "contract_call", selector, name };
  }

  // ───────────── Activos de origen ─────────────
  async function extractOriginAssets(api, chain, tx, logs, bridgeMatches) {
    const assets = [];
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const nativeValue = K.hexToBigInt(tx.value || "0x0", "value");
    if (nativeValue > 0n) {
      const id = tokenIdentity(chain, null, nativeSymbol);
      assets.push({
        assetId: id.assetId,
        symbol: id.symbol,
        name: null,
        tokenAddress: null,
        amountRaw: nativeValue,
        decimals: 18,
        amount: K.formatUnits(nativeValue, 18),
        known: true,
        variant: null,
        evidence: "transaction.value",
      });
    }

    const { transfers } = analyzeTransferLogs(logs, null);
    const from = lower(tx.from);
    const to = lower(tx.to);
    const bridgeAddresses = new Set(bridgeMatches.map((m) => m.address));
    const usable = transfers.filter((t) => !t.isNft && t.amountRaw !== null && t.amountRaw > 0n && K.ADDRESS_RE.test(t.tokenContract));
    let relevant = usable.filter((t) => t.from === from || (to && t.to === to) || bridgeAddresses.has(t.to));
    if (!relevant.length) relevant = usable;

    // Metadatos (decimales / símbolo) una sola vez por token
    const metadata = new Map();
    await Promise.all(
      [...new Set(relevant.map((t) => t.tokenContract))].map(async (token) => {
        const id = tokenIdentity(chain, token, nativeSymbol);
        let decimals = id.decimals;
        let symbol = id.symbol;
        let name = null;
        if (decimals === null) decimals = await api.tokenDecimals(chain, token);
        if (!id.known) {
          const labels = await api.tokenLabels(chain, token);
          if (labels.symbol) symbol = labels.symbol;
          name = labels.name;
        }
        metadata.set(token, { id, decimals, symbol, name });
      })
    );

    const seen = new Set();
    for (const t of relevant) {
      const key = `${t.tokenContract}|${t.amountRaw}|${t.from}|${t.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = metadata.get(t.tokenContract);
      assets.push({
        assetId: meta.id.assetId,
        symbol: meta.symbol,
        name: meta.name,
        tokenAddress: t.tokenContract,
        amountRaw: t.amountRaw,
        decimals: meta.decimals,
        amount: K.formatUnits(t.amountRaw, meta.decimals),
        known: meta.id.known,
        variant: meta.id.variant,
        from: t.from,
        to: t.to,
        evidence: "evento Transfer del recibo",
      });
    }
    return assets;
  }

  // ───────────── Detector de problemas ─────────────
  async function safe(promise) {
    try {
      return await promise;
    } catch (error) {
      return null;
    }
  }
  const hasCode = (code) => typeof code === "string" && code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code); // EIP-7702 = cuenta normal
  const isDelegated = (code) => typeof code === "string" && /^0xef0100[0-9a-f]{40}$/i.test(code);

  /** Intenta reproducir la transacción fallida un bloque antes para obtener el motivo. */
  async function replayRevertReason(api, chain, tx, blockNumber) {
    if (!tx.to || blockNumber == null || blockNumber < 1) return null;
    const call = { from: tx.from, to: tx.to, data: tx.input || "0x" };
    if (tx.value && tx.value !== "0x0") call.value = tx.value;
    try {
      await api.ethCall(chain, call, "0x" + (blockNumber - 1).toString(16));
      return null; // el estado cambió; no se reproduce el fallo
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== "revert") return null;
      const decoded = K.decodeRevertData(error.data);
      if (decoded && decoded.kind === "error" && decoded.message) return decoded.message;
      if (decoded && decoded.kind === "panic") return `pánico: ${decoded.message}`;
      if (decoded && decoded.kind === "custom") return `error personalizado del contrato (${decoded.selector})`;
      const m = String(error.message).match(/execution reverted:?\s*(.*)$/i);
      return m && m[1] ? m[1] : null;
    }
  }

  async function findIssues(api, c) {
    const issues = [];
    const add = (severity, id, title, detail, action) =>
      issues.push({ id, severity, title, detail, action: action || null });
    const { chain, destChain, wallet, tx, to, from, call, status, logs, transfers, assets, bridgeMatches } = c;
    const crossChain = destChain !== chain;
    const catalogTarget = to ? K.CATALOG[chain][to] || null : null;
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const hasWallet = K.ADDRESS_RE.test(wallet); // sin wallet esperada no se puede comparar el receptor

    // 1) Estado de la transacción
    if (status === "pending") {
      const txNonce = K.hexToInt(tx.nonce || "0x0", "nonce");
      const currentNonce = await safe(api.getNonce(chain, from));
      if (currentNonce !== null && currentNonce > txNonce) {
        add(
          "error",
          "origin_replaced",
          "La transacción fue reemplazada o descartada",
          `La cuenta ${K.shortAddress(from)} ya usó el nonce ${txNonce} en otra transacción, así que esta nunca se confirmará. Por esta transacción no salió ningún fondo.`,
          "Busca en el explorador la transacción con ese nonce (puede ser una cancelación o una aceleración con otro hash)."
        );
      } else {
        add(
          "warn",
          "origin_pending",
          "La transacción sigue pendiente",
          "Todavía no está incluida en un bloque. Suele deberse a un gas demasiado bajo o a congestión de la red.",
          "Espera unos minutos; si no avanza, acelérala o cancélala desde la wallet usando el mismo nonce."
        );
      }
      return finish(issues);
    }

    if (status === "0x0") {
      const gasUsed = K.hexToBigInt(c.receipt.gasUsed || "0x0", "gasUsed");
      const gasLimit = K.hexToBigInt(tx.gas || "0x0", "gas");
      const outOfGas = gasLimit > 0n && gasUsed === gasLimit;
      const reason = outOfGas ? null : await replayRevertReason(api, chain, tx, c.blockNumber);
      const fee = c.feePaid ? ` El gas ya consumido (≈ ${c.feePaid}) no se reembolsa, pero los fondos principales no se movieron.` : " Los fondos principales no se movieron.";
      add(
        "error",
        "origin_failed",
        `La transacción falló en ${chain}`,
        outOfGas
          ? `Se agotó el gas (usó el 100% del límite).${fee}`
          : reason
          ? `El contrato revirtió con el motivo: «${reason}».${fee}`
          : `La ejecución revirtió; no se pudo determinar el motivo exacto.${fee}`,
        outOfGas
          ? "Reintenta con un límite de gas mayor."
          : "Revisa saldo suficiente, permisos (approve) y parámetros como slippage o fecha límite antes de reintentar. Los fondos siguen en la wallet de origen."
      );
      return finish(issues);
    }

    // 2) Destinos peligrosos
    if (to === K.ZERO_ADDRESS || to === K.DEAD_ADDRESS) {
      add("critical", "burn_target", "La transacción se envió a una dirección de quema", `El destino directo es ${to}. Los fondos enviados ahí quedan inaccesibles.`, "Contacta cuanto antes al soporte del servicio con el hash; normalmente no es recuperable.");
    }

    // 3) Aprobación sin envío
    if (call.kind === "approve") {
      add(
        "warn",
        "approval_only",
        "Esta transacción solo otorgó un permiso (approve); no movió fondos",
        `Autorizó a ${call.spender ? K.shortAddress(call.spender) : "un contrato"} a gastar el token ${K.shortAddress(to)}, pero ese gasto se hace en una segunda transacción.`,
        "Completa el paso siguiente (swap, depósito o bridge) en la aplicación. Si no reconoces el permiso, revócalo."
      );
    }

    // 4) Transferencias simples: ¿a quién se envió realmente?
    let recipient = null;
    if (call.kind === "native") recipient = to;
    else if (call.kind === "erc20_transfer" || call.kind === "erc20_transfer_from") recipient = call.recipient;

    if (recipient === K.ZERO_ADDRESS || recipient === K.DEAD_ADDRESS) {
      if (recipient !== to) add("critical", "burn_recipient", "Se envió a una dirección de quema", `El receptor de la transferencia es ${recipient}; los fondos quedaron inaccesibles.`, "Contacta cuanto antes al soporte del servicio con el hash; normalmente no es recuperable.");
    } else if (recipient) {
      const isBridgeTarget = !!K.CATALOG[chain][recipient];
      if (!hasWallet) {
        // sin wallet esperada no se puede juzgar si el receptor es el correcto
      } else if (recipient === wallet) {
        if (crossChain) {
          add(
            "warn",
            "wrong_network_delivery",
            `Los fondos llegaron a tu wallet en ${chain}, no en ${destChain}`,
            `Fue una transferencia directa dentro de ${chain}: no cruzó a ${destChain}. Si buscas el saldo en ${destChain}, no lo vas a encontrar ahí.`,
            `Revisa el saldo de esa wallet seleccionando la red ${chain}. Para llevarlo a ${destChain} necesitas un puente.`
          );
        } else {
          add("ok", "direct_credit", "Transferencia directa al destino esperado", `La transacción envió fondos directamente a la wallet esperada en ${chain}.`);
        }
      } else if (!isBridgeTarget) {
        const sim = K.addressSimilarity(recipient, wallet);
        if (sim.sameEnds) {
          add(
            "critical",
            "address_poisoning",
            "El receptor se parece a tu wallet pero NO es la misma dirección",
            `Se envió a ${recipient}, mientras que la esperada es ${wallet}. Coinciden el inicio y el final pero no el medio: es el patrón típico de «address poisoning» (dirección falsa en el historial) o de un error al copiar.`,
            "No envíes más fondos. Verifica la dirección completa y reporta el caso; los fondos enviados a una dirección ajena normalmente no son recuperables."
          );
        } else if (sim.differing !== undefined && sim.differing <= 6) {
          add(
            "critical",
            "address_typo",
            "El receptor es casi idéntico a tu wallet (posible error de tipeo)",
            `Se envió a ${recipient}; la esperada es ${wallet}. Difieren en solo ${sim.differing} caracteres.`,
            "Compara ambas direcciones carácter por carácter. Si no controlas el receptor, los fondos probablemente no son recuperables."
          );
        } else {
          add(
            "error",
            "recipient_mismatch",
            "El receptor de la transferencia no es la wallet esperada",
            `La transacción envió a ${recipient}, distinta de la wallet esperada (${wallet}). Si el receptor es un exchange o servicio, la acreditación puede depender de ellos.`,
            "Confirma qué dirección se pretendía usar. Si fue un exchange, pide al soporte que busque el depósito con este hash."
          );
        }
      }

      // ¿El receptor es un contrato (p. ej. el propio token)?
      if (recipient !== wallet && !isBridgeTarget) {
        const tokenContract = call.kind === "native" ? null : to;
        if (recipient === tokenContract || isKnownTokenAddress(recipient)) {
          add(
            "critical",
            "sent_to_token_contract",
            "Los tokens se enviaron a la dirección de un contrato de token",
            `El receptor ${K.shortAddress(recipient)} es el contrato de un token, no una wallet. Los contratos de token normalmente no pueden devolver tokens recibidos por error.`,
            "Contacta al equipo del token con el hash; la recuperación solo es posible si el contrato tiene una función de rescate."
          );
        } else {
          const code = await safe(api.getCode(chain, recipient));
          if (hasCode(code)) {
            add(
              "warn",
              "recipient_is_contract",
              "El receptor es un contrato inteligente, no una wallet común",
              `${K.shortAddress(recipient)} tiene código desplegado en ${chain}. Si no es un contrato diseñado para recibir estos fondos (p. ej. una wallet Safe propia), pueden quedar atrapados.`,
              "Revisa en el explorador qué contrato es y si tiene función de retiro."
            );
          }
        }
      }
    }

    // 5) La wallet esperada ¿aparece en la transacción?
    const calldataAddresses = K.addressesInHexPayload(tx.input);
    const logAddresses = new Set();
    for (const log of logs) {
      if (Array.isArray(log.topics)) for (const t of log.topics) K.addressesInHexPayload(t).forEach((a) => logAddresses.add(a));
      K.addressesInHexPayload(log.data).forEach((a) => logAddresses.add(a));
    }
    const walletReferenced = to === wallet || calldataAddresses.includes(wallet) || logAddresses.has(wallet);
    if (hasWallet && from === wallet) {
      add("info", "sender_is_wallet", "El remitente es la misma wallet de destino", "La transacción salió de la propia wallet esperada; revisa que realmente se quisiera enviar a otra red o dirección.");
    }
    if (!recipient) {
      if (hasWallet && walletReferenced && bridgeMatches.length) {
        add("ok", "wallet_encoded", "La wallet esperada aparece codificada en la transacción", "Está en la llamada o en los eventos junto con un contrato de puente/router conocido, lo que respalda que es el destinatario.");
      } else if (hasWallet && !walletReferenced && from !== wallet) {
        add(
          "info",
          "wallet_not_referenced",
          "La wallet esperada no aparece en la transacción de origen",
          "Es normal si el envío salió de un exchange o de un contrato intermediario; si no, verifica que la dirección sea la correcta.",
          "Si hay un exchange de por medio, pide su comprobante de retiro y busca el destino en la red indicada."
        );
      }
    }

    // 6) Wallet de contrato: ¿existe en la red destino?
    if (crossChain && K.ADDRESS_RE.test(wallet)) {
      const [codeSource, codeDest] = await Promise.all([safe(api.getCode(chain, wallet)), safe(api.getCode(destChain, wallet))]);
      if (hasCode(codeSource) && codeDest !== null && !hasCode(codeDest) && !isDelegated(codeDest)) {
        add(
          "warn",
          "contract_wallet_missing_on_destination",
          `La wallet es un contrato en ${chain} pero no existe en ${destChain}`,
          `Las wallets de contrato (Safe, cuentas inteligentes) tienen una dirección distinta o no desplegada en cada red; quien controla esa dirección en ${chain} puede no controlarla en ${destChain}.`,
          "Antes de enviar a otra red, confirma que la misma dirección esté desplegada y controlada por ti en la red destino."
        );
      } else if (hasCode(codeDest)) {
        add("info", "destination_is_contract", `La wallet es un contrato inteligente en ${destChain}`, "Un contrato puede rechazar ETH o tokens si no está preparado para recibirlos.");
      }
    }

    // 7) Puentes y DEX
    if (catalogTarget && K.isSwapRouter(catalogTarget)) {
      if (crossChain) {
        add(
          "warn",
          "dex_not_bridge",
          `Esto fue un swap en ${chain}, no un envío entre redes`,
          `La transacción llamó a ${catalogTarget.name}, un router de intercambio. Un swap cambia un token por otro dentro de ${chain}; no mueve fondos a ${destChain}.`,
          `Revisa el saldo del nuevo token en la wallet seleccionando la red ${chain}. Para enviarlo a ${destChain} necesitas un puente.`
        );
      } else {
        add("info", "dex_swap", "La transacción es un swap en un DEX", `Llamó a ${catalogTarget.name} en ${chain}.`);
      }
    }
    if (catalogTarget && /L2 (Standard Bridge|System Precompile)/i.test(catalogTarget.type)) {
      add(
        "info",
        "l2_withdrawal_delay",
        "Retirar desde una red L2 a Ethereum no es inmediato",
        "En los puentes nativos de Optimism, Base y Arbitrum los retiros pasan por un periodo de disputa (alrededor de 7 días) y luego requieren una transacción final de reclamación en Ethereum.",
        "Revisa el estado del retiro en el puente oficial; los fondos no se pierden, solo tardan."
      );
    }
    if (bridgeMatches.length && bridgeMatches.every((m) => !m.verified)) {
      add("info", "unverified_catalog_match", "La coincidencia de puente proviene de una entrada sin verificar", "El contrato detectado está en el catálogo heredado, que no fue validado contra fuentes oficiales; es solo una pista de ruta.");
    }

    // 8) Tokens
    for (const asset of assets) {
      if (!asset.known) {
        add(
          "info",
          "unknown_token",
          `Token no reconocido: ${K.shortAddress(asset.tokenAddress)}${asset.symbol && asset.symbol !== asset.tokenAddress ? ` (${asset.symbol})` : ""}`,
          "No está en la lista de tokens equivalentes de 4kiscan, así que no se puede verificar su equivalente en otras redes. Un puente puede no soportarlo o entregarlo como otro contrato.",
          "Confirma en el explorador que sea el token oficial y que el puente de destino lo admita."
        );
      } else if (asset.variant) {
        add("info", "token_variant", `Variante de token: ${asset.variant}`, "Esta red tiene más de una versión del token (nativo y «bridged»). Son contratos distintos y algunas apps solo aceptan una de ellas.");
      }
    }
    if (transfers.some((t) => t.isNft)) {
      add("info", "nft_transfer", "La transacción movió un NFT (ERC-721)", "El monto de tokens fungibles no aplica a este movimiento; revisa el NFT en el explorador.");
    }

    // 9) ¿Se movió algo?
    if (!assets.length && !transfers.length && call.kind !== "approve" && call.kind !== "deploy") {
      add(
        "warn",
        "no_assets_moved",
        "La transacción se confirmó pero no movió valor visible",
        "No hay ETH enviado ni eventos Transfer de tokens. Puede ser una instrucción a un contrato, o un envío interno que no queda en el recibo.",
        "Mira las «transacciones internas» y los eventos en el explorador antes de concluir que no hubo envío."
      );
    }

    return finish(issues);
  }

  function finish(issues) {
    return issues
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.index - b.index)
      .map((entry) => entry.issue);
  }

  // ───────────── Diagnóstico principal ─────────────
  function formatNative(hexValue, symbol) {
    return `${K.formatUnits(K.hexToBigInt(hexValue || "0x0", "value"), 18)} ${symbol}`;
  }

  /**
   * @param api  cliente de rpc.js
   * @param ctx  {chain, txHash, transaction, receipt|null, destinationWallet, destinationChain}
   */
  async function diagnose(api, ctx) {
    const { chain, txHash, transaction: tx, receipt } = ctx;
    const wallet = lower(ctx.destinationWallet);
    const destChain = ctx.destinationChain || chain;
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const pending = receipt === null || receipt === undefined;

    const status = pending ? "pending" : lower(receipt.status);
    if (!pending && status !== "0x0" && status !== "0x1") {
      throw new RpcError("El recibo no contiene un estado de transacción válido.", "invalid");
    }

    let logs = [];
    let logsWarning = null;
    if (!pending) {
      const raw = receipt.logs;
      if (Array.isArray(raw)) {
        logs = raw.filter((log) => log && typeof log === "object");
        if (logs.length !== raw.length) logsWarning = "El recibo contiene logs malformados; se omitieron para poder continuar.";
      } else if (raw != null) {
        logsWarning = "El campo logs del recibo tiene un formato inesperado; no se pudieron analizar los eventos.";
      }
    }

    const to = lower(tx.to);
    const from = lower(tx.from);
    const nativeValue = K.hexToBigInt(tx.value || "0x0", "value");
    const { transfers, matching } = analyzeTransferLogs(logs, wallet);
    const routeMatches = identifyBridges(chain, to, logs, tx.input || "");
    // Solo los puentes cuentan como ruta cross-chain; los routers de DEX se informan aparte.
    const bridgeMatches = routeMatches.filter((m) => m.category === "bridge");
    const call = describeCall(tx);
    const succeeded = status === "0x1";
    const directNativeCredit = succeeded && wallet !== "" && to === wallet && nativeValue > 0n;
    const assets = succeeded ? await extractOriginAssets(api, chain, tx, logs, routeMatches) : [];
    const sourceChainCredit = destChain === chain && (directNativeCredit || matching.length > 0);

    let blockNumber = null;
    if (!pending && receipt.blockNumber != null) blockNumber = K.hexToInt(receipt.blockNumber, "blockNumber");
    let feePaid = null;
    if (!pending && receipt.gasUsed && receipt.effectiveGasPrice) {
      try {
        const wei = K.hexToBigInt(receipt.gasUsed, "gasUsed") * K.hexToBigInt(receipt.effectiveGasPrice, "effectiveGasPrice");
        feePaid = `${K.formatUnits(wei, 18)} ${nativeSymbol}`;
      } catch (error) {
        feePaid = null;
      }
    }

    // Semáforo preliminar (el radar lo puede refinar)
    let color, indicator, title, statusCode, notes;
    if (pending) {
      color = "yellow";
      indicator = "🟡";
      title = "Transacción pendiente o aún sin recibo";
      statusCode = "ORIGIN_PENDING";
      notes = "La transacción existe pero todavía no tiene recibo: puede estar esperando inclusión, haber sido reemplazada o descartada.";
    } else if (!succeeded) {
      color = "red";
      indicator = "🔴";
      title = "La transacción falló en la red de origen";
      statusCode = "ORIGIN_FAILED";
      notes = "El recibo indica estado 0x0: la ejecución no fue exitosa y los fondos principales no se movieron.";
    } else if (sourceChainCredit) {
      color = "green";
      indicator = "🟢";
      title = "Crédito explícito observado en la wallet de destino";
      statusCode = "DESTINATION_CREDIT_FOUND";
      const detail = directNativeCredit
        ? `una transferencia nativa de ${formatNative(tx.value, nativeSymbol)}`
        : `${matching.length} evento(s) Transfer de token`;
      notes = `La transacción fue exitosa y el recibo muestra ${detail} hacia la wallet indicada en la red consultada.`;
    } else if (bridgeMatches.length) {
      color = "bridge";
      indicator = "🟡";
      const protocols = [...new Set(bridgeMatches.map((m) => m.protocol))].join(", ");
      const contracts = [...new Set(bridgeMatches.map((m) => m.name))].join(", ");
      title = `Pasó por un puente/router conocido (${contracts}). Origen OK; falta confirmar el crédito en destino`;
      statusCode = "ORIGIN_ROUTED_TO_BRIDGE";
      notes = `Origen exitoso. Coincidencia de catálogo: ${protocols}. La evidencia puede venir del destinatario, la llamada o referencias en los logs; por sí sola no confirma el uso real del protocolo ni la entrega. Verifica el crédito en la red destino.`;
    } else {
      color = "yellow";
      indicator = "🟡";
      title = "Origen exitoso; el crédito en destino no aparece en este recibo";
      statusCode = "ORIGIN_CONFIRMED_DESTINATION_UNVERIFIED";
      notes =
        destChain !== chain && (directNativeCredit || matching.length)
          ? `El recibo muestra un crédito a la wallet en ${chain}, pero la red destino elegida es ${destChain}. Eso no es evidencia de crédito en destino.`
          : "La transacción de origen fue exitosa, pero este recibo no muestra una transferencia nativa ni un evento Transfer hacia la wallet indicada. Si se usó un puente, la entrega debe confirmarse en la red destino.";
    }

    const issues = await findIssues(api, {
      chain, destChain, wallet, tx, to, from, call, status, receipt, logs, transfers, assets,
      bridgeMatches, blockNumber, feePaid,
    });

    return {
      color, indicator, title, statusCode, notes,
      chain, txHash, status, from, to: to || "Creación de contrato",
      destinationWallet: wallet, destinationChain: destChain,
      originAssets: assets,
      bridgeMatches,
      routeMatches,
      bridgeProtocols: [...new Set(bridgeMatches.map((m) => m.protocol))],
      nativeValue: formatNative(tx.value, nativeSymbol),
      blockNumber, logCount: logs.length, logsWarning,
      transfers, matchingTransfers: matching,
      directNativeCredit,
      senderMatchesDestination: from === wallet,
      call: { kind: call.kind, selector: call.selector, name: call.name },
      feePaid,
      issues,
      receipt: receipt || null,
      transaction: tx,
    };
  }

  Object.assign(K, {
    SEVERITY_RANK,
    tokenIdentity,
    isKnownTokenAddress,
    analyzeTransferLogs,
    identifyBridges,
    describeCall,
    extractOriginAssets,
    findIssues,
    diagnose,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
