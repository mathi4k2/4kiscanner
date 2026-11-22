/* 4kiscan · input.js
 * Clasifica lo que el usuario pegó (hash / dirección) y explica en lenguaje claro
 * por qué algo no es válido o no pertenece a una red EVM soportada.
 * Depende de util.js y data.js.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

  const BASE58 = "[1-9A-HJ-NP-Za-km-z]";

  function chainFromExplorerHost(host) {
    const wanted = String(host || "").toLowerCase().replace(/^www\./, "");
    for (const [name, chain] of Object.entries(K.CHAINS)) {
      if (new URL(chain.explorer).host === wanted) return name;
    }
    return null;
  }

  /** @returns {{kind:string, hash?:string, chain?:string|null, length?:number}} */
  function classifyTxInput(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return { kind: "empty" };
    if (K.TX_HASH_RE.test(s)) return { kind: "evm_tx", hash: s.toLowerCase() };

    const url = s.match(/^https?:\/\/([^/\s]+)\/tx\/(0x[a-fA-F0-9]{64})(?:[/?#]\S*)?$/i);
    if (url) {
      return {
        kind: "explorer_url",
        hash: url[2].toLowerCase(),
        host: url[1].toLowerCase(),
        chain: chainFromExplorerHost(url[1]),
      };
    }
    if (/^https?:\/\//i.test(s)) return { kind: "url_without_hash" };
    if (/^[a-fA-F0-9]{64}$/.test(s)) return { kind: "hash_without_prefix", hash: "0x" + s.toLowerCase() };
    if (K.ADDRESS_RE.test(s)) return { kind: "evm_address" };
    if (/^0x[a-fA-F0-9]+$/.test(s)) return { kind: "evm_wrong_length", length: s.length - 2 };
    if (new RegExp(`^${BASE58}{86,88}$`).test(s)) return { kind: "solana_signature" };
    return { kind: "unknown", length: s.length };
  }

  /** Mensaje para un hash inválido; null si es utilizable. */
  function explainTxInput(cls) {
    switch (cls.kind) {
      case "empty":
        return null;
      case "evm_tx":
        return null;
      case "explorer_url":
        return {
          severity: "info",
          title: "Se detectó un enlace de explorador",
          detail: cls.chain
            ? `Se extrajo el hash y la red (${cls.chain}) del enlace.`
            : "Se extrajo el hash del enlace, pero ese explorador no corresponde a una red soportada por 4kiscan.",
        };
      case "url_without_hash":
        return {
          severity: "error",
          title: "El enlace no contiene un hash de transacción",
          detail: "Pega el hash (0x + 64 caracteres) o un enlace de explorador del tipo …/tx/0x…",
        };
      case "hash_without_prefix":
        return {
          severity: "warn",
          title: "Al hash le falta el prefijo 0x",
          detail:
            "Tiene 64 caracteres hexadecimales pero sin «0x». En redes EVM se agrega 0x. Si el hash viene de Tron o Bitcoin, esas redes no están soportadas.",
        };
      case "evm_address":
        return {
          severity: "error",
          title: "Pegaste una dirección de wallet, no un hash de transacción",
          detail:
            "Una dirección tiene 40 caracteres tras el 0x; un hash de transacción tiene 64. El hash lo muestra el explorador o la app de la wallet/exchange (a veces como «TxID»).",
        };
      case "evm_wrong_length":
        return {
          severity: "error",
          title: `El hash tiene ${cls.length} caracteres hexadecimales (deben ser 64)`,
          detail: "Probablemente se copió incompleto o con caracteres de más. Cópialo de nuevo completo.",
        };
      case "solana_signature":
        return {
          severity: "error",
          title: "Parece una firma de Solana, red no compatible con EVM",
          detail: "4kiscan solo analiza redes EVM (Ethereum, Polygon, Optimism, Arbitrum, Base).",
        };
      default:
        return {
          severity: "error",
          title: "Formato de hash no reconocido",
          detail: "Un hash EVM empieza con 0x y tiene 64 caracteres hexadecimales (0-9, a-f).",
        };
    }
  }

  /** @returns {{kind:string, address?:string, checksum?:string, length?:number}} */
  function classifyAddress(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return { kind: "empty" };

    if (K.ADDRESS_RE.test(s)) {
      const lower = s.toLowerCase();
      const body = s.slice(2);
      const mixed = /[a-f]/.test(body) && /[A-F]/.test(body);
      if (mixed && !K.isValidChecksum(s)) {
        return { kind: "evm_bad_checksum", address: lower, checksum: K.toChecksumAddress(s) };
      }
      if (lower === K.ZERO_ADDRESS) return { kind: "evm_zero", address: lower };
      if (lower === K.DEAD_ADDRESS) return { kind: "evm_burn", address: lower };
      return { kind: "evm", address: lower };
    }
    if (/^[a-fA-F0-9]{40}$/.test(s)) return { kind: "evm_missing_prefix", address: "0x" + s.toLowerCase() };
    if (/^0x[a-fA-F0-9]+$/.test(s)) return { kind: "evm_wrong_length", length: s.length - 2 };
    if (/^0x/i.test(s)) return { kind: "evm_invalid_chars" };
    if (/^[^\s.]+\.(eth|crypto|bnb|arb|op|base|lens|sol|xyz)$/i.test(s)) return { kind: "name_service" };
    if (new RegExp(`^T${BASE58}{33}$`).test(s)) return { kind: "tron" };
    if (/^bc1[a-z0-9]{25,87}$/.test(s) || new RegExp(`^[13]${BASE58}{25,34}$`).test(s)) return { kind: "bitcoin" };
    if (/^[a-z]{2,10}1[02-9ac-hj-np-z]{38}$/.test(s)) return { kind: "cosmos" };
    if (new RegExp(`^r${BASE58}{24,34}$`).test(s)) return { kind: "xrp" };
    if (new RegExp(`^${BASE58}{32,44}$`).test(s)) return { kind: "solana" };
    return { kind: "unknown", length: s.length };
  }

  const NON_EVM_LABELS = {
    tron: "Tron (empieza con T)",
    bitcoin: "Bitcoin",
    cosmos: "una red Cosmos",
    xrp: "XRP Ledger",
    solana: "Solana",
  };

  /** Mensaje para una dirección; null si es utilizable sin advertencias. */
  function explainAddressInput(cls) {
    switch (cls.kind) {
      case "empty":
      case "evm":
        return null;
      case "evm_bad_checksum":
        return {
          severity: "error",
          title: "La dirección tiene un error de escritura (checksum inválido)",
          detail: `Mezcla mayúsculas y minúsculas, pero no cumple el checksum EIP-55: casi seguro hay un carácter equivocado. Con el checksum correcto sería ${cls.checksum}; si no es la que esperabas, vuelve a copiarla desde la wallet.`,
        };
      case "evm_zero":
        return {
          severity: "error",
          title: "Es la dirección cero (0x000…000)",
          detail: "Esa dirección no pertenece a nadie; los fondos enviados ahí se pierden.",
        };
      case "evm_burn":
        return {
          severity: "error",
          title: "Es una dirección de quema (0x…dEaD)",
          detail: "Los fondos enviados ahí quedan inaccesibles de forma permanente.",
        };
      case "evm_missing_prefix":
        return {
          severity: "warn",
          title: "A la dirección le falta el prefijo 0x",
          detail: "Se asumió 0x + los 40 caracteres que pegaste.",
        };
      case "evm_wrong_length":
        return {
          severity: "error",
          title: `La dirección tiene ${cls.length} caracteres hexadecimales (deben ser 40)`,
          detail: "Falta o sobra algún carácter. Enviar a una dirección mal copiada puede perder los fondos.",
        };
      case "evm_invalid_chars":
        return {
          severity: "error",
          title: "La dirección contiene caracteres no hexadecimales",
          detail: "Solo se permiten 0-9 y a-f después del 0x.",
        };
      case "name_service":
        return {
          severity: "error",
          title: "Es un nombre (ENS u otro), no una dirección",
          detail: "4kiscan necesita la dirección hexadecimal (0x…) que quedó registrada en la transacción.",
        };
      case "tron":
      case "bitcoin":
      case "cosmos":
      case "xrp":
      case "solana":
        return {
          severity: "error",
          title: `Es una dirección de ${NON_EVM_LABELS[cls.kind]}, no una dirección EVM`,
          detail:
            "Si se enviaron fondos desde una red EVM a esta dirección, o se eligió la red equivocada al retirar, los fondos pueden no ser recuperables. Contacta al soporte del exchange/bridge con el hash.",
        };
      default:
        return {
          severity: "error",
          title: "Formato de dirección no reconocido",
          detail: "Una dirección EVM empieza con 0x y tiene 40 caracteres hexadecimales.",
        };
    }
  }

  Object.assign(K, {
    classifyTxInput,
    explainTxInput,
    classifyAddress,
    explainAddressInput,
    chainFromExplorerHost,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
