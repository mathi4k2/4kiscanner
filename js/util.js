/* 4kiscan · util.js
 * Utilidades puras: hex/BigInt, formato, keccak-256 + checksum EIP-55 y
 * decodificadores ABI. Sin DOM ni red. Funciona como <script> clásico en el
 * navegador (incluso abriendo index.html con doble clic) y con require() en Node.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const t = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

  // ───────────── Errores ─────────────
  class RpcError extends Error {
    constructor(message, code, extra) {
      super(message);
      this.name = "RpcError";
      this.code = code || "rpc";
      if (extra) Object.assign(this, extra);
    }
  }
  class PriceError extends Error {
    constructor(message) {
      super(message);
      this.name = "PriceError";
    }
  }

  // ───────────── Constantes ─────────────
  const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
  const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
  const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  // ───────────── Hex / BigInt ─────────────
  function hexToBigInt(value, field) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
      throw new RpcError(
        t(`El campo ${field || "valor"} tiene un formato hexadecimal inválido.`, `The ${field || "value"} field has an invalid hexadecimal format.`, `O campo ${field || "valor"} tem um formato hexadecimal inválido.`),
        "invalid"
      );
    }
    return BigInt(value);
  }
  function hexToInt(value, field) {
    return Number(hexToBigInt(value, field));
  }
  function hexToBytes(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
  }
  function bytesToBigInt(bytes) {
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    return v;
  }
  function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** BigInt escalado → texto decimal sin ceros sobrantes. */
  function formatUnits(raw, decimals) {
    if (decimals === null || decimals === undefined) return `${raw} ${t("unidades base", "base units", "unidades base")}`;
    const negative = raw < 0n;
    const v = negative ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    let text = (v / base).toString();
    if (decimals > 0) {
      const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
      if (frac) text += "." + frac;
    }
    return (negative ? "-" : "") + text;
  }

  /** Redondea un string decimal a n decimales (solo para mostrar). */
  function toFixedText(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "N/D";
    return n.toFixed(digits);
  }

  // ───────────── Formato ─────────────
  function formatUtc(timestamp) {
    return (
      new Date(timestamp * 1000)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "") + " UTC"
    );
  }
  function shortAddress(address) {
    return typeof address === "string" && address.length > 12
      ? `${address.slice(0, 6)}…${address.slice(-4)}`
      : String(address || "");
  }
  function shortHash(hash) {
    return typeof hash === "string" && hash.length > 20
      ? `${hash.slice(0, 10)}…${hash.slice(-8)}`
      : String(hash || "");
  }
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /** Ejecuta fn sobre items con concurrencia limitada; conserva el orden. */
  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, worker)
    );
    return results;
  }

  // ───────────── Keccak-256 (BigInt, 64-bit lanes) ─────────────
  const MASK64 = 0xffffffffffffffffn;
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
    0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
    0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
    0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
    0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  // Desplazamientos de rotación ROT[x][y]
  const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
  ];
  function rotl64(v, n) {
    if (n === 0) return v;
    const s = BigInt(n);
    return ((v << s) | (v >> (64n - s))) & MASK64;
  }
  function keccakF(s) {
    const C = new Array(5);
    const B = new Array(25);
    for (let round = 0; round < 24; round++) {
      for (let x = 0; x < 5; x++) {
        C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      }
      for (let x = 0; x < 5; x++) {
        const d = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) s[x + 5 * y] ^= d;
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(s[x + 5 * y], ROT[x][y]);
        }
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          s[x + 5 * y] =
            B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y]);
        }
      }
      s[0] ^= RC[round];
    }
  }
  /** keccak-256 de un Uint8Array o string UTF-8 → hex (sin 0x). */
  function keccak256(input) {
    const data =
      typeof input === "string" ? new TextEncoder().encode(input) : input;
    const rate = 136;
    const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
    padded.set(data);
    padded[data.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    const state = new Array(25).fill(0n);
    for (let off = 0; off < padded.length; off += rate) {
      for (let lane = 0; lane < rate / 8; lane++) {
        let v = 0n;
        for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(padded[off + lane * 8 + b]);
        state[lane] ^= v;
      }
      keccakF(state);
    }
    const out = new Uint8Array(32);
    for (let lane = 0; lane < 4; lane++) {
      let v = state[lane];
      for (let b = 0; b < 8; b++) {
        out[lane * 8 + b] = Number(v & 0xffn);
        v >>= 8n;
      }
    }
    return bytesToHex(out);
  }

  // ───────────── EIP-55 ─────────────
  function toChecksumAddress(address) {
    const lower = address.toLowerCase().replace(/^0x/, "");
    const hash = keccak256(lower);
    let out = "0x";
    for (let i = 0; i < lower.length; i++) {
      out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    }
    return out;
  }
  /** true si la dirección en mayúsculas/minúsculas mezcladas cumple EIP-55. */
  function isValidChecksum(address) {
    return ADDRESS_RE.test(address) && toChecksumAddress(address) === address;
  }

  // ───────────── Decodificadores ABI ─────────────
  /** Decodifica string ABI dinámico o bytes32 devuelto por eth_call. */
  function decodeAbiText(hex) {
    if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
    const bytes = hexToBytes(hex);
    if (!bytes || bytes.length === 0) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      if (bytes.length >= 64) {
        const offset = Number(bytesToBigInt(bytes.slice(0, 32)));
        if (Number.isSafeInteger(offset) && offset + 32 <= bytes.length) {
          const length = Number(bytesToBigInt(bytes.slice(offset, offset + 32)));
          const start = offset + 32;
          if (length > 0 && length <= bytes.length - start) {
            const text = decoder
              .decode(bytes.slice(start, start + length))
              .replace(/\0+$/, "")
              .trim();
            return text || null;
          }
        }
      }
      let end = bytes.length;
      while (end > 0 && bytes[end - 1] === 0) end--;
      if (end === 0) return null;
      return decoder.decode(bytes.slice(0, end)).trim() || null;
    } catch (error) {
      return null;
    }
  }

  const PANIC_CODES = {
    1: ["assert fallido", "assertion failed", "assert falhou"],
    17: ["desbordamiento aritmético", "arithmetic overflow", "estouro aritmético"],
    18: ["división por cero", "division by zero", "divisão por zero"],
    33: ["valor de enum inválido", "invalid enum value", "valor de enum inválido"],
    49: ["pop en un array vacío", "pop on an empty array", "pop em um array vazio"],
    50: ["índice de array fuera de rango", "array index out of bounds", "índice de array fora dos limites"],
    65: ["memoria insuficiente", "out of memory", "memória insuficiente"],
    81: ["función interna no inicializada", "uninitialized internal function", "função interna não inicializada"],
  };
  /** Interpreta los datos de un revert (Error(string), Panic o error custom). */
  function decodeRevertData(data) {
    if (typeof data !== "string" || !data.startsWith("0x") || data.length < 10) {
      return null;
    }
    const selector = data.slice(0, 10).toLowerCase();
    if (selector === "0x08c379a0") {
      return { kind: "error", message: decodeAbiText("0x" + data.slice(10)) };
    }
    if (selector === "0x4e487b71") {
      const code = Number(BigInt("0x" + (data.slice(10, 74) || "0")));
      return {
        kind: "panic",
        code,
        message: PANIC_CODES[code]
          ? t(...PANIC_CODES[code])
          : `${t("código de pánico", "panic code", "código de pânico")} 0x${code.toString(16)}`,
      };
    }
    return { kind: "custom", selector };
  }

  // ───────────── Direcciones dentro de payloads hex ─────────────
  /**
   * Extrae valores con forma de dirección de calldata/logs (palabras ABI de
   * 32 bytes). Ignora palabras cuyos 12 bytes altos son cero y con valor < 2^64:
   * son números (cantidades, índices), no direcciones.
   */
  function addressesInHexPayload(value) {
    if (typeof value !== "string") return [];
    const payload = value.startsWith("0x") ? value.slice(2) : value;
    if (!payload || !/^[a-fA-F0-9]+$/.test(payload)) return [];
    const out = [];
    const seen = new Set();
    const add = (addr) => {
      const normalized = "0x" + addr.slice(-40).toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    };
    const alignments = payload.length % 64 === 8 ? [0, 8] : [0];
    for (const alignment of alignments) {
      for (let off = alignment; off <= payload.length - 64; off += 64) {
        const word = payload.slice(off, off + 64);
        if (word.slice(0, 24) !== "0".repeat(24)) continue;
        const addr = word.slice(-40);
        if (addr.slice(0, 24) === "0".repeat(24)) continue; // número pequeño
        add(addr);
      }
    }
    const exact = payload.match(/^([a-fA-F0-9]{40})$/);
    if (exact) add(exact[1]);
    return out;
  }
  function addressFromTopic(topic) {
    if (typeof topic !== "string" || topic.length !== 66) return null;
    if (topic.slice(0, 26).toLowerCase() !== "0x" + "0".repeat(24)) return null;
    const address = "0x" + topic.slice(-40);
    return ADDRESS_RE.test(address) ? address.toLowerCase() : null;
  }
  /** Cuántos caracteres hex difieren entre dos direcciones y si comparten extremos. */
  function addressSimilarity(a, b) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x === y || x.length !== y.length) return { identical: x === y };
    let differing = 0;
    for (let i = 2; i < x.length; i++) if (x[i] !== y[i]) differing++;
    return {
      identical: false,
      differing,
      sameEnds: x.slice(2, 6) === y.slice(2, 6) && x.slice(-4) === y.slice(-4),
    };
  }

  Object.assign(K, {
    RpcError,
    PriceError,
    TX_HASH_RE,
    ADDRESS_RE,
    ZERO_ADDRESS,
    DEAD_ADDRESS,
    TRANSFER_TOPIC,
    hexToBigInt,
    hexToInt,
    hexToBytes,
    bytesToBigInt,
    bytesToHex,
    formatUnits,
    toFixedText,
    formatUtc,
    shortAddress,
    shortHash,
    escapeHtml,
    sleep,
    mapLimit,
    keccak256,
    toChecksumAddress,
    isValidChecksum,
    decodeAbiText,
    decodeRevertData,
    addressesInHexPayload,
    addressFromTopic,
    addressSimilarity,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
