/* 4kiscan · interview.js
 * Entrevista adaptativa: qué preguntar, en qué orden y cómo validar cada
 * respuesta. Sin DOM ni red. Depende de util.js, data.js, input.js y providers.js.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

  const SKIP = "__skip";
  const UNKNOWN = "unknown";
  const EXCHANGE_FLOWS = ["exchange_withdrawal", "exchange_deposit"];
  const NON_SWAP = (a) => a.flow !== "swap";

  const YES_NO_UNSURE = [
    { value: "yes", label: "Sí" },
    { value: "no", label: "No" },
    { value: UNKNOWN, label: "No lo sé" },
  ];

  function srcPrompt(a) {
    switch (a.flow) {
      case "exchange_withdrawal":
        return "¿Qué red elegiste en el formulario de retiro?";
      case "exchange_deposit":
      case "wallet_transfer":
        return "¿Por qué red enviaste los fondos desde tu wallet?";
      case "bridge":
        return "¿En qué red estaban tus fondos antes de la operación (red de origen)?";
      case "swap":
        return "¿En qué red hiciste el intercambio?";
      default:
        return "¿Por qué red se enviaron los fondos?";
    }
  }
  function dstPrompt(a) {
    switch (a.flow) {
      case "exchange_withdrawal":
        return "¿En qué red esperabas recibir los fondos en tu wallet?";
      case "exchange_deposit":
        return "¿Qué red indicaba la plataforma para depositar?";
      case "bridge":
        return "¿A qué red querías llevar los fondos (red de destino)?";
      case "onramp":
        return "¿En qué red debía llegar la cripto que compraste?";
      default:
        return "¿En qué red esperabas que llegaran los fondos?";
    }
  }
  function addressPrompt(a) {
    if (a.flow === "exchange_deposit") return "¿Cuál es la dirección de depósito que usaste? Pégala exactamente como la copiaste.";
    if (a.flow === "swap") return "¿Cuál es la dirección de tu wallet con la que operaste?";
    return "¿Cuál es la dirección donde esperabas recibir los fondos? Pégala exactamente como la usaste.";
  }

  const QUESTIONS = [
    {
      id: "flow",
      type: "choice",
      prompt: () => "¿Qué operación intentaste hacer?",
      help: () => "Cada tipo de operación tiene sus propias formas de fallar y sus propios tiempos. Elige la que más se parezca.",
      options: () => Object.entries(K.FLOWS).map(([value, f]) => ({ value, label: f.label })),
    },
    {
      id: "provider",
      type: "text",
      optional: true,
      placeholder: "Por ejemplo: Binance, Across, MetaMask, Uniswap…",
      prompt: (a) =>
        a.flow === "bridge"
          ? "¿Qué puente o aplicación usaste?"
          : a.flow === "swap"
          ? "¿Qué aplicación usaste para el intercambio?"
          : a.flow === "wallet_transfer"
          ? "¿Qué wallet o aplicación usaste para enviar?"
          : "¿Qué plataforma o servicio usaste?",
      help: () => "Saber quién intervino nos permite explicar tiempos y condiciones típicas. Puedes omitirla si no lo recuerdas.",
    },
    {
      id: "symptom",
      type: "choice",
      prompt: () => "¿Qué es lo que estás viendo?",
      help: () => "Describe el síntoma tal como lo ves, aunque no sepas la causa.",
      options: () => [
        { value: "not_arrived", label: "Los fondos no llegaron" },
        { value: "not_visible", label: "Dicen que llegaron, pero no los veo en mi saldo" },
        { value: "cannot_use", label: "Los veo, pero no los puedo usar, mover ni retirar" },
        { value: "pending_status", label: "Figura «pendiente» o «en proceso»" },
        { value: "failed_status", label: "La aplicación dice que falló o fue rechazada" },
        { value: "less_amount", label: "Llegó menos de lo que esperaba" },
      ],
    },
    {
      id: "elapsed",
      type: "choice",
      prompt: () => "¿Hace cuánto hiciste la operación?",
      help: () => "Muchas operaciones simplemente tardan; el tiempo transcurrido distingue una demora normal de un problema.",
      concepts: ["confirmaciones"],
      options: () => [
        { value: "lt1h", label: "Menos de 1 hora" },
        { value: "1_24h", label: "Entre 1 y 24 horas" },
        { value: "1_7d", label: "Entre 1 y 7 días" },
        { value: "gt7d", label: "Más de 7 días" },
      ],
    },
    {
      id: "asset",
      type: "choice",
      prompt: () => "¿Qué activo enviaste?",
      help: () => "El activo exacto importa: dos tokens con el mismo nombre pueden ser contratos distintos.",
      concepts: ["token_contrato"],
      options: () => [
        { value: "USDC", label: "USDC" },
        { value: "USDT", label: "USDT" },
        { value: "ETH", label: "ETH" },
        { value: "WETH", label: "WETH" },
        { value: "POL", label: "POL (antes MATIC)" },
        { value: "OTHER", label: "Otro" },
      ],
    },
    {
      id: "asset_other",
      type: "text",
      optional: true,
      applies: (a) => a.asset === "OTHER",
      placeholder: "Nombre o símbolo del token",
      prompt: () => "¿Cuál era el token?",
      help: () => "Con el nombre o símbolo podemos compararlo con lo que realmente se movió.",
    },
    {
      id: "amount",
      type: "number",
      optional: true,
      placeholder: "Por ejemplo: 250 o 0,5",
      prompt: () => "¿Qué monto enviaste?",
      help: () => "Lo comparamos con el monto observado en la red para detectar diferencias.",
    },
    {
      id: "src_network",
      type: "choice",
      applies: (a) => a.flow !== "onramp",
      prompt: srcPrompt,
      help: () => "La red elegida al enviar es la causa más frecuente de fondos que no aparecen.",
      concepts: ["red"],
      options: () => K.networkOptions(),
    },
    {
      id: "dst_network",
      type: "choice",
      applies: NON_SWAP,
      prompt: dstPrompt,
      help: () => "Compararemos la red por la que enviaste con la red que esperaba el destino.",
      concepts: ["red", "direccion_evm"],
      options: () => K.networkOptions(),
    },
    {
      id: "dst_address",
      type: "address",
      optional: true,
      placeholder: "0x… (o la dirección que usaste)",
      prompt: addressPrompt,
      help: () => "La dirección permite verificar quién recibió realmente los fondos. Copia y pega, no la escribas a mano.",
      concepts: ["checksum"],
    },
    {
      id: "addr_source",
      type: "choice",
      applies: (a) => ["exchange_withdrawal", "exchange_deposit", "wallet_transfer"].includes(a.flow),
      prompt: () => "¿De dónde sacaste esa dirección?",
      help: () => "Una dirección copiada del historial o de un mensaje es más propensa a errores que una copiada de la fuente.",
      concepts: ["address_poisoning"],
      options: () => [
        { value: "provider_page", label: "De la página de depósito de la plataforma" },
        { value: "own_wallet", label: "De mi propia wallet" },
        { value: "history", label: "Del historial de transacciones o contactos" },
        { value: "typed", label: "La escribí a mano" },
        { value: "third_party", label: "Me la pasó otra persona" },
      ],
    },
    {
      id: "third_party",
      type: "choice",
      applies: NON_SWAP,
      prompt: () => "¿Alguien te pidió o te indicó hacer este envío (un «asesor», una inversión, un premio, un soporte que te contactó)?",
      help: () => "Lo preguntamos a todos: algunas estafas se presentan como un servicio legítimo y conviene descartarlo.",
      options: () => [
        { value: "no", label: "No, lo decidí yo" },
        { value: "yes", label: "Sí, alguien me lo indicó" },
      ],
    },
    {
      id: "memo",
      type: "choice",
      applies: (a) => a.flow === "exchange_deposit" && ["non_evm", "unknown"].includes(K.networkKind(a.dst_network)),
      prompt: () => "¿La plataforma te pidió un memo, tag o ID de destino, y lo incluiste?",
      help: () => "En redes como XRP, Stellar, Cosmos o TON es obligatorio para identificar tu cuenta.",
      concepts: ["memo"],
      options: () => [
        { value: "required_included", label: "Lo pidió y lo incluí" },
        { value: "required_missing", label: "Lo pidió y no lo incluí" },
        { value: "not_required", label: "No pidió ninguno" },
        { value: UNKNOWN, label: "No lo sé" },
      ],
    },
    {
      id: "provider_status",
      type: "choice",
      applies: (a) => ["exchange_withdrawal", "exchange_deposit", "bridge", "onramp"].includes(a.flow),
      prompt: () => "¿Qué estado muestra la plataforma o el puente para la operación?",
      help: () => "El estado que ve el proveedor nos indica si la operación ya salió a la red o sigue dentro de sus sistemas.",
      concepts: ["custodia"],
      options: () => [
        { value: "completed_sent", label: "Completada / enviada" },
        { value: "processing", label: "En proceso / pendiente" },
        { value: "review", label: "En revisión (seguridad, verificación)" },
        { value: "rejected", label: "Rechazada / cancelada / fallida" },
        { value: "no_info", label: "No muestra ningún estado" },
      ],
    },
    {
      id: "viewing_network",
      type: "choice",
      applies: (a) => a.flow !== "exchange_deposit" && ["not_arrived", "not_visible", "cannot_use"].includes(a.symptom),
      prompt: () => "¿En qué red estás mirando tu saldo en la wallet?",
      help: () => "Las wallets muestran el saldo red por red: mirar la red equivocada es una causa muy común de «no llegó».",
      concepts: ["tokens_no_visibles", "red"],
      options: () => K.networkOptions(),
    },
    {
      id: "tx_hash",
      type: "hash",
      optional: true,
      placeholder: "0x… o enlace de Etherscan / Polygonscan / etc.",
      prompt: (a) => (a.flow === "exchange_deposit" ? "¿Tienes el hash (TxID) del envío? Pégalo o pega el enlace del explorador." : "¿Tienes el hash (TxID) de la transacción? Pégalo o pega el enlace del explorador."),
      help: () => "Es lo más importante: con el hash verificamos en la red qué pasó realmente, en lugar de basarnos solo en lo que recuerdas o lo que dice una app.",
      concepts: ["hash", "explorador"],
    },
  ];

  const BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  const applies = (q, answers) => (q.applies ? q.applies(answers) : true);

  function applicableQuestions(answers) {
    return QUESTIONS.filter((q) => applies(q, answers));
  }
  function nextQuestion(answers) {
    for (const q of QUESTIONS) {
      if (applies(q, answers) && answers[q.id] === undefined) return q;
    }
    return null;
  }
  function progress(answers) {
    const list = applicableQuestions(answers);
    const answered = list.filter((q) => answers[q.id] !== undefined).length;
    return { answered, total: list.length };
  }
  /** Elimina respuestas de preguntas que dejaron de aplicar tras un cambio (hasta estabilizar). */
  function pruneAnswers(answers) {
    const out = { ...answers };
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of QUESTIONS) {
        if (out[q.id] !== undefined && !applies(q, out)) {
          delete out[q.id];
          if (q.id === "tx_hash") delete out.tx_chain_hint;
          changed = true;
        }
      }
    }
    return out;
  }

  function parseAmount(raw) {
    let s = String(raw).trim().replace(/\s+/g, "").replace(/^[$€]/, "");
    if (!s) return null;
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");
    if (hasDot && hasComma) {
      const decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
      const thousandSep = decimalSep === "." ? "," : ".";
      s = s.split(thousandSep).join("").replace(decimalSep, ".");
    } else if (hasComma) {
      s = (s.match(/,/g) || []).length > 1 ? s.split(",").join("") : s.replace(",", ".");
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.split(".").join("");
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s) > 0 ? s : null;
  }

  /**
   * @returns {{ok:boolean, value?:any, extra?:object, note?:object, error?:string}}
   */
  function validateAnswer(id, raw, answers) {
    const q = BY_ID[id];
    if (!q) return { ok: false, error: "Pregunta desconocida." };
    const ctx = answers || {};
    if (raw === SKIP) {
      return q.optional ? { ok: true, value: null } : { ok: false, error: "Esta pregunta es necesaria para poder evaluar la operación." };
    }
    switch (q.type) {
      case "choice": {
        const option = q.options(ctx).find((o) => o.value === raw || o.label === raw);
        return option ? { ok: true, value: option.value } : { ok: false, error: "Elige una de las opciones." };
      }
      case "text": {
        const text = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
        if (!text) return q.optional ? { ok: true, value: null } : { ok: false, error: "Escribe una respuesta." };
        return { ok: true, value: text.slice(0, 80) };
      }
      case "number": {
        const n = parseAmount(raw);
        return n ? { ok: true, value: n } : { ok: false, error: "Escribe un monto válido, por ejemplo 250 o 0,5." };
      }
      case "address": {
        const text = String(raw == null ? "" : raw).trim();
        if (!text) return { ok: true, value: null };
        const cls = K.classifyAddress(text);
        const note = K.explainAddressInput(cls);
        let value = text;
        if (cls.kind === "evm" || cls.kind === "evm_missing_prefix") value = cls.address;
        return { ok: true, value, note: note || undefined, extra: { dst_address_kind: cls.kind } };
      }
      case "hash": {
        const text = String(raw == null ? "" : raw).trim();
        if (!text) return { ok: true, value: null };
        const cls = K.classifyTxInput(text);
        const note = K.explainTxInput(cls);
        if (cls.kind === "evm_tx" || cls.kind === "explorer_url" || cls.kind === "hash_without_prefix") {
          return { ok: true, value: cls.hash, note: note || undefined, extra: { tx_chain_hint: cls.chain || null } };
        }
        return { ok: false, error: note ? `${note.title}. ${note.detail}` : "Hash no válido.", note };
      }
      default:
        return { ok: false, error: "Tipo de pregunta no soportado." };
    }
  }

  /** Aplica una respuesta, poda lo que dejó de aplicar y devuelve el nuevo estado. */
  function applyAnswer(answers, id, raw) {
    const result = validateAnswer(id, raw, answers);
    if (!result.ok) return { answers, result };
    let next = { ...answers, [id]: result.value, ...(result.extra || {}) };
    next = pruneAnswers(next);
    return { answers: next, result };
  }

  /** Texto legible de las respuestas (para mostrar «lo que nos contaste»). */
  function describeAnswers(answers) {
    const rows = [];
    for (const q of applicableQuestions(answers)) {
      const value = answers[q.id];
      if (value === undefined) continue;
      let shown;
      if (value === null) shown = "No indicado";
      else if (q.type === "choice") {
        const o = q.options(answers).find((x) => x.value === value);
        shown = o ? o.label : String(value);
      } else shown = String(value);
      rows.push({ id: q.id, question: q.prompt(answers), answer: shown });
    }
    return rows;
  }

  Object.assign(K, { SKIP, UNKNOWN, QUESTIONS, nextQuestion, applicableQuestions, progress, pruneAnswers, parseAmount, validateAnswer, applyAnswer, describeAnswers });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
