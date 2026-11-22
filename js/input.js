/* 4kiscan · input.js
 * Clasifica lo que el usuario pegó (hash / dirección) y explica en lenguaje claro
 * por qué algo no es válido o no pertenece a una red EVM soportada.
 * Depende de util.js y data.js.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

  const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const text = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

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
          title: text("Se detectó un enlace de explorador", "Explorer link detected", "Link de explorador detectado"),
          detail: cls.chain
            ? text(`Se extrajo el hash y la red (${cls.chain}) del enlace.`, `The hash and network (${cls.chain}) were extracted from the link.`, `O hash e a rede (${cls.chain}) foram extraídos do link.`)
            : text("Se extrajo el hash del enlace, pero ese explorador no corresponde a una red soportada por 4kiscan.", "The hash was extracted from the link, but that explorer does not correspond to a network supported by 4kiscan.", "O hash foi extraído do link, mas esse explorador não corresponde a uma rede compatível com o 4kiscan."),
        };
      case "url_without_hash":
        return {
          severity: "error",
          title: text("El enlace no contiene un hash de transacción", "The link does not contain a transaction hash", "O link não contém um hash de transação"),
          detail: text("Pega el hash (0x + 64 caracteres) o un enlace de explorador del tipo …/tx/0x…", "Paste the hash (0x + 64 characters) or an explorer link such as …/tx/0x…", "Cole o hash (0x + 64 caracteres) ou um link de explorador como …/tx/0x…"),
        };
      case "hash_without_prefix":
        return {
          severity: "warn",
          title: text("Al hash le falta el prefijo 0x", "The hash is missing the 0x prefix", "Falta o prefixo 0x no hash"),
          detail: text("Tiene 64 caracteres hexadecimales pero sin «0x». En redes EVM se agrega 0x. Si el hash viene de Tron o Bitcoin, esas redes no están soportadas.", "It has 64 hexadecimal characters but no “0x” prefix. EVM networks require the prefix. Hashes from Tron or Bitcoin are not supported.", "Ele tem 64 caracteres hexadecimais, mas sem o prefixo “0x”. Redes EVM exigem esse prefixo. Hashes de Tron ou Bitcoin não são compatíveis."),
        };
      case "evm_address":
        return {
          severity: "error",
          title: text("Pegaste una dirección de wallet, no un hash de transacción", "You pasted a wallet address, not a transaction hash", "Você colou um endereço de carteira, não um hash de transação"),
          detail: text("Una dirección tiene 40 caracteres tras el 0x; un hash de transacción tiene 64. El hash lo muestra el explorador o la app de la wallet/exchange (a veces como «TxID»).", "An address has 40 characters after 0x; a transaction hash has 64. The hash is shown by the explorer or wallet/exchange app (sometimes labeled “TxID”).", "Um endereço tem 40 caracteres após 0x; um hash de transação tem 64. O hash aparece no explorador ou no aplicativo da carteira/exchange (às vezes como “TxID”)."),
        };
      case "evm_wrong_length":
        return {
          severity: "error",
          title: text(`El hash tiene ${cls.length} caracteres hexadecimales (deben ser 64)`, `The hash has ${cls.length} hexadecimal characters (it must have 64)`, `O hash tem ${cls.length} caracteres hexadecimais (deve ter 64)`),
          detail: text("Probablemente se copió incompleto o con caracteres de más. Cópialo de nuevo completo.", "It was probably copied incompletely or with extra characters. Copy it again in full.", "Provavelmente foi copiado incompleto ou com caracteres a mais. Copie-o novamente por inteiro."),
        };
      case "solana_signature":
        return {
          severity: "error",
          title: text("Parece una firma de Solana, red no compatible con EVM", "This looks like a Solana signature; Solana is not an EVM network", "Parece uma assinatura Solana; Solana não é uma rede EVM"),
          detail: text("4kiscan solo analiza redes EVM (Ethereum, Polygon, Optimism, Arbitrum, Base).", "4kiscan only analyzes EVM networks (Ethereum, Polygon, Optimism, Arbitrum, Base).", "O 4kiscan analisa apenas redes EVM (Ethereum, Polygon, Optimism, Arbitrum, Base)."),
        };
      default:
        return {
          severity: "error",
          title: text("Formato de hash no reconocido", "Unrecognized hash format", "Formato de hash não reconhecido"),
          detail: text("Un hash EVM empieza con 0x y tiene 64 caracteres hexadecimales (0-9, a-f).", "An EVM hash starts with 0x and has 64 hexadecimal characters (0–9, a–f).", "Um hash EVM começa com 0x e tem 64 caracteres hexadecimais (0–9, a–f)."),
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
    tron: () => text("Tron (empieza con T)", "Tron (starts with T)", "Tron (começa com T)"),
    bitcoin: () => "Bitcoin",
    cosmos: () => text("una red Cosmos", "Cosmos", "uma rede Cosmos"),
    xrp: () => "XRP Ledger",
    solana: () => "Solana",
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
          title: text("La dirección tiene un error de escritura (checksum inválido)", "The address has a typing error (invalid checksum)", "O endereço tem um erro de digitação (checksum inválido)"),
          detail: text(`Mezcla mayúsculas y minúsculas, pero no cumple el checksum EIP-55: casi seguro hay un carácter equivocado. Con el checksum correcto sería ${cls.checksum}; si no es la que esperabas, vuelve a copiarla desde la wallet.`, `It mixes uppercase and lowercase letters but does not pass the EIP-55 checksum: at least one character is almost certainly wrong. The correctly checksummed address would be ${cls.checksum}; if that is not the address you expected, copy it again from your wallet.`, `Ele mistura letras maiúsculas e minúsculas, mas não corresponde ao checksum EIP-55: quase certamente há um caractere incorreto. O endereço com checksum correto seria ${cls.checksum}; se não for o esperado, copie-o novamente da carteira.`),
        };
      case "evm_zero":
        return {
          severity: "error",
          title: text("Es la dirección cero (0x000…000)", "This is the zero address (0x000…000)", "Este é o endereço zero (0x000…000)"),
          detail: text("Esa dirección no pertenece a nadie; los fondos enviados ahí se pierden.", "That address belongs to no one; funds sent there are lost.", "Esse endereço não pertence a ninguém; os fundos enviados para lá são perdidos."),
        };
      case "evm_burn":
        return {
          severity: "error",
          title: text("Es una dirección de quema (0x…dEaD)", "This is a burn address (0x…dEaD)", "Este é um endereço de queima (0x…dEaD)"),
          detail: text("Los fondos enviados ahí quedan inaccesibles de forma permanente.", "Funds sent there become permanently inaccessible.", "Os fundos enviados para lá ficam permanentemente inacessíveis."),
        };
      case "evm_missing_prefix":
        return {
          severity: "warn",
          title: text("A la dirección le falta el prefijo 0x", "The address is missing the 0x prefix", "Falta o prefixo 0x no endereço"),
          detail: text("Se asumió 0x + los 40 caracteres que pegaste.", "The 40 characters you pasted were treated as an address with the 0x prefix.", "Os 40 caracteres que você colou foram considerados um endereço com o prefixo 0x."),
        };
      case "evm_wrong_length":
        return {
          severity: "error",
          title: text(`La dirección tiene ${cls.length} caracteres hexadecimales (deben ser 40)`, `The address has ${cls.length} hexadecimal characters (it must have 40)`, `O endereço tem ${cls.length} caracteres hexadecimais (deve ter 40)`),
          detail: text("Falta o sobra algún carácter. Enviar a una dirección mal copiada puede perder los fondos.", "A character is missing or extra. Sending to an incorrectly copied address can result in lost funds.", "Falta ou sobra um caractere. Enviar para um endereço copiado incorretamente pode resultar na perda dos fundos."),
        };
      case "evm_invalid_chars":
        return {
          severity: "error",
          title: text("La dirección contiene caracteres no hexadecimales", "The address contains non-hexadecimal characters", "O endereço contém caracteres não hexadecimais"),
          detail: text("Solo se permiten 0-9 y a-f después del 0x.", "Only 0–9 and a–f are allowed after 0x.", "Somente 0–9 e a–f são permitidos após 0x."),
        };
      case "name_service":
        return {
          severity: "error",
          title: text("Es un nombre (ENS u otro), no una dirección", "This is a name (ENS or another service), not an address", "Isto é um nome (ENS ou outro serviço), não um endereço"),
          detail: text("4kiscan necesita la dirección hexadecimal (0x…) que quedó registrada en la transacción.", "4kiscan needs the hexadecimal address (0x…) recorded in the transaction.", "O 4kiscan precisa do endereço hexadecimal (0x…) registrado na transação."),
        };
      case "tron":
      case "bitcoin":
      case "cosmos":
      case "xrp":
      case "solana":
        return {
          severity: "error",
          title: text(`Es una dirección de ${NON_EVM_LABELS[cls.kind]()}, no una dirección EVM`, `This is a ${NON_EVM_LABELS[cls.kind]()} address, not an EVM address`, `Este é um endereço de ${NON_EVM_LABELS[cls.kind]()}, não um endereço EVM`),
          detail: text("Si se enviaron fondos desde una red EVM a esta dirección, o se eligió la red equivocada al retirar, los fondos pueden no ser recuperables. Contacta al soporte del exchange/bridge con el hash.", "If funds were sent from an EVM network to this address, or the wrong network was selected for a withdrawal, they may not be recoverable. Contact the exchange/bridge support team with the hash.", "Se fundos foram enviados de uma rede EVM para este endereço, ou a rede errada foi selecionada no saque, talvez não seja possível recuperá-los. Entre em contato com o suporte da exchange/ponte e informe o hash."),
        };
      default:
        return {
          severity: "error",
          title: text("Formato de dirección no reconocido", "Unrecognized address format", "Formato de endereço não reconhecido"),
          detail: text("Una dirección EVM empieza con 0x y tiene 40 caracteres hexadecimales.", "An EVM address starts with 0x and has 40 hexadecimal characters.", "Um endereço EVM começa com 0x e tem 40 caracteres hexadecimais."),
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
