/* 4kiscan · evidence.js
 * Convierte las respuestas de la entrevista en consultas a la red y devuelve la
 * evidencia on-chain que usa el evaluador. Cada paso falla de forma aislada: un
 * error de red nunca se interpreta como «los fondos no existen».
 * Depende de util, data, input, rpc, providers, diagnose, radar e interview.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const { RpcError } = K;

  const HOUR = 3600;
  /** Rangos de tiempo (minutos) de cada opción de «hace cuánto». */
  const ELAPSED_BUCKETS = {
    lt1h: [0, 60],
    "1_24h": [60, 24 * 60],
    "1_7d": [24 * 60, 7 * 24 * 60],
    gt7d: [7 * 24 * 60, Infinity],
  };

  /** Activos declarados → activo comparable con el radar (para búsquedas sin hash). */
  function declaredAssets(answers) {
    const symbol = answers.asset;
    if (!symbol || symbol === "OTHER" || !answers.amount) return [];
    const [whole, frac = ""] = String(answers.amount).split(".");
    const decimalsFor = { USDC: 6, USDT: 6, ETH: 18, WETH: 18, POL: 18 };
    const decimals = decimalsFor[symbol];
    if (decimals === undefined || frac.length > decimals) return [];
    const raw = BigInt(whole + frac.padEnd(decimals, "0"));
    if (raw <= 0n) return [];
    const native = symbol === "ETH" || symbol === "POL";
    return [
      {
        assetId: native ? `native:${symbol}` : symbol,
        symbol,
        name: null,
        tokenAddress: null,
        amountRaw: raw,
        decimals,
        amount: String(answers.amount),
        known: true,
        declared: true,
      },
    ];
  }

  function pickChain(answers, detect) {
    const hint = answers.tx_chain_hint && K.CHAINS[answers.tx_chain_hint] ? answers.tx_chain_hint : null;
    const declared = K.CHAINS[answers.src_network] ? answers.src_network : null;
    if (detect && detect.state === "detected") return { chain: detect.networks[0], how: "detected" };
    if (detect && detect.state === "ambiguous") {
      if (hint && detect.networks.includes(hint)) return { chain: hint, how: "link" };
      if (declared && detect.networks.includes(declared)) return { chain: declared, how: "declared" };
      return { chain: detect.networks[0], how: "ambiguous_first" };
    }
    if (hint) return { chain: hint, how: "link" };
    return { chain: null, how: null };
  }

  /**
   * @param api  cliente de rpc.js
   * @param answers  respuestas de la entrevista
   * @param opts  {nowSeconds, onStep(name)}
   */
  async function gatherEvidence(api, answers, opts) {
    const options = opts || {};
    const step = options.onStep || (() => {});
    const now = options.nowSeconds || Math.floor(Date.now() / 1000);
    const E = {
      nowSeconds: now,
      errors: [],
      noKey: !api.hasKey,
      addrClass: answers.dst_address ? K.classifyAddress(answers.dst_address) : null,
      hasTxHash: !!answers.tx_hash,
    };
    const guard = async (name, fn) => {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        E.errors.push({ step: name, code: error.code, message: error.message });
        return undefined;
      }
    };

    const wallet = E.addrClass && (E.addrClass.kind === "evm" || E.addrClass.kind === "evm_missing_prefix") ? E.addrClass.address : "";
    const dstKind = K.networkKind(answers.dst_network);
    const flowSwap = answers.flow === "swap";
    E.wallet = wallet;

    if (!api.hasKey) {
      E.skipped = "no_key";
      return E;
    }

    // ───────── 1. Transacción de origen ─────────
    if (answers.tx_hash) {
      step("detect");
      E.detect = await guard("detect", () => api.detectNetwork(answers.tx_hash));
      const picked = E.detect ? pickChain(answers, E.detect) : pickChain(answers, null);
      E.txChain = picked.chain;
      E.txChainHow = picked.how;

      if (E.detect && E.detect.state === "incomplete") {
        E.errors.push(...E.detect.errors.map((e) => ({ step: "detect", code: e.code, message: `${e.chain}: ${e.message}` })));
      }
      if (picked.chain) {
        step("transaction");
        const found = await guard("transaction", () => api.getTxAndReceipt(picked.chain, answers.tx_hash));
        if (found) {
          const destChain = flowSwap || !K.CHAINS[answers.dst_network] ? picked.chain : answers.dst_network;
          step("diagnose");
          const diagnosis = await guard("diagnose", () =>
            K.diagnose(api, {
              chain: picked.chain,
              txHash: answers.tx_hash,
              transaction: found.transaction,
              receipt: found.receipt,
              destinationWallet: wallet,
              destinationChain: destChain,
            })
          );
          if (diagnosis) {
            E.diagnosis = diagnosis;
            E.destChain = destChain;
            const canRadar = !!wallet && (K.CHAINS[answers.dst_network] || flowSwap);
            if (!canRadar) {
              E.radarSkipped = !wallet ? "no_wallet" : "dst_network_unsupported";
            } else {
              step("radar");
              const analyzed = await guard("radar", () => K.analyzeDestination(api, diagnosis));
              if (analyzed) {
                E.diagnosis = analyzed.diagnosis;
                E.radar = analyzed.radar;
                if (analyzed.skipped) E.radarSkipped = analyzed.skipped;
              }
            }
            // Estado multi-puente de LI.FI (cubre sus puentes subyacentes). Opcional.
            if (E.diagnosis.status === "0x1" && (E.diagnosis.bridgeMatches.length || answers.flow === "bridge")) {
              step("lifi");
              E.lifi = await api.lifiStatus(answers.tx_hash, picked.chain);
            }
          }
        }
      }
    }

    // ───────── 2. Sin hash: buscar entradas recientes a la wallet ─────────
    if (!answers.tx_hash && wallet && answers.flow !== "exchange_deposit") {
      const bucket = ELAPSED_BUCKETS[answers.elapsed];
      if (!bucket || bucket[0] >= 24 * 60) {
        E.inboundSkipped = "too_old";
      } else {
        step("inbound");
        const since = now - 24 * HOUR;
        const primary = K.CHAINS[answers.dst_network] ? answers.dst_network : Object.keys(K.CHAINS)[0];
        const assets = declaredAssets(answers);
        E.inbound = await guard("inbound", () => K.scanDestinationRadarWithFallback(api, primary, "", wallet, since, assets));
        E.inboundSince = since;
        E.inboundMatchedByDeclared = assets.length > 0;
      }
    } else if (!answers.tx_hash && !wallet) {
      E.inboundSkipped = "no_wallet";
    }
    return E;
  }

  Object.assign(K, { ELAPSED_BUCKETS, declaredAssets, gatherEvidence });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
