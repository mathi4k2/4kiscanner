/* 4kiscan · providers.js
 * Conocimiento sobre tipos de operación y proveedores. Los tiempos son UMBRALES
 * ORIENTATIVOS (no garantías de ningún proveedor) y el evaluador los presenta así.
 * Los nombres de exchanges solo sirven para reconocer el tipo de servicio; no se
 * afirma nada específico sobre políticas de un exchange concreto.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

  const FLOWS = {
    exchange_withdrawal: { label: "Retiré fondos desde un exchange o plataforma hacia mi wallet", short: "Retiro desde exchange" },
    exchange_deposit: { label: "Envié fondos desde mi wallet a un exchange o plataforma", short: "Depósito a exchange" },
    wallet_transfer: { label: "Envié fondos de una wallet a otra wallet", short: "Transferencia wallet a wallet" },
    bridge: { label: "Pasé fondos de una red a otra con un puente (bridge)", short: "Puente entre redes" },
    swap: { label: "Cambié un token por otro (swap)", short: "Swap" },
    onramp: { label: "Compré cripto (tarjeta, transferencia, P2P) y no la veo", short: "Compra de cripto" },
    other: { label: "Otra operación", short: "Otra operación" },
  };

  // ───────────── Redes ─────────────
  const NON_EVM_NETWORKS = ["Tron", "Solana", "Bitcoin", "XRP Ledger", "Cosmos", "Otra red no EVM"];
  function networkKind(value) {
    if (!value || value === "unknown" || value === "other_unknown") return "unknown";
    if (K.CHAINS[value]) return "supported";
    if (K.UNSUPPORTED_NETWORKS.some((n) => n.name === value)) return "unsupported_evm";
    if (NON_EVM_NETWORKS.includes(value)) return "non_evm";
    return "unknown";
  }
  function networkOptions() {
    const locale = typeof K.getLocale === "function" ? K.getLocale() : "es";
    const unsupported = locale === "en" ? "not verifiable here" : locale === "pt" ? "não verificável aqui" : "no verificable aquí";
    const unknown = locale === "en" ? "I don't know" : locale === "pt" ? "Não sei" : "No lo sé";
    const other = locale === "en" ? "Another non-EVM network (XRP, Cosmos…)" : locale === "pt" ? "Outra rede não EVM (XRP, Cosmos…)" : "Otra red no EVM (XRP, Cosmos…)";
    return [
      ...Object.keys(K.CHAINS).map((n) => ({ value: n, label: n })),
      ...K.UNSUPPORTED_NETWORKS.map((n) => ({ value: n.name, label: `${n.name} (${unsupported})` })),
      { value: "Tron", label: "Tron (TRC-20)" },
      { value: "Solana", label: "Solana" },
      { value: "Bitcoin", label: "Bitcoin" },
      { value: "Otra red no EVM", label: other },
      { value: "unknown", label: unknown },
    ];
  }
  /** ¿El formato de dirección es coherente con la red? true | false | null (no se puede saber). */
  function addressMatchesNetwork(addressKind, network) {
    const kind = networkKind(network);
    const evmFormat = ["evm", "evm_bad_checksum", "evm_missing_prefix", "evm_zero", "evm_burn"].includes(addressKind);
    const nonEvmFormats = { tron: "Tron", solana: "Solana", bitcoin: "Bitcoin", xrp: "XRP Ledger", cosmos: "Cosmos" };
    if (kind === "unknown") return null;
    if (evmFormat) return kind === "supported" || kind === "unsupported_evm";
    if (nonEvmFormats[addressKind]) {
      if (kind === "supported" || kind === "unsupported_evm") return false;
      if (network === "Otra red no EVM") return null;
      return network === nonEvmFormats[addressKind];
    }
    return null;
  }

  // ───────────── Reconocimiento de proveedores ─────────────
  const KNOWN = [
    // puentes / agregadores (protocolo del catálogo)
    { key: "across", names: ["across"], label: "Across", kind: "bridge", protocol: "Across" },
    { key: "stargate", names: ["stargate"], label: "Stargate", kind: "bridge", protocol: "Stargate" },
    { key: "hop", names: ["hop protocol", "hop"], label: "Hop Protocol", kind: "bridge", protocol: "Hop Protocol" },
    { key: "connext", names: ["connext", "everclear"], label: "Connext", kind: "bridge", protocol: "Connext" },
    { key: "celer", names: ["celer", "cbridge"], label: "Celer cBridge", kind: "bridge", protocol: "Celer cBridge" },
    { key: "socket", names: ["socket", "bungee"], label: "Socket / Bungee", kind: "bridge", protocol: "Socket" },
    { key: "lifi", names: ["li.fi", "lifi", "jumper"], label: "LI.FI / Jumper", kind: "bridge", protocol: "LI.FI" },
    { key: "layerzero", names: ["layerzero", "layer zero"], label: "LayerZero", kind: "bridge", protocol: "LayerZero" },
    { key: "rhino", names: ["rhino"], label: "Rhino.fi", kind: "bridge", protocol: "Rhino.fi" },
    { key: "arb_native", names: ["arbitrum bridge", "bridge.arbitrum"], label: "Puente oficial de Arbitrum", kind: "bridge", protocol: "Arbitrum Native Bridge" },
    { key: "op_native", names: ["optimism bridge", "superbridge", "app.optimism"], label: "Puente oficial de Optimism", kind: "bridge", protocol: "Optimism Native Bridge" },
    { key: "base_native", names: ["base bridge", "bridge.base"], label: "Puente oficial de Base", kind: "bridge", protocol: "Base Native Bridge" },
    { key: "polygon_native", names: ["polygon bridge", "portal polygon", "polygon portal", "polygon pos"], label: "Puente oficial de Polygon", kind: "bridge", protocol: "Polygon Native Bridge" },
    // DEX
    { key: "uniswap", names: ["uniswap"], label: "Uniswap", kind: "dex", protocol: "Uniswap" },
    { key: "quickswap", names: ["quickswap"], label: "QuickSwap", kind: "dex", protocol: "QuickSwap" },
    { key: "curve", names: ["curve"], label: "Curve", kind: "dex", protocol: "Curve" },
    { key: "velodrome", names: ["velodrome"], label: "Velodrome", kind: "dex", protocol: "Velodrome" },
    { key: "aerodrome", names: ["aerodrome"], label: "Aerodrome", kind: "dex", protocol: "Aerodrome" },
    { key: "sushi", names: ["sushi"], label: "SushiSwap", kind: "dex", protocol: null },
    { key: "1inch", names: ["1inch"], label: "1inch", kind: "dex", protocol: null },
    // exchanges / plataformas centralizadas (solo reconocimiento de tipo)
    ...["Binance", "Coinbase", "Kraken", "OKX", "Bybit", "KuCoin", "Bitget", "Gate", "HTX", "Bitfinex", "Bitso", "Buenbit", "Ripio", "Lemon", "Belo", "Bitstamp", "Gemini", "Crypto.com", "Mercado Bitcoin", "Bitpanda"].map((label) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]/g, ""),
      names: [label.toLowerCase()],
      label,
      kind: "exchange",
      protocol: null,
    })),
    // wallets
    ...["MetaMask", "Trust Wallet", "Rabby", "Phantom", "Ledger", "Trezor", "Safe", "Rainbow", "Coinbase Wallet"].map((label) => ({
      key: label.toLowerCase().replace(/[^a-z0-9]/g, ""),
      names: [label.toLowerCase()],
      label,
      kind: "wallet",
      protocol: null,
    })),
  ];

  function findProvider(text) {
    const q = String(text == null ? "" : text).toLowerCase().trim();
    if (!q) return null;
    // «Coinbase Wallet» debe ganar a «Coinbase»: se prueba primero el nombre más largo
    const candidates = [];
    for (const p of KNOWN) for (const n of p.names) if (q.includes(n)) candidates.push({ p, len: n.length });
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.len - a.len);
    const { key, label, kind, protocol } = candidates[0].p;
    return { key, label, kind, protocol };
  }

  // ───────────── Perfiles de tiempo (orientativos) ─────────────
  const MIN = 1, HOUR = 60, DAY = 24 * 60;
  const L2 = ["Optimism", "Base", "Arbitrum"];

  /**
   * @returns {{id, label, expected, thresholdMinutes|null, note, concepts:string[]}}
   */
  function timingProfile(ctx) {
    const { flow, protocol, src, dst } = ctx;
    const native = protocol && /Native Bridge$/.test(protocol);
    if (native) {
      if (L2.includes(src) && dst === "Ethereum") {
        return { id: "native_l2_to_l1", label: "Retiro por el puente oficial de una L2 a Ethereum", expected: "alrededor de 7 días de ventana de disputa más una transacción final de reclamación en Ethereum", thresholdMinutes: 8 * DAY, concepts: ["retiro_l2"] };
      }
      if (src === "Ethereum" && L2.includes(dst)) {
        return { id: "native_l1_to_l2", label: "Depósito por el puente oficial de Ethereum a una L2", expected: "normalmente entre unos pocos minutos y unos 20 minutos", thresholdMinutes: HOUR, concepts: ["bridge"] };
      }
      if (src === "Polygon" && dst === "Ethereum") {
        return { id: "polygon_withdraw", label: "Retiro por el puente oficial de Polygon a Ethereum", expected: "varias horas hasta el checkpoint y luego una reclamación manual en Ethereum", thresholdMinutes: 8 * HOUR, concepts: ["bridge"] };
      }
      if (src === "Ethereum" && dst === "Polygon") {
        return { id: "polygon_deposit", label: "Depósito por el puente oficial de Ethereum a Polygon", expected: "normalmente alrededor de 20 a 30 minutos", thresholdMinutes: HOUR, concepts: ["bridge"] };
      }
    }
    if (flow === "bridge" || (protocol && ["Across", "Stargate", "Hop Protocol", "Connext", "Celer cBridge", "Socket", "LI.FI", "LayerZero", "Rhino.fi"].includes(protocol))) {
      const slow = protocol && ["Connext", "Hop Protocol", "Socket", "LI.FI", "Rhino.fi"].includes(protocol);
      return {
        id: slow ? "bridge_standard" : "bridge_fast",
        label: protocol ? `Puente ${protocol}` : "Puente entre redes",
        expected: slow ? "desde pocos minutos hasta alrededor de una o dos horas, según la ruta" : "normalmente desde segundos hasta unos pocos minutos",
        thresholdMinutes: slow ? 2 * HOUR : HOUR,
        concepts: ["bridge"],
      };
    }
    if (flow === "swap") {
      return { id: "swap", label: "Swap en un DEX", expected: "inmediato: si la transacción tuvo éxito, el token ya está en la wallet", thresholdMinutes: 5 * MIN, concepts: ["swap"] };
    }
    if (flow === "exchange_withdrawal") {
      return { id: "exchange_withdrawal", label: "Retiro desde un exchange", expected: "desde minutos hasta algunas horas; puede haber revisiones de seguridad que lo demoren", thresholdMinutes: DAY, concepts: ["custodia", "confirmaciones"] };
    }
    if (flow === "exchange_deposit") {
      return { id: "exchange_deposit", label: "Depósito a un exchange", expected: "se acredita tras las confirmaciones que exige el exchange para esa red", thresholdMinutes: 2 * HOUR, concepts: ["confirmaciones", "custodia"] };
    }
    if (flow === "wallet_transfer") {
      return { id: "wallet_transfer", label: "Transferencia entre wallets", expected: "se refleja en cuanto la transacción se confirma (segundos a unos minutos)", thresholdMinutes: 10 * MIN, concepts: ["confirmaciones"] };
    }
    if (flow === "onramp") {
      return { id: "onramp", label: "Compra de cripto", expected: "depende del medio de pago y del proveedor", thresholdMinutes: null, concepts: ["custodia"] };
    }
    return { id: "unknown", label: "Operación", expected: "sin referencia de tiempo para este tipo de operación", thresholdMinutes: null, concepts: [] };
  }

  Object.assign(K, { FLOWS, NON_EVM_NETWORKS, networkKind, networkOptions, addressMatchesNetwork, findProvider, timingProfile });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
