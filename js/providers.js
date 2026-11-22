/* 4kiscan · providers.js
 * Conocimiento sobre tipos de operación y proveedores. Los tiempos son UMBRALES
 * ORIENTATIVOS (no garantías de ningún proveedor) y el evaluador los presenta así.
 * Los nombres de exchanges solo sirven para reconocer el tipo de servicio; no se
 * afirma nada específico sobre políticas de un exchange concreto.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const t = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

  const FLOWS = {
    exchange_withdrawal: {
      get label() { return t("Retiré fondos desde un exchange o plataforma hacia mi wallet", "I withdrew funds from an exchange or platform to my wallet", "Saquei fundos de uma exchange ou plataforma para minha carteira"); },
      get short() { return t("Retiro desde exchange", "Exchange withdrawal", "Saque de exchange"); },
    },
    exchange_deposit: {
      get label() { return t("Envié fondos desde mi wallet a un exchange o plataforma", "I sent funds from my wallet to an exchange or platform", "Enviei fundos da minha carteira para uma exchange ou plataforma"); },
      get short() { return t("Depósito a exchange", "Exchange deposit", "Depósito em exchange"); },
    },
    wallet_transfer: {
      get label() { return t("Envié fondos de una wallet a otra wallet", "I sent funds from one wallet to another", "Enviei fundos de uma carteira para outra"); },
      get short() { return t("Transferencia wallet a wallet", "Wallet-to-wallet transfer", "Transferência entre carteiras"); },
    },
    bridge: {
      get label() { return t("Pasé fondos de una red a otra con un puente (bridge)", "I moved funds from one network to another using a bridge", "Transferi fundos de uma rede para outra usando uma ponte (bridge)"); },
      get short() { return t("Puente entre redes", "Cross-network bridge", "Ponte entre redes"); },
    },
    swap: {
      get label() { return t("Cambié un token por otro (swap)", "I swapped one token for another", "Troquei um token por outro (swap)"); },
      short: "Swap",
    },
    onramp: {
      get label() { return t("Compré cripto (tarjeta, transferencia, P2P) y no la veo", "I bought crypto (card, transfer, P2P) but cannot see it", "Comprei cripto (cartão, transferência, P2P), mas não consigo vê-la"); },
      get short() { return t("Compra de cripto", "Crypto purchase", "Compra de cripto"); },
    },
    other: {
      get label() { return t("Otra operación", "Another operation", "Outra operação"); },
      get short() { return t("Otra operación", "Other operation", "Outra operação"); },
    },
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
    { key: "arb_native", names: ["arbitrum bridge", "bridge.arbitrum"], get label() { return t("Puente oficial de Arbitrum", "Official Arbitrum Bridge", "Ponte oficial da Arbitrum"); }, kind: "bridge", protocol: "Arbitrum Native Bridge" },
    { key: "op_native", names: ["optimism bridge", "superbridge", "app.optimism"], get label() { return t("Puente oficial de Optimism", "Official Optimism Bridge", "Ponte oficial da Optimism"); }, kind: "bridge", protocol: "Optimism Native Bridge" },
    { key: "base_native", names: ["base bridge", "bridge.base"], get label() { return t("Puente oficial de Base", "Official Base Bridge", "Ponte oficial da Base"); }, kind: "bridge", protocol: "Base Native Bridge" },
    { key: "polygon_native", names: ["polygon bridge", "portal polygon", "polygon portal", "polygon pos"], get label() { return t("Puente oficial de Polygon", "Official Polygon Bridge", "Ponte oficial da Polygon"); }, kind: "bridge", protocol: "Polygon Native Bridge" },
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
  function localizeTiming(profile) {
    if (locale() === "es") return profile;
    const messages = {
      native_l2_to_l1: [ "Withdrawal through an official L2-to-Ethereum bridge", "About 7 days for the dispute window, followed by a final claim transaction on Ethereum", "Saque por uma ponte oficial de L2 para Ethereum", "Cerca de 7 dias para o período de contestação, seguidos de uma transação final de resgate na Ethereum" ],
      native_l1_to_l2: [ "Deposit through the official Ethereum-to-L2 bridge", "Usually a few minutes to about 20 minutes", "Depósito pela ponte oficial de Ethereum para L2", "Normalmente de alguns minutos a cerca de 20 minutos" ],
      polygon_withdraw: [ "Withdrawal through the official Polygon-to-Ethereum bridge", "Several hours until the checkpoint, followed by a manual claim on Ethereum", "Saque pela ponte oficial da Polygon para Ethereum", "Várias horas até o checkpoint, seguidas de um resgate manual na Ethereum" ],
      polygon_deposit: [ "Deposit through the official Ethereum-to-Polygon bridge", "Usually about 20 to 30 minutes", "Depósito pela ponte oficial de Ethereum para Polygon", "Normalmente cerca de 20 a 30 minutos" ],
      swap: [ "Swap on a DEX", "Immediate: if the transaction succeeded, the token is already in the wallet", "Swap em uma DEX", "Imediato: se a transação foi concluída, o token já está na carteira" ],
      exchange_withdrawal: [ "Exchange withdrawal", "A few minutes to several hours; security reviews may cause delays", "Saque de exchange", "De alguns minutos a várias horas; verificações de segurança podem causar atrasos" ],
      exchange_deposit: [ "Exchange deposit", "Credited after the confirmations required by the exchange for that network", "Depósito em exchange", "Creditado após as confirmações exigidas pela exchange nessa rede" ],
      wallet_transfer: [ "Wallet-to-wallet transfer", "Appears as soon as the transaction is confirmed (seconds to a few minutes)", "Transferência entre carteiras", "Aparece assim que a transação é confirmada (de segundos a alguns minutos)" ],
      onramp: [ "Crypto purchase", "Depends on the payment method and provider", "Compra de cripto", "Depende do meio de pagamento e do provedor" ],
      unknown: [ "Operation", "No time reference is available for this type of operation", "Operação", "Não há referência de tempo para esse tipo de operação" ],
    };
    const translation = messages[profile.id];
    if (!translation && profile.id !== "bridge_standard" && profile.id !== "bridge_fast") return profile;
    if (!translation) {
      return {
        ...profile,
        label: profile.label === "Puente entre redes"
          ? locale() === "en" ? "Cross-network bridge" : "Ponte entre redes"
          : locale() === "en" ? profile.label.replace(/^Puente/, "Bridge") : profile.label.replace(/^Puente/, "Ponte"),
        expected: profile.id === "bridge_standard"
          ? locale() === "en" ? "A few minutes to about one or two hours, depending on the route" : "De alguns minutos a cerca de uma ou duas horas, dependendo da rota"
          : locale() === "en" ? "Usually seconds to a few minutes" : "Normalmente de segundos a alguns minutos",
      };
    }
    return { ...profile, label: locale() === "en" ? translation[0] : translation[2], expected: locale() === "en" ? translation[1] : translation[3] };
  }

  /**
   * @returns {{id, label, expected, thresholdMinutes|null, note, concepts:string[]}}
   */
  function timingProfileBase(ctx) {
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
  function timingProfile(ctx) {
    return localizeTiming(timingProfileBase(ctx));
  }

  Object.assign(K, { FLOWS, NON_EVM_NETWORKS, networkKind, networkOptions, addressMatchesNetwork, findProvider, timingProfile });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
