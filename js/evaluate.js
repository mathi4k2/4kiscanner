/* 4kiscan · evaluate.js
 * Evaluador imparcial. Función pura: evaluate(respuestas, evidencia) → resultado.
 *
 * Principios:
 *  - Cada afirmación lleva su origen: «verificado» (red), «declarado» (cliente)
 *    o «inferido». Nunca se presenta lo declarado como comprobado.
 *  - No se atribuye responsabilidad sin evidencia. Un fallo de consulta es
 *    «no determinado», jamás «los fondos no existen».
 *  - Los tiempos son umbrales orientativos, no promesas de ningún proveedor.
 * Depende de util, data, providers, concepts, diagnose y evidence.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const t = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

  const lower = (v) => String(v == null ? "" : v).toLowerCase();
  const uniq = (list) => [...new Set(list.filter(Boolean))];
  const SOURCE_FLOWS = ["exchange_withdrawal", "exchange_deposit", "wallet_transfer"];

  // ───────────── Utilidades de texto ─────────────
  function explorerTx(chain, hash) {
    return K.CHAINS[chain] && hash ? `${K.CHAINS[chain].explorer}/tx/${hash}` : null;
  }
  function humanDuration(minutes) {
    if (!Number.isFinite(minutes)) return t("más de lo indicado", "longer than indicated", "mais do que o indicado");
    if (minutes < 1) return t("menos de 1 minuto", "less than 1 minute", "menos de 1 minuto");
    if (minutes < 90) return `${Math.round(minutes)} ${t("minutos", "minutes", "minutos")}`;
    if (minutes < 48 * 60) return `${Math.round(minutes / 60)} ${t("horas", "hours", "horas")}`;
    return `${Math.round(minutes / (24 * 60))} ${t("días", "days", "dias")}`;
  }
  function providerStatusText(status) {
    const values = {
      completed_sent: ["completada / enviada", "completed / sent", "concluída / enviada"],
      processing: ["en proceso", "processing", "em andamento"],
      review: ["en revisión", "under review", "em análise"],
      rejected: ["rechazada o cancelada", "rejected or cancelled", "rejeitada ou cancelada"],
      no_info: ["sin estado visible", "no visible status", "sem status visível"],
    };
    const value = values[status];
    return value ? value[locale() === "en" ? 1 : locale() === "pt" ? 2 : 0] : status;
  }
  const FACT_LABELS = {
    Operación: ["Operation", "Operação"], Proveedor: ["Provider", "Provedor"], Activo: ["Asset", "Ativo"],
    Monto: ["Amount", "Valor"], "Red de envío": ["Sending network", "Rede de envio"],
    "Red esperada": ["Expected network", "Rede esperada"], "Dirección de destino": ["Destination address", "Endereço de destino"],
    "Estado en el proveedor": ["Provider status", "Status no provedor"], "Red de la transacción": ["Transaction network", "Rede da transação"],
    Estado: ["Status", "Status"], Bloque: ["Block", "Bloco"], Remitente: ["Sender", "Remetente"],
    "Contrato / receptor": ["Contract / recipient", "Contrato / destinatário"], "Activos movidos": ["Assets moved", "Ativos transferidos"],
    "Puente / router reconocido": ["Recognized bridge / router", "Ponte / roteador reconhecido"],
    "Momento del envío": ["Time sent", "Horário do envio"], "Entrada hallada en": ["Incoming transfer found on", "Entrada encontrada em"],
    "Red del hash": ["Hash network", "Rede do hash"],
  };
  const factLabel = (label) => locale() === "es" ? label : FACT_LABELS[label] ? FACT_LABELS[label][locale() === "en" ? 0 : 1] : label;

  // ───────────── Contexto derivado ─────────────
  function elapsedRange(A, E) {
    const D = E.diagnosis;
    if (D && Number.isFinite(D.originTimestamp)) {
      const m = Math.max(0, (E.nowSeconds - D.originTimestamp) / 60);
      return { min: m, max: m, basis: "chain" };
    }
    const b = K.ELAPSED_BUCKETS[A.elapsed];
    return b ? { min: b[0], max: b[1], basis: "declared" } : null;
  }

  function buildContext(A, E) {
    const D = E.diagnosis || null;
    const R = E.radar || null;
    const issueIds = new Set(D ? D.issues.map((i) => i.id) : []);
    const has = (id) => issueIds.has(id);

    let txState = "none";
    if (D) {
      if (D.statusCode === "ORIGIN_FAILED") txState = "failed";
      else if (D.statusCode === "ORIGIN_PENDING") txState = has("origin_replaced") ? "replaced" : "pending";
      else txState = "success";
    }

    const bridgeEntries = D ? D.bridgeMatches.filter((m) => m.category === "bridge") : [];
    const provider = K.findProvider(A.provider);
    const protocol = (bridgeEntries[0] && bridgeEntries[0].protocol) || (provider && provider.protocol) || null;

    // ¿Llegó? (solo con evidencia de la red)
    let delivery = "unknown";
    let deliveryChain = null;
    let deliveryHash = null;
    if (txState === "success") {
      if (R && R.state === "found" && !R.fallbackMatch) {
        delivery = "expected";
        deliveryChain = R.matchedChain;
        deliveryHash = R.transfer && R.transfer.hash;
      } else if (R && R.state === "found" && R.fallbackMatch) {
        delivery = "other_network";
        deliveryChain = R.matchedChain;
        deliveryHash = R.transfer && R.transfer.hash;
      } else if (!R && D.statusCode === "DESTINATION_CREDIT_FOUND") {
        delivery = "expected";
        deliveryChain = D.chain;
        deliveryHash = D.txHash;
      } else if (R && R.state === "no_match_global") delivery = "not_found";
      else if (R && (R.state === "candidates" || R.state === "incomplete")) delivery = "candidates";
      else if (R && ["fallback_incomplete", "error", "waiting_for_destination_chain"].includes(R.state)) delivery = "search_incomplete";
    }
    const I = E.inbound || null;
    let inboundState = null;
    if (!D && I) {
      if (I.state === "found") inboundState = I.fallbackMatch ? "found_other" : "found";
      else if (I.state === "no_match_global") inboundState = "none";
      else inboundState = "incomplete";
    }

    const src = D ? D.chain : K.CHAINS[A.src_network] ? A.src_network : A.src_network || null;
    const dst = deliveryChain || (K.CHAINS[A.dst_network] ? A.dst_network : A.dst_network || null);
    const timing = K.timingProfile({ flow: A.flow, protocol, src, dst });
    const elapsed = elapsedRange(A, E);
    let timingStatus = "unknown";
    if (timing.thresholdMinutes && elapsed) {
      if (elapsed.max <= timing.thresholdMinutes) timingStatus = "within";
      else if (elapsed.min >= timing.thresholdMinutes) timingStatus = "beyond";
      else timingStatus = "uncertain";
    }

    const srcKind = K.networkKind(A.src_network);
    const dstKind = K.networkKind(A.dst_network);
    const declaredMismatch =
      SOURCE_FLOWS.includes(A.flow) && srcKind !== "unknown" && dstKind !== "unknown" && A.src_network !== A.dst_network;

    const addrCls = E.addrClass || null;
    const addressProblem =
      addrCls && !["evm", "evm_missing_prefix"].includes(addrCls.kind) ? addrCls.kind : null;
    const addrNet = addrCls ? K.addressMatchesNetwork(addrCls.kind, A.dst_network) : null;

    return { A, E, D, R, I, has, txState, provider, protocol, delivery, deliveryChain, deliveryHash, inboundState, timing, elapsed, timingStatus, src, dst, srcKind, dstKind, declaredMismatch, addrCls, addressProblem, addrNet };
  }

  function assetText(ctx) {
    const { A, D } = ctx;
    if (D && D.originAssets.length) {
      return uniq(D.originAssets.map((a) => `${a.amount} ${a.symbol}`)).join(" + ");
    }
    if (A.asset && A.amount) return `${A.amount} ${A.asset === "OTHER" ? A.asset_other || "token" : A.asset}`;
    if (A.asset && A.asset !== "OTHER") return A.asset;
    return t("los fondos", "the funds", "os fundos");
  }

  // ───────────── Checklist ─────────────
  function buildChecks(ctx) {
    const { A, E, D, R } = ctx;
    const checks = [];
    const add = (id, area, status, title, detail, extra) =>
      checks.push({ id, area, status, title, detail, basis: "declared", owner: "unknown", concepts: [], ...(extra || {}) });

    // ── Red elegida vs red esperada (declarado) ──
    if (SOURCE_FLOWS.includes(A.flow)) {
      if (ctx.srcKind === "unknown" || ctx.dstKind === "unknown") {
        add("network_choice", "red", "unknown", "No se puede comparar la red de envío con la esperada", "Falta saber una de las dos redes, por lo que no se puede confirmar que coincidan.", { concepts: ["red"] });
      } else if (A.src_network === A.dst_network) {
        add("network_choice", "red", "ok", `La red de envío coincide con la esperada (${A.src_network})`, "Según lo que indicaste, enviaste por la misma red que esperaba el destino.", { concepts: ["red"] });
      } else {
        add("network_choice", "red", "problem", `Enviaste por ${A.src_network}, pero el destino esperaba ${A.dst_network}`, "Las redes son sistemas independientes: un envío por una red no llega a otra. Los fondos no desaparecen, pero quedan en la red por la que se enviaron.", { owner: "client", concepts: ["red", "direccion_evm", "irreversible"] });
      }
    } else if (A.flow === "bridge" && ctx.srcKind !== "unknown" && ctx.dstKind !== "unknown") {
      if (A.src_network === A.dst_network) {
        add("network_choice", "red", "problem", "El origen y el destino son la misma red", "Un puente sirve para cambiar de red. Con la misma red de origen y destino no se trata de un puente (quizá un swap o una transferencia).", { owner: "client", concepts: ["bridge", "swap"] });
      } else {
        add("network_choice", "red", "ok", `Ruta de puente: ${A.src_network} → ${A.dst_network}`, "Las redes de origen y destino son distintas, como corresponde a un puente.", { concepts: ["bridge"] });
      }
    }

    // ── Redes que esta herramienta no puede verificar ──
    const unverifiable = [A.src_network, A.dst_network].filter((n) => ["unsupported_evm", "non_evm"].includes(K.networkKind(n)));
    if (unverifiable.length) {
      add("network_not_verifiable", "red", "info", `No se puede verificar en cadena la red ${uniq(unverifiable).join(" / ")}`, "Esta herramienta solo consulta Ethereum, Polygon, Optimism, Arbitrum y Base. Lo relativo a esas otras redes se evalúa únicamente con lo que declaraste; el explorador de esa red es la fuente para confirmarlo.", { concepts: ["red", "no_evm"] });
    }

    // ── Dirección ──
    if (!ctx.addrCls) {
      add("address_format", "direccion", "unknown", "No se indicó la dirección de destino", "Sin la dirección no se puede comprobar quién recibió los fondos ni buscar la entrada en la wallet.", { concepts: ["direccion_evm"] });
    } else {
      const k = ctx.addrCls.kind;
      if (k === "evm") add("address_format", "direccion", "ok", "La dirección tiene un formato válido", "Es una dirección EVM bien formada (y, si mezcla mayúsculas y minúsculas, su checksum es correcto).", { concepts: ["checksum"] });
      else if (k === "evm_missing_prefix") add("address_format", "direccion", "warning", "A la dirección le faltaba el prefijo 0x", "Se asumió 0x + los 40 caracteres que indicaste.", { concepts: ["direccion_evm"] });
      else if (k === "evm_bad_checksum") add("address_format", "direccion", "problem", "La dirección tiene un error de escritura (checksum inválido)", `Mezcla mayúsculas y minúsculas pero no cumple el checksum EIP-55: hay al menos un carácter mal copiado. Con el checksum correcto sería ${ctx.addrCls.checksum}.`, { owner: "client", concepts: ["checksum", "irreversible"] });
      else if (k === "evm_zero" || k === "evm_burn") add("address_format", "direccion", "problem", "La dirección es una dirección de quema", "Los fondos enviados a esa dirección quedan inaccesibles de forma permanente.", { owner: "client", concepts: ["irreversible"] });
      else {
        const d = K.explainAddressInput(ctx.addrCls);
        add("address_format", "direccion", "problem", d ? d.title : "Formato de dirección no válido", d ? d.detail : "No es una dirección EVM válida.", { owner: "client", concepts: ["direccion_evm", "no_evm"] });
      }
      if (ctx.addrNet === false) {
        add("address_network", "direccion", "problem", `El formato de la dirección no corresponde a la red ${A.dst_network}`, "Cada red usa su propio formato: una dirección 0x… solo sirve en redes EVM y una dirección Tron, Bitcoin o Solana solo en su red. Mezclarlos es una causa típica de envíos fallidos o perdidos.", { owner: "client", concepts: ["direccion_evm", "no_evm", "red"] });
      } else if (ctx.addrNet === true) {
        add("address_network", "direccion", "ok", `El formato de la dirección es coherente con ${A.dst_network}`, "El tipo de dirección corresponde a la red indicada.", { concepts: ["direccion_evm"] });
      }
    }
    if (A.addr_source === "history" || A.addr_source === "typed") {
      add("address_source", "seguridad", "warning", A.addr_source === "history" ? "La dirección se tomó del historial o de contactos" : "La dirección se escribió a mano", A.addr_source === "history" ? "Copiar desde el historial es la vía del «envenenamiento de direcciones»: direcciones casi idénticas pueden aparecer allí. Conviene comparar la dirección completa con la fuente original." : "Escribir una dirección a mano es propenso a errores de tipeo; copiar y pegar desde la fuente es más seguro.", { concepts: ["address_poisoning", "checksum"] });
    } else if (A.addr_source === "third_party") {
      add("address_source", "seguridad", "warning", "La dirección te la pasó otra persona", "Una dirección recibida por mensaje no se puede verificar por sí sola. Confirma con la plataforma oficial que sea la correcta.", { concepts: ["address_poisoning"] });
    }

    // ── Estado en la red ──
    if (A.tx_hash) {
      if (D) {
        const link = explorerTx(D.chain, D.txHash);
        if (ctx.txState === "success") add("onchain_status", "onchain", "ok", `La transacción existe y tuvo éxito en ${D.chain}`, `Bloque ${D.blockNumber}${link ? `. Verifícala en el explorador: ${link}` : ""}.`, { basis: "chain", concepts: ["hash", "explorador"] });
        else if (ctx.txState === "failed") add("onchain_status", "onchain", "problem", `La transacción falló en ${D.chain}`, "La red la registró como fallida: no se movieron los fondos principales.", { basis: "chain", concepts: ["gas"] });
        else if (ctx.txState === "replaced") add("onchain_status", "onchain", "problem", "La transacción fue reemplazada o descartada", "La cuenta ya usó ese nonce en otra transacción; esta nunca se confirmará.", { basis: "chain", concepts: ["nonce"] });
        else add("onchain_status", "onchain", "warning", "La transacción sigue pendiente", "Todavía no está incluida en un bloque.", { basis: "chain", concepts: ["nonce", "gas"] });
      } else if (E.detect && E.detect.state === "not_found") {
        add("onchain_status", "onchain", ["unsupported_evm", "non_evm"].includes(ctx.srcKind) ? "info" : "warning", "El hash no aparece en ninguna de las 5 redes consultadas", ["unsupported_evm", "non_evm"].includes(ctx.srcKind) ? `Es coherente con que la operación se haya hecho por ${A.src_network}, una red que esta herramienta no consulta.` : "Puede estar mal copiado, ser muy reciente, o pertenecer a una red no consultada.", { basis: "chain", concepts: ["hash", "red"] });
      } else if (E.skipped === "no_key" || E.errors.length) {
        add("onchain_status", "onchain", "unknown", "No se pudo consultar la transacción en la red", E.skipped === "no_key" ? "Falta la API key de Alchemy en «Configuración»." : `Falló la consulta (${E.errors[0].message}). Esto no indica nada sobre tus fondos.`, { basis: "chain" });
      }
    } else {
      add("onchain_status", "onchain", "unknown", "No hay hash para verificar la transacción", "Sin el hash solo se puede basar la evaluación en lo que declaraste. Pídelo a la plataforma (suele llamarse TxID).", { concepts: ["hash"] });
    }

    // ── Hallazgos on-chain del diagnóstico ──
    const SKIP = new Set(["origin_failed", "origin_replaced", "origin_pending", "unverified_catalog_match"]);
    if (D) {
      for (const issue of D.issues) {
        if (SKIP.has(issue.id)) continue;
        const status = { critical: "problem", error: "problem", warn: "warning", info: "info", ok: "ok" }[issue.severity];
        const owner = ["burn_target", "burn_recipient", "address_poisoning", "address_typo", "sent_to_token_contract", "recipient_mismatch", "wrong_network_delivery", "dex_not_bridge"].includes(issue.id) ? "client" : "unknown";
        const concepts = {
          address_poisoning: ["address_poisoning", "irreversible"],
          address_typo: ["checksum", "irreversible"],
          burn_target: ["irreversible"],
          burn_recipient: ["irreversible"],
          sent_to_token_contract: ["token_contrato", "irreversible"],
          recipient_mismatch: ["irreversible", "custodia"],
          wrong_network_delivery: ["red", "direccion_evm"],
          dex_not_bridge: ["swap", "bridge"],
          approval_only: ["aprobacion"],
          contract_wallet_missing_on_destination: ["wallet_contrato"],
          destination_is_contract: ["wallet_contrato"],
          recipient_is_contract: ["wallet_contrato"],
          l2_withdrawal_delay: ["retiro_l2"],
          token_variant: ["usdc_e", "token_contrato"],
          unknown_token: ["token_contrato"],
          no_assets_moved: ["explorador"],
        }[issue.id] || [];
        const translatedIssue = localizeDiagnosisIssue(issue);
        add(`chain_${issue.id}`, "onchain", status, translatedIssue.title, `${translatedIssue.detail}${translatedIssue.action ? ` ${translatedIssue.action}` : ""}`, { basis: "chain", owner, concepts, issueId: issue.id });
      }
    }

    // ── Activo y monto ──
    if (D && D.originAssets.length && A.asset) {
      const declared = A.asset === "OTHER" ? null : A.asset;
      const observed = D.originAssets;
      const match = observed.find((o) => {
        if (declared) return o.assetId === declared || o.assetId === `native:${declared}`;
        const label = K.normalizeAssetLabel(A.asset_other);
        return !!label && K.assetLabels(o).has(label);
      });
      if (match) {
        add("asset_match", "activo", "ok", `El activo coincide con lo declarado (${declared || A.asset_other})`, `En la red se movió ${assetText(ctx)}.`, { basis: "chain", concepts: ["token_contrato"] });
        if (A.amount && Number.isFinite(Number(match.amount)) && Number(match.amount) > 0) {
          const diff = Math.abs(Number(match.amount) - Number(A.amount)) / Number(A.amount);
          if (diff <= 0.01) add("amount_match", "activo", "ok", "El monto coincide con lo declarado", `Declaraste ${A.amount} y en la red se movió ${match.amount}.`, { basis: "chain" });
          else add("amount_match", "activo", "warning", "El monto observado es distinto del declarado", `Declaraste ${A.amount}, pero la transacción movió ${match.amount}. Puede haber más de una transacción, comisiones descontadas o un dato mal recordado.`, { basis: "chain", concepts: ["slippage"] });
        }
      } else if (A.asset !== "OTHER" || A.asset_other) {
        add("asset_match", "activo", "problem", "El activo que se movió no coincide con el declarado", `Indicaste ${declared || A.asset_other}, pero en la red se movió ${assetText(ctx)}. Si la plataforma de destino solo acepta el activo indicado, puede no acreditarlo.`, { basis: "chain", owner: "client", concepts: ["token_contrato", "usdc_e"] });
      }
    }

    // ── Comisión / diferencia de monto recibido ──
    if (R && R.state === "found" && R.transfer) {
      const t = R.transfer;
      if ((R.matchType || t.matchType) === "swap") {
        add("fee_difference", "activo", "info", `Se recibió el equivalente a ${t.efficiencyPercent}% del valor enviado (estimado en USD)`, `Estimación con precios históricos de DefiLlama (no es una cotización de ejecución): se enviaron ${t.originAmount} ${t.originSymbol} y se recibieron ${t.destinationAmount} ${t.destinationSymbol}.`, { basis: "chain", concepts: ["slippage", "swap"] });
      } else if (t.feePercent !== undefined) {
        const fee = Number(t.feePercent);
        add("fee_difference", "activo", fee <= 3 ? "ok" : "warning", `Diferencia entre lo enviado y lo recibido: ${t.feePercent}%`, fee <= 3 ? "Una diferencia pequeña es habitual por comisiones del servicio o del puente. Es una estimación aritmética, no la tarifa oficial." : "Es mayor a lo habitual; conviene revisar la comisión que mostró el servicio al confirmar.", { basis: "chain", concepts: ["slippage"] });
      }
    }

    // ── Entrega ──
    const destLabel = A.dst_network && A.dst_network !== "unknown" ? A.dst_network : "la red de destino";
    if (ctx.delivery === "expected") {
      add("delivery", "entrega", "ok", `La red muestra que los fondos llegaron a la wallet en ${ctx.deliveryChain}`, `Hay una entrada compatible (wallet, activo y monto).${ctx.deliveryHash ? ` Hash: ${ctx.deliveryHash}.` : ""}`, { basis: "chain", concepts: ["explorador"] });
    } else if (ctx.delivery === "other_network") {
      add("delivery", "entrega", "warning", `Los fondos aparecen en ${ctx.deliveryChain}, no en ${destLabel}`, `La búsqueda encontró una entrada compatible en otra red.${ctx.deliveryHash ? ` Hash: ${ctx.deliveryHash}.` : ""}`, { basis: "chain", concepts: ["red"] });
    } else if (ctx.delivery === "not_found") {
      add("delivery", "entrega", "warning", "No se encontró una entrada compatible en ninguna red", `Se buscó en las ${R.searchedNetworks ? R.searchedNetworks.length : 5} redes soportadas dentro de las ventanas inspeccionadas (hasta 48 h tras el envío). Esto no prueba que la entrega haya fallado: puede estar todavía en curso.`, { basis: "chain", concepts: ["bridge"] });
    } else if (ctx.delivery === "candidates") {
      add("delivery", "entrega", "warning", "Hay entradas a la wallet, pero ninguna coincide con la operación", "Se encontraron transferencias entrantes, pero ninguna cumple el rango de monto del mismo activo ni el de valor de un swap. No se puede confirmar la entrega.", { basis: "chain" });
    } else if (ctx.delivery === "search_incomplete") {
      add("delivery", "entrega", "unknown", "La búsqueda de la entrega no pudo completarse", "Una consulta falló o la red de destino aún no avanzó lo suficiente. No se puede concluir que los fondos no hayan llegado.", { basis: "chain" });
    } else if (R && R.state === "error") {
      add("delivery", "entrega", "unknown", "No se pudo buscar la entrega en destino", R.error, { basis: "chain" });
    } else if (E.radarSkipped === "dst_network_unsupported") {
      add("delivery", "entrega", "unknown", "La entrega no se puede buscar en cadena en esa red", "La red de destino no está entre las consultables (Ethereum, Polygon, Optimism, Arbitrum, Base).", { concepts: ["no_evm"] });
    } else if (E.radarSkipped === "no_wallet" && D) {
      add("delivery", "entrega", "unknown", "No se puede buscar la entrega sin la dirección de destino", "Indica la dirección de la wallet para poder buscar la entrada en la red.", { concepts: ["direccion_evm"] });
    }
    if (ctx.inboundState === "found" || ctx.inboundState === "found_other") {
      const t = E.inbound.transfer;
      add("delivery", "entrega", ctx.inboundState === "found" ? "ok" : "warning", `Se encontró una entrada compatible en ${E.inbound.matchedChain}`, `Coincide por wallet${E.inboundMatchedByDeclared ? ", activo y monto declarados" : ""}, en las últimas 24 h.${t && t.hash ? ` Hash: ${t.hash}.` : ""} Es una correlación, no una prueba de que sea la operación que hiciste.`, { basis: "chain", concepts: ["explorador"] });
    } else if (ctx.inboundState === "none") {
      add("delivery", "entrega", "info", "No se encontraron entradas compatibles a la wallet en las últimas 24 h", "Se buscó en las 5 redes soportadas. Sin el hash no se puede saber si la operación aún está en curso o no llegó.", { basis: "chain" });
    } else if (ctx.inboundState === "incomplete") {
      add("delivery", "entrega", "unknown", "La búsqueda de entradas recientes no pudo completarse", "Una o más redes no respondieron, por lo que no se puede concluir.", { basis: "chain" });
    }

    // ── LI.FI ──
    if (E.lifi && E.lifi.available) {
      const s = E.lifi.status;
      const text = { DONE: "completada", PENDING: "en curso", FAILED: "fallida", NOT_FOUND: "no encontrada", INVALID: "inválida" }[s] || s;
      add("lifi_status", "entrega", s === "DONE" ? "ok" : s === "FAILED" ? "problem" : "info", `Estado de la ruta según LI.FI: ${text}${E.lifi.substatus ? ` (${E.lifi.substatus})` : ""}`, `${E.lifi.tool ? `Puente utilizado: ${E.lifi.tool}. ` : ""}${E.lifi.receivingTxHash ? `Hash en destino: ${E.lifi.receivingTxHash}.` : "Todavía no informa hash en destino."} Es un dato de un servicio externo, útil como segunda fuente.`, { basis: "chain", concepts: ["bridge"] });
    }

    // ── Tiempo ──
    if (ctx.timing.thresholdMinutes && ctx.elapsed && ctx.txState !== "failed" && ctx.delivery !== "expected") {
      const basis = ctx.elapsed.basis;
      const spent = ctx.elapsed.basis === "chain" ? humanDuration(ctx.elapsed.min) : null;
      if (ctx.timingStatus === "within") add("timing", "tiempo", "info", `Todavía es un tiempo normal para ${ctx.timing.label.toLowerCase()}`, `Lo habitual es ${ctx.timing.expected}.${spent ? ` Han pasado ${spent}.` : ""} Es una referencia orientativa, no una garantía del proveedor.`, { basis, concepts: ctx.timing.concepts });
      else if (ctx.timingStatus === "beyond") add("timing", "tiempo", "warning", `Pasó más tiempo del habitual para ${ctx.timing.label.toLowerCase()}`, `Lo habitual es ${ctx.timing.expected}.${spent ? ` Han pasado ${spent}.` : ""} Es una referencia orientativa: una demora mayor merece consultar al proveedor.`, { basis, concepts: ctx.timing.concepts });
      else if (ctx.timingStatus === "uncertain") add("timing", "tiempo", "info", "El tiempo transcurrido está cerca del límite habitual", `Lo habitual para ${ctx.timing.label.toLowerCase()} es ${ctx.timing.expected}. Con el hash se calcula el tiempo exacto.`, { basis, concepts: ctx.timing.concepts });
    }

    // ── Proveedor ──
    if (A.provider_status) {
      const st = A.provider_status;
      const pl = ctx.provider ? ctx.provider.label : "El proveedor";
      if (st === "completed_sent") {
        add("provider_status", "proveedor", A.tx_hash ? "info" : "warning", `${pl} indica que la operación está completada/enviada`, A.tx_hash ? "Eso debería corresponder a una transacción en la red; el hash permite confirmarlo." : "Si ya la envió, debe existir una transacción en la red: pídele el hash (TxID) para poder verificar adónde fue.", { concepts: ["hash", "custodia"] });
      } else if (st === "processing") {
        add("provider_status", "proveedor", ctx.timingStatus === "beyond" ? "warning" : "info", `${pl} muestra la operación en proceso`, "Mientras esté en proceso en sus sistemas, puede no existir aún una transacción en la red.", { concepts: ["custodia"] });
      } else if (st === "review") {
        add("provider_status", "proveedor", "info", `${pl} tiene la operación en revisión`, "Las revisiones de seguridad o verificación las hace el proveedor y no dependen de la red ni de ti; el soporte del proveedor es quien puede informar el motivo y el plazo.", { owner: "provider", concepts: ["custodia"] });
      } else if (st === "rejected") {
        add("provider_status", "proveedor", "info", `${pl} muestra la operación como rechazada o cancelada`, "Normalmente, si no llegó a salir a la red, los fondos permanecen o se reintegran a la cuenta de origen. Confirma el saldo en el origen.", { owner: "provider", concepts: ["custodia"] });
      } else if (st === "no_info") {
        add("provider_status", "proveedor", "unknown", "El proveedor no muestra ningún estado", "Sin estado visible no se puede saber si la operación llegó a salir; el soporte del proveedor puede confirmarlo.", { concepts: ["custodia"] });
      }
    }

    // ── Memo ──
    if (A.memo === "required_missing") add("memo", "red", "problem", "Faltó el memo / tag obligatorio", "Sin el memo, el exchange recibe los fondos pero no sabe a qué cuenta acreditarlos. Suele resolverse con soporte, aportando el hash.", { owner: "client", concepts: ["memo"] });
    else if (A.memo === "required_included") add("memo", "red", "ok", "El memo / tag se incluyó", "Según lo declarado, se incluyó el identificador de cuenta requerido.", { concepts: ["memo"] });

    // ── Exchange: acreditación de un depósito ya llegado ──
    if (A.flow === "exchange_deposit" && ctx.delivery === "expected") {
      add("exchange_credit", "proveedor", "info", "En la red el depósito llegó a la dirección indicada", "Si la plataforma no lo muestra, el motivo está en cómo la plataforma lo acredita: confirmaciones requeridas, monto mínimo, activo y red aceptados, o depósitos hechos desde contratos. Eso solo lo puede confirmar su soporte.", { basis: "chain", owner: "provider", concepts: ["confirmaciones", "deposito_minimo", "deposito_contrato", "custodia"] });
    }

    // ── Dónde mira el saldo ──
    if (A.viewing_network && ctx.deliveryChain) {
      const vn = A.viewing_network;
      if (K.networkKind(vn) === "supported" && vn !== ctx.deliveryChain) {
        add("viewing_network", "visibilidad", "problem", `Estás mirando ${vn}, pero los fondos están en ${ctx.deliveryChain}`, "Las wallets muestran el saldo red por red. Cambia a la red donde están los fondos para verlos.", { owner: "client", concepts: ["tokens_no_visibles", "red"] });
      } else if (vn === ctx.deliveryChain && ["not_visible", "not_arrived"].includes(A.symptom)) {
        add("viewing_network", "visibilidad", "info", `Estás mirando la red correcta (${vn}) y aun así no ves el saldo`, "Si el explorador muestra el token en tu dirección, la wallet puede no estar mostrándolo: agrega el contrato del token manualmente o revisa los tokens ocultos.", { concepts: ["tokens_no_visibles", "token_contrato"] });
      }
    }

    // ── Origen del pedido ──
    if (A.third_party === "yes") {
      add("third_party", "seguridad", "warning", "Alguien te indicó hacer este envío", "Es un patrón frecuente en estafas (supuestos asesores, inversiones, premios, soporte que contacta primero). No se puede afirmar que lo sea en tu caso, pero conviene no enviar más fondos hasta verificar con la plataforma oficial.", { concepts: ["irreversible"] });
    }
    return checks;
  }

  // ───────────── Veredictos ─────────────
  const tx = (ctx) => (ctx.D ? K.shortHash(ctx.D.txHash) : "");

  function walletHint(ctx) {
    const fl = ctx.A.flow;
    return fl === "exchange_deposit" ? "la dirección de depósito de la plataforma" : "tu wallet";
  }

  const VERDICTS = {
    ORIGIN_FAILED: (c) => ({
      level: "problem",
      headline: "La transacción falló: no salieron los fondos",
      happened: `La transacción ${tx(c)} se registró en ${c.D.chain} como fallida. Una transacción fallida no mueve los fondos principales: siguen en la wallet o cuenta de origen.`,
      why: `No llegaron porque nunca se enviaron. Lo único que se pierde es el gas ya consumido${c.D.feePaid ? ` (≈ ${c.D.feePaid})` : ""}.`,
      recover: { level: "none_needed", text: "No hay fondos que recuperar: están en origen." },
      rating: "undetermined",
      ratingText: "La operación no se completó. Los motivos típicos son saldo o gas insuficiente, un permiso (approve) faltante o parámetros como slippage; el detalle del motivo figura en los hallazgos si la red lo informó.",
      steps: ["Confirma en tu wallet que el saldo sigue en origen.", "Reintenta con gas suficiente y revisa permisos y parámetros del intercambio o puente."],
      concepts: ["gas", "aprobacion"],
    }),
    ORIGIN_REPLACED: (c) => ({
      level: "attention",
      headline: "La transacción fue reemplazada o descartada",
      happened: `La cuenta ya usó el mismo nonce en otra transacción, por lo que ${tx(c)} nunca se confirmará.`,
      why: "Por esta transacción no salió ningún fondo. Puede ser una cancelación o una aceleración con otro hash.",
      recover: { level: "none_needed", text: "No hay fondos en riesgo por esta transacción." },
      rating: "undetermined",
      ratingText: "No hay un error de tu parte demostrado; solo que esta transacción quedó sin efecto.",
      steps: ["Busca en el explorador la transacción que usó el mismo nonce: ahí está el resultado real.", "Pide el hash de esa transacción a tu wallet o historial."],
      concepts: ["nonce"],
    }),
    ORIGIN_PENDING: (c) => ({
      level: "wait",
      headline: "La transacción sigue pendiente",
      happened: `La transacción ${tx(c)} existe pero todavía no está incluida en un bloque.`,
      why: "Los fondos no se han movido aún. Suele deberse a una comisión baja o a congestión de la red.",
      recover: { level: "wait", text: "Los fondos siguen en origen mientras no se confirme." },
      rating: "correct",
      ratingText: "No se detecta ningún error en lo que hiciste; la transacción solo está esperando confirmación.",
      steps: ["Espera unos minutos y vuelve a consultar.", "Si no avanza, acelérala o cancélala desde la wallet usando el mismo nonce."],
      concepts: ["gas", "nonce"],
    }),
    BURN_ADDRESS: (c) => ({
      level: "problem",
      headline: "Los fondos se enviaron a una dirección de quema",
      happened: `La transacción ${tx(c)} envió ${assetText(c)} a una dirección de quema (0x000…000 o 0x…dEaD).`,
      why: "Esas direcciones no pertenecen a nadie: los fondos quedaron inaccesibles de forma permanente.",
      recover: { level: "none", text: "No es recuperable: nadie controla esa dirección." },
      rating: "incorrect",
      ratingText: "La operación no se hizo correctamente: el destino fue una dirección de quema.",
      steps: ["Confirma si fue un error de copiado o un contrato que lo hizo.", "Si se usó una aplicación, repórtalo a su soporte con el hash."],
      concepts: ["irreversible"],
    }),
    TOKEN_CONTRACT: (c) => ({
      level: "problem",
      headline: "Los tokens se enviaron al contrato del propio token",
      happened: `La transacción ${tx(c)} envió ${assetText(c)} a la dirección de un contrato de token, no a una wallet.`,
      why: "Los contratos de token normalmente no tienen forma de devolver tokens recibidos por error, por eso no están accesibles.",
      recover: { level: "unlikely", text: "Poco probable: solo si el equipo del token tiene una función de rescate." },
      rating: "incorrect",
      ratingText: "La dirección de destino fue la del contrato del token en lugar de la de una wallet.",
      steps: ["Contacta al equipo del token con el hash; algunos contratos tienen rescate manual.", "Antes de reenviar, verifica la dirección de destino completa."],
      concepts: ["token_contrato", "irreversible"],
    }),
    LOOKALIKE_ADDRESS: (c) => ({
      level: "problem",
      headline: "Se envió a una dirección parecida a la tuya, pero no es la misma",
      happened: `La transacción ${tx(c)} envió ${assetText(c)} a una dirección que no es la indicada (${c.A.dst_address || "la esperada"}), aunque se le parece mucho.`,
      why: "Los fondos están en esa otra dirección, controlada por alguien más. Este patrón coincide con un error de copiado o con una estafa de «envenenamiento de direcciones».",
      recover: { level: "unlikely", text: "Normalmente no es recuperable: solo el dueño de esa dirección podría devolverlos." },
      rating: "incorrect",
      ratingText: "La operación no se hizo correctamente: el receptor no es la dirección esperada.",
      steps: ["No envíes más fondos a esa dirección.", "Compara ambas direcciones carácter por carácter para entender el origen del error.", "Si sospechas una estafa, repórtalo a la plataforma y a las autoridades correspondientes."],
      concepts: ["address_poisoning", "checksum", "irreversible"],
    }),
    WRONG_RECIPIENT: (c) => ({
      level: "problem",
      headline: "El receptor de la transacción no es la dirección indicada",
      happened: `La transacción ${tx(c)} envió ${assetText(c)} a una dirección distinta de la que declaraste (${c.A.dst_address || "no indicada"}).`,
      why: "Los fondos están en el receptor real. Si ese receptor es un exchange o servicio, la acreditación depende de él; si es una dirección ajena, solo su dueño puede devolverlos.",
      recover: { level: "depends", text: "Depende de quién controle la dirección receptora." },
      rating: "incorrect",
      ratingText: "La operación no se completó hacia la dirección que declaraste. Puede que el dato declarado no sea el que se usó realmente.",
      steps: ["Compara el receptor real (en el explorador) con la dirección que creías haber usado.", "Si el receptor es de un exchange o servicio, pídele que busque el depósito con el hash."],
      concepts: ["irreversible", "custodia"],
    }),
    WRONG_NETWORK_ON_SOURCE: (c) => {
      const dep = c.A.flow === "exchange_deposit";
      return {
        level: "attention",
        headline: dep ? `El depósito se hizo por ${c.D.chain}, no por la red esperada (${c.A.dst_network})` : `Los fondos llegaron a ${c.D.chain}, no a ${c.A.dst_network}`,
        happened: dep
          ? `La transacción ${tx(c)} envió ${assetText(c)} a la dirección indicada por ${c.D.chain}, pero la plataforma esperaba ${c.A.dst_network}.`
          : `La transacción ${tx(c)} envió ${assetText(c)} a tu dirección por ${c.D.chain}. No cruzó a ${c.A.dst_network}: fue una transferencia directa dentro de ${c.D.chain}.`,
        why: dep
          ? `Los fondos están en esa dirección, pero en la red ${c.D.chain}. Si la plataforma no soporta esa red para ese activo, no los acredita automáticamente.`
          : `Por eso no los ves en ${c.A.dst_network}: están en ${c.D.chain}. Como las redes EVM comparten el formato de dirección, normalmente la misma wallet los controla allí.`,
        recover: dep
          ? { level: "depends", text: "Depende de la plataforma: algunas recuperan depósitos por red equivocada (a veces con costo y sin garantía), otras no." }
          : { level: "accessible", text: `Probablemente accesibles: cambia tu wallet a la red ${c.D.chain} (si tu wallet es personal y no un contrato).` },
        rating: "partially",
        ratingText: "La operación se completó, pero por una red distinta de la esperada.",
        steps: dep
          ? [`Contacta al soporte de la plataforma con el hash ${c.D.txHash} y explica que depositaste por ${c.D.chain}.`, "No reenvíes antes de tener su respuesta."]
          : [`Cambia la red de tu wallet a ${c.D.chain} para ver el saldo.`, `Si necesitas los fondos en ${c.A.dst_network}, usa un puente desde ${c.D.chain}.`],
        concepts: ["red", "direccion_evm", "tokens_no_visibles"],
      };

    },
    SWAP_NOT_BRIDGE: (c) => ({
      level: "attention",
      headline: "Se hizo un swap en una red, no un envío entre redes",
      happened: `La transacción ${tx(c)} fue un intercambio de tokens dentro de ${c.D.chain}, no un puente hacia ${c.A.dst_network || "otra red"}.`,
      why: `El resultado quedó en tu wallet en ${c.D.chain}, por eso no aparece en la otra red.`,
      recover: { level: "accessible", text: `Los tokens están en ${c.D.chain}; puedes usarlos allí o llevarlos con un puente.` },
      rating: "partially",
      ratingText: "La operación se completó, pero fue un tipo de operación distinto del que buscabas.",
      steps: [`Revisa el saldo en la red ${c.D.chain}.`, "Para cambiar de red usa un puente."],
      concepts: ["swap", "bridge"],
    }),
    APPROVAL_ONLY: (c) => ({
      level: "attention",
      headline: "Solo se dio un permiso (approve); no se enviaron fondos",
      happened: `La transacción ${tx(c)} autorizó a un contrato a gastar un token, pero no movió fondos.`,
      why: "El envío real ocurre en una segunda transacción que no se realizó (o no es esta).",
      recover: { level: "none_needed", text: "Los fondos siguen en tu wallet." },
      rating: "partially",
      ratingText: "El primer paso se hizo bien; falta completar el siguiente.",
      steps: ["Vuelve a la aplicación y completa el paso siguiente (swap, depósito o puente).", "Si no reconoces el permiso, revócalo."],
      concepts: ["aprobacion"],
    }),
    FUNDS_DELIVERED: (c) => {
      const visible = ["not_visible", "not_arrived", "cannot_use"].includes(c.A.symptom);
      return {
        level: "ok",
        headline: `Los fondos llegaron a ${c.deliveryChain}`,
        happened: `La red muestra una entrada compatible hacia la wallet en ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}: ${c.R && c.R.transfer && c.R.transfer.destinationAmount ? `${c.R.transfer.destinationAmount} ${c.R.transfer.matchedAsset || ""}` : assetText(c)}.`,
        why: visible ? "Si no los ves, la causa está en cómo los muestra tu wallet o plataforma, no en la red: suele ser mirar otra red, un token que hay que agregar manualmente, o un retraso de acreditación del servicio." : "No se detecta ningún problema con la operación.",
        recover: { level: "none_needed", text: "No hay nada que recuperar: los fondos están en la dirección." },
        rating: "correct",
        ratingText: "La operación se hizo correctamente según la evidencia de la red.",
        steps: visible
          ? [`Cambia tu wallet a la red ${c.deliveryChain} y revisa allí el saldo.`, "Si el token no aparece, agrega su contrato manualmente o revisa los tokens ocultos.", "Confirma en el explorador que el token figura en tu dirección."]
          : [],
        concepts: ["tokens_no_visibles", "explorador"],
      };
    },
    DEPOSIT_ARRIVED_PENDING_CREDIT: (c) => ({
      level: "attention",
      headline: "El depósito llegó a la dirección en la red; falta que la plataforma lo acredite",
      happened: `La transacción ${tx(c)} envió ${assetText(c)} a la dirección indicada en ${c.D.chain} y la red lo confirma.`,
      why: "Desde el punto de vista de la red, el envío se hizo bien. Que no figure en tu saldo depende de la plataforma: confirmaciones requeridas, depósito mínimo, activo o red aceptados, o si el envío vino de un contrato.",
      recover: { level: "depends", text: "Los fondos están en la dirección de la plataforma; su soporte es quien puede acreditarlos." },
      rating: "correct",
      ratingText: "Del lado de la red, la operación se hizo correctamente. Falta la acreditación interna de la plataforma.",
      steps: [`Abre un caso con la plataforma incluyendo el hash ${c.D.txHash}, el activo, el monto y la red.`, "Pregunta si el depósito cumple su mínimo y sus requisitos de red/activo."],
      concepts: ["confirmaciones", "deposito_minimo", "deposito_contrato", "custodia"],
    }),
    DELIVERED_OTHER_NETWORK: (c) => ({
      level: "attention",
      headline: `Los fondos llegaron a ${c.deliveryChain}, no a ${c.A.dst_network || "la red esperada"}`,
      happened: `La búsqueda no encontró la entrada en ${c.A.dst_network || "la red elegida"}, pero sí una entrada compatible hacia la wallet en ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}.`,
      why: `Por eso no los ves donde los esperabas. Es una coincidencia de wallet, activo y monto: indica con alta probabilidad que son tus fondos, pero no es una prueba criptográfica del vínculo.`,
      recover: { level: "accessible", text: `Probablemente accesibles en ${c.deliveryChain} con la misma wallet.` },
      rating: "partially",
      ratingText: "Los fondos llegaron, pero a una red distinta de la esperada.",
      steps: [`Cambia tu wallet a ${c.deliveryChain} y revisa allí el saldo.`, `Verifica la entrada en el explorador de ${c.deliveryChain}.`],
      concepts: ["red", "tokens_no_visibles"],
    }),
    IN_TRANSIT: (c) => ({
      level: "wait",
      headline: "La operación salió bien y aún está dentro del tiempo habitual",
      happened: `La transacción de origen ${tx(c)} tuvo éxito en ${c.D.chain}${c.protocol ? ` y pasó por ${c.protocol}` : ""}. En destino todavía no hay una entrada compatible.`,
      why: `Esto es normal para ${c.timing.label.toLowerCase()}: lo habitual es ${c.timing.expected}.`,
      recover: { level: "wait", text: "No hay nada que recuperar: la operación está en curso." },
      rating: "correct",
      ratingText: "No se detecta ningún error en lo que hiciste; solo falta que termine la entrega.",
      steps: ["Espera y vuelve a evaluar pasado el tiempo habitual.", c.D.bridgeMatches.length ? "Si el puente ofrece un seguimiento por hash, consúltalo." : null].filter(Boolean),
      concepts: uniq(["bridge", ...c.timing.concepts]),
    }),
    DELAYED_BEYOND_NORMAL: (c) => ({
      level: "problem",
      headline: "El origen salió bien, pero la entrega tarda más de lo habitual",
      happened: `La transacción de origen ${tx(c)} tuvo éxito en ${c.D.chain}${c.protocol ? ` y pasó por ${c.protocol}` : ""}, pero no hay una entrada compatible en ninguna de las redes consultadas.`,
      why: `Lo habitual es ${c.timing.expected}, y ya pasó más tiempo. No se puede saber desde la red por qué: puede ser una demora o una incidencia del proveedor, o que la entrega se haya hecho a otra dirección o activo. La red no registra el motivo.`,
      recover: { level: "depends", text: "Los fondos no están perdidos por lo que se ve: salieron del origen y dependen del proveedor para completarse o reembolsarse." },
      rating: "correct",
      ratingText: "En lo que se puede verificar, el envío de origen se hizo bien. La demora es del lado de la entrega.",
      steps: [`Contacta al soporte del ${c.protocol ? `puente ${c.protocol}` : "proveedor"} con el hash ${c.D.txHash}, la red de origen y la de destino.`, "Pide el estado interno de la operación y, si corresponde, un reembolso.", "Mientras tanto no repitas el envío."],
      concepts: uniq(["bridge", "explorador", ...c.timing.concepts]),
    }),
    ARRIVAL_UNCONFIRMED: (c) => ({
      level: "wait",
      headline: "El origen salió bien; la llegada no se pudo confirmar todavía",
      happened: `La transacción de origen ${tx(c)} tuvo éxito en ${c.D.chain}. No se pudo confirmar ni descartar la entrega en destino.`,
      why: c.delivery === "search_incomplete" ? "La búsqueda en destino no pudo completarse (una red no respondió o aún no avanzó lo suficiente)." : "No hay referencia de tiempo suficiente, o no se dio la dirección de destino, para concluir.",
      recover: { level: "unknown", text: "No se puede determinar con la evidencia disponible." },
      rating: "undetermined",
      ratingText: "No se detecta un error en el envío; falta evidencia sobre la entrega.",
      steps: ["Vuelve a evaluar en unos minutos.", c.D.destinationWallet ? null : "Indica la dirección de destino para buscar la entrada.", "Consulta el estado en la plataforma con el hash."].filter(Boolean),
      concepts: ["bridge", "explorador"],
    }),
    INPUT_ADDRESS_ERROR: (c) => ({
      level: "problem",
      headline: "La dirección indicada no es válida para esta operación",
      happened: `${c.addrCls ? (K.explainAddressInput(c.addrCls) || {}).title : "La dirección no es válida"}.`,
      why: "Una dirección mal escrita o de otra red es la causa más frecuente de envíos perdidos. Si la operación llegó a hacerse con esa dirección, los fondos pueden estar inaccesibles; si la plataforma la rechazó, no salió nada.",
      recover: { level: "unknown", text: "Depende de si la operación llegó a ejecutarse. Con el hash se puede verificar." },
      rating: "incorrect",
      ratingText: "El dato de la dirección tiene un error que explica el problema.",
      steps: ["Comprueba en la plataforma si la operación figura como enviada o rechazada.", "Si se envió, consigue el hash para ver adónde fue.", "Antes de volver a enviar, copia la dirección de la fuente y verifícala."],
      concepts: ["direccion_evm", "checksum", "no_evm", "irreversible"],
    }),
    WRONG_NETWORK_DECLARED: (c) => {
      const dep = c.A.flow === "exchange_deposit";
      return {
        level: "attention",
        headline: `Enviaste por ${c.A.src_network}, pero el destino esperaba ${c.A.dst_network}`,
        happened: `Según lo que indicaste, el envío se hizo por ${c.A.src_network} mientras que ${dep ? "la plataforma" : "tu wallet"} esperaba ${c.A.dst_network}. No hay un hash para verificarlo en la red.`,
        why: `Las redes son independientes: los fondos no desaparecen, pero quedan en ${c.A.src_network}. ${["unsupported_evm", "supported"].includes(c.srcKind) && ["unsupported_evm", "supported"].includes(c.dstKind) ? "Entre redes EVM, la misma dirección suele ser controlada por la misma wallet en ambas." : "Si alguna de las redes no es EVM, las direcciones no son compatibles y los fondos pueden ser inaccesibles."}`,
        recover: dep ? { level: "depends", text: "Depende de la plataforma: algunas recuperan depósitos por red equivocada, otras no." } : { level: "accessible", text: `Si es tu wallet personal en una red EVM, probablemente accesibles en ${c.A.src_network}.` },
        rating: "partially",
        ratingText: "El dato declarado indica una red equivocada. Con el hash se puede comprobar.",
        steps: dep ? ["Contacta al soporte de la plataforma con el hash y la red usada.", "No reenvíes antes de su respuesta."] : [`Revisa tu saldo en la red ${c.A.src_network}.`, "Consigue el hash para confirmarlo en el explorador."],
        concepts: ["red", "direccion_evm", "no_evm", "irreversible"],
      };
    },
    MEMO_MISSING: (c) => ({
      level: "problem",
      headline: "Faltó el memo/tag obligatorio",
      happened: "Declaraste que la plataforma pidió un memo o tag y no lo incluiste.",
      why: "El exchange recibe los fondos en una dirección compartida y usa el memo para saber a qué cuenta acreditarlos. Sin él, no puede asignarlos automáticamente.",
      recover: { level: "depends", text: "Suele resolverse con soporte, aportando el hash y los datos de la cuenta; puede tener costo o demora." },
      rating: "incorrect",
      ratingText: "Falta un dato obligatorio en el depósito.",
      steps: ["Abre un caso con el exchange con el hash, el activo, el monto y la cuenta.", "En el futuro, copia el memo junto con la dirección."],
      concepts: ["memo", "custodia"],
    }),
    NETWORK_NOT_VERIFIABLE: (c) => ({
      level: "unknown",
      headline: "Esta red no se puede verificar desde aquí",
      happened: `La operación involucra ${uniq([c.A.src_network, c.A.dst_network].filter((n) => ["unsupported_evm", "non_evm"].includes(K.networkKind(n)))).join(" / ")}, que esta herramienta no consulta.`,
      why: "Sin acceso a esa red no se puede confirmar si los fondos llegaron. Lo que sí se evaluó es la coherencia de lo declarado (redes y formato de dirección).",
      recover: { level: "unknown", text: "No se puede determinar desde aquí." },
      rating: "undetermined",
      ratingText: "Falta verificar la operación en el explorador de esa red.",
      steps: ["Busca el hash en el explorador de esa red (por ejemplo BscScan para BNB Chain, Tronscan para Tron).", "Si los fondos fueron a una dirección o red equivocada, contacta a la plataforma con el hash."],
      concepts: ["red", "no_evm", "explorador"],
    }),
    PROVIDER_PROCESSING: (c) => ({
      level: "wait",
      headline: "La operación está dentro de los sistemas del proveedor",
      happened: `${c.provider ? c.provider.label : "El proveedor"} muestra la operación ${providerStatusText(c.A.provider_status)}${c.A.tx_hash ? "" : " y no hay transacción en la red que verificar"}.`,
      why: c.A.provider_status === "review" ? "Una revisión (seguridad, verificación de identidad o cumplimiento) la realiza el proveedor y no depende de la red ni de lo que hiciste." : "Mientras esté en proceso, los fondos pueden no haber salido a la red todavía.",
      recover: { level: "wait", text: "Los fondos siguen bajo custodia del proveedor mientras no salgan a la red." },
      rating: "undetermined",
      ratingText: "No hay evidencia de un error de tu parte; el estado depende del proveedor.",
      steps: ["Consulta al soporte del proveedor el motivo y el plazo.", "Cuando salga a la red, pide el hash para verificar el destino."],
      concepts: ["custodia", "hash"],
    }),
    PROVIDER_REJECTED: (c) => ({
      level: "attention",
      headline: "La plataforma indica que la operación fue rechazada o cancelada",
      happened: `${c.provider ? c.provider.label : "La plataforma"} muestra la operación como rechazada o cancelada y no hay una transacción en la red que verificar.`,
      why: "Cuando una operación se rechaza antes de salir a la red, normalmente los fondos permanecen o se reintegran a la cuenta de origen.",
      recover: { level: "accessible", text: "Confirma que el saldo esté de vuelta en la cuenta de origen." },
      rating: "undetermined",
      ratingText: "Sin transacción en la red no hay fondos en tránsito; el motivo del rechazo lo informa el proveedor.",
      steps: ["Revisa el saldo en la cuenta o wallet de origen.", "Pide al proveedor el motivo del rechazo."],
      concepts: ["custodia"],
    }),
    NEED_HASH: (c) => ({
      level: "unknown",
      headline: "Falta el hash para verificar adónde fueron los fondos",
      happened: `${c.provider ? c.provider.label : "La plataforma"} indica que la operación fue enviada, pero no se dispone del hash (TxID).`,
      why: "Si el proveedor la envió, existe una transacción en la red. Con su hash se puede comprobar el destino, la red y el activo reales, que es lo que explica por qué no ves los fondos.",
      recover: { level: "unknown", text: "No se puede determinar sin el hash." },
      rating: "undetermined",
      ratingText: "No es posible evaluar la operación sin ver la transacción.",
      steps: ["Pide al proveedor el hash (TxID) del envío, o búscalo en tu historial de retiros.", "Vuelve a ejecutar la evaluación con el hash."],
      concepts: ["hash", "explorador"],
    }),
    HASH_NOT_FOUND: (c) => ({
      level: "unknown",
      headline: "El hash no aparece en las redes consultadas",
      happened: "Se buscó el hash en Ethereum, Polygon, Optimism, Arbitrum y Base y no existe en ninguna.",
      why: "Puede estar mal copiado, ser demasiado reciente o pertenecer a una red que no se consulta aquí. Mientras no se confirme, no se puede decir qué pasó con los fondos.",
      recover: { level: "unknown", text: "No se puede determinar." },
      rating: "undetermined",
      ratingText: "No se pudo evaluar la transacción.",
      steps: ["Copia de nuevo el hash completo desde la plataforma.", "Verifica con la plataforma por qué red se hizo la operación."],
      concepts: ["hash", "red"],
    }),
    FOUND_BY_SEARCH: (c) => ({
      level: c.inboundState === "found" ? "ok" : "attention",
      headline: c.inboundState === "found" ? `Se encontró una entrada compatible en ${c.E.inbound.matchedChain}` : `Se encontró una entrada compatible en ${c.E.inbound.matchedChain}, no en la red esperada`,
      happened: `Sin hash, se buscó en las 5 redes una entrada reciente hacia la wallet con el activo y el monto declarados, y hay una coincidencia en ${c.E.inbound.matchedChain}${c.E.inbound.transfer && c.E.inbound.transfer.hash ? ` (hash ${K.shortHash(c.E.inbound.transfer.hash)})` : ""}.`,
      why: "Es una correlación por wallet, activo, monto y tiempo, no una prueba de que sea tu operación. Si no la ves, probablemente estés mirando otra red o la wallet no muestra el token.",
      recover: { level: "accessible", text: `Probablemente accesible en ${c.E.inbound.matchedChain} con tu wallet.` },
      rating: c.inboundState === "found" ? "correct" : "partially",
      ratingText: "Hay evidencia de que los fondos llegaron; falta el hash para confirmarlo con certeza.",
      steps: [`Revisa tu saldo en ${c.E.inbound.matchedChain}.`, "Compara el hash encontrado con el que te dio la plataforma."],
      concepts: ["tokens_no_visibles", "red", "explorador"],
    }),
    INSUFFICIENT_DATA: (c) => ({
      level: "unknown",
      headline: "Con lo disponible no se puede determinar qué pasó",
      happened: "No hay una transacción verificada ni datos que permitan concluir.",
      why: "Para explicar por qué los fondos no llegaron o no están accesibles se necesita ver la transacción en la red o saber el estado exacto que muestra la plataforma.",
      recover: { level: "unknown", text: "No se puede determinar." },
      rating: "undetermined",
      ratingText: "Faltan datos para evaluar la operación.",
      steps: ["Consigue el hash (TxID) del envío con la plataforma que usaste.", "Indica la dirección de destino y las redes usadas."],
      concepts: ["hash", "red"],
    }),
  };

  const VERDICT_HEADLINES = {
    ORIGIN_FAILED: ["The transaction failed: no funds were sent", "A transação falhou: nenhum fundo foi enviado"],
    ORIGIN_REPLACED: ["The transaction was replaced or dropped", "A transação foi substituída ou descartada"],
    ORIGIN_PENDING: ["The transaction is still pending", "A transação ainda está pendente"],
    BURN_ADDRESS: ["Funds were sent to a burn address", "Os fundos foram enviados para um endereço de queima"],
    TOKEN_CONTRACT: ["Tokens were sent to the token contract itself", "Os tokens foram enviados para o próprio contrato do token"],
    LOOKALIKE_ADDRESS: ["Funds were sent to an address like yours, but not the same one", "Os fundos foram enviados para um endereço parecido com o seu, mas diferente"],
    WRONG_RECIPIENT: ["The transaction recipient is not the address you specified", "O destinatário da transação não é o endereço informado"],
    WRONG_NETWORK_ON_SOURCE: ["Funds reached ${chain}, not the expected network (${network})", "Os fundos chegaram em ${chain}, não na rede esperada (${network})"],
    SWAP_NOT_BRIDGE: ["A swap was made on one network, not a transfer between networks", "Foi feito um swap em uma rede, não uma transferência entre redes"],
    APPROVAL_ONLY: ["Only permission was granted (approve); no funds were sent", "Somente a permissão foi concedida (approve); nenhum fundo foi enviado"],
    FUNDS_DELIVERED: ["Funds arrived on ${chain}", "Os fundos chegaram em ${chain}"],
    DEPOSIT_ARRIVED_PENDING_CREDIT: ["The deposit reached the address on-chain; the platform still needs to credit it", "O depósito chegou ao endereço na rede; falta a plataforma creditá-lo"],
    DELIVERED_OTHER_NETWORK: ["Funds arrived on ${chain}, not ${network}", "Os fundos chegaram em ${chain}, não em ${network}"],
    IN_TRANSIT: ["The operation succeeded and is still within the usual timeframe", "A operação foi concluída e ainda está dentro do prazo habitual"],
    DELAYED_BEYOND_NORMAL: ["The source succeeded, but delivery is taking longer than usual", "A origem foi concluída, mas a entrega está demorando mais do que o normal"],
    ARRIVAL_UNCONFIRMED: ["The source succeeded; arrival could not be confirmed yet", "A origem foi concluída; ainda não foi possível confirmar a chegada"],
    INPUT_ADDRESS_ERROR: ["The address provided is not valid for this operation", "O endereço informado não é válido para esta operação"],
    WRONG_NETWORK_DECLARED: ["You sent on ${source}, but the destination expected ${destination}", "Você enviou pela ${source}, mas o destino esperava ${destination}"],
    MEMO_MISSING: ["The required memo/tag was missing", "Faltou o memo/tag obrigatório"],
    NETWORK_NOT_VERIFIABLE: ["This network cannot be verified here", "Não é possível verificar esta rede aqui"],
    PROVIDER_PROCESSING: ["The operation is still within the provider’s systems", "A operação ainda está nos sistemas do provedor"],
    PROVIDER_REJECTED: ["The platform says the operation was rejected or cancelled", "A plataforma informa que a operação foi rejeitada ou cancelada"],
    NEED_HASH: ["The hash is needed to verify where the funds went", "É necessário o hash para verificar para onde foram os fundos"],
    HASH_NOT_FOUND: ["The hash does not appear on the queried networks", "O hash não aparece nas redes consultadas"],
    FOUND_BY_SEARCH: ["A compatible incoming transfer was found", "Foi encontrada uma transferência de entrada compatível"],
    INSUFFICIENT_DATA: ["There is not enough information to determine what happened", "Não há informações suficientes para determinar o que aconteceu"],
  };
  function localizeHeadline(key, value, ctx) {
    const pair = VERDICT_HEADLINES[key];
    if (!pair || locale() === "es") return value;
    if (locale() === "en" && key === "FUNDS_DELIVERED") return `Funds arrived on ${ctx.deliveryChain}`;
    if (locale() === "pt" && key === "FUNDS_DELIVERED") return `Os fundos chegaram em ${ctx.deliveryChain}`;
    if (locale() === "en" && key === "DELIVERED_OTHER_NETWORK") return `Funds arrived on ${ctx.deliveryChain}, not ${ctx.A.dst_network || "the expected network"}`;
    if (locale() === "pt" && key === "DELIVERED_OTHER_NETWORK") return `Os fundos chegaram em ${ctx.deliveryChain}, não em ${ctx.A.dst_network || "na rede esperada"}`;
    if (key === "WRONG_NETWORK_ON_SOURCE") {
      return locale() === "en"
        ? `Funds reached ${ctx.D.chain}, not the expected network (${ctx.A.dst_network})`
        : `Os fundos chegaram em ${ctx.D.chain}, não na rede esperada (${ctx.A.dst_network})`;
    }
    if (key === "WRONG_NETWORK_DECLARED") {
      return locale() === "en"
        ? `You sent on ${ctx.A.src_network}, but the destination expected ${ctx.A.dst_network}`
        : `Você enviou pela ${ctx.A.src_network}, mas o destino esperava ${ctx.A.dst_network}`;
    }
    const template = locale() === "en" ? pair[0] : pair[1];
    return template.includes("${") ? value : template;
  }

  function localizeVerdictCopy(key, c, v) {
    if (locale() === "es") return v;
    if (key === "ORIGIN_REPLACED") {
      v.happened = locale() === "en"
        ? `The account already used the same nonce in another transaction, so ${tx(c)} will never be confirmed.`
        : `A conta já usou o mesmo nonce em outra transação, então ${tx(c)} nunca será confirmada.`;
    } else if (key === "ORIGIN_PENDING") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} exists but has not yet been included in a block.`
        : `A transação ${tx(c)} existe, mas ainda não foi incluída em um bloco.`;
    } else if (key === "BURN_ADDRESS") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} sent ${assetText(c)} to a burn address (0x000…000 or 0x…dEaD).`
        : `A transação ${tx(c)} enviou ${assetText(c)} para um endereço de queima (0x000…000 ou 0x…dEaD).`;
    } else if (key === "TOKEN_CONTRACT") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} sent ${assetText(c)} to a token contract address instead of a wallet.`
        : `A transação ${tx(c)} enviou ${assetText(c)} para o endereço de um contrato de token, e não para uma carteira.`;
    } else if (key === "LOOKALIKE_ADDRESS") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} sent ${assetText(c)} to an address that is not the one specified (${c.A.dst_address || "the expected address"}), although it looks very similar.`
        : `A transação ${tx(c)} enviou ${assetText(c)} para um endereço diferente do informado (${c.A.dst_address || "o endereço esperado"}), embora seja muito parecido.`;
    } else if (key === "WRONG_RECIPIENT") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} sent ${assetText(c)} to an address different from the one you reported (${c.A.dst_address || "not specified"}).`
        : `A transação ${tx(c)} enviou ${assetText(c)} para um endereço diferente do informado (${c.A.dst_address || "não informado"}).`;
      v.ratingText = locale() === "en"
        ? "The operation did not send funds to the address you reported. The address entered may not be the one that was actually used."
        : "A operação não enviou fundos para o endereço informado. O endereço declarado pode não ser o que foi realmente usado.";
      v.steps[1] = locale() === "en"
        ? "If the recipient is an exchange or service, ask its support team to look for the deposit using the hash."
        : "Se o destinatário for uma exchange ou serviço, peça ao suporte para localizar o depósito usando o hash.";
    } else if (key === "PROVIDER_PROCESSING") {
      const provider = c.provider ? c.provider.label : t("El proveedor", "The provider", "O provedor");
      const status = providerStatusText(c.A.provider_status);
      v.happened = locale() === "en"
        ? `${provider} shows the operation as ${status}${c.A.tx_hash ? "" : " and there is no on-chain transaction to verify"}.`
        : `${provider} mostra a operação como ${status}${c.A.tx_hash ? "" : " e não há uma transação na rede para verificar"}.`;
      v.why = c.A.provider_status === "review"
        ? t(
          "Una revisión (seguridad, verificación de identidad o cumplimiento) la realiza el proveedor y no depende de la red ni de lo que hiciste.",
          "A review (for security, identity verification or compliance) is handled by the provider and does not depend on the network or on anything you did.",
          "Uma análise (de segurança, verificação de identidade ou conformidade) é feita pelo provedor e não depende da rede nem de algo que você tenha feito."
        )
        : t("Mientras esté en proceso, los fondos pueden no haber salido a la red todavía.", "While it is processing, the funds may not have been sent to the network yet.", "Enquanto estiver em processamento, os fundos talvez ainda não tenham sido enviados à rede.");
      v.recover.text = t("Los fondos siguen bajo custodia del proveedor mientras no salgan a la red.", "The funds remain in the provider’s custody until they are sent to the network.", "Os fundos permanecem sob custódia do provedor até serem enviados à rede.");
      v.ratingText = t("No hay evidencia de un error de tu parte; el estado depende del proveedor.", "There is no evidence of an error on your part; the status depends on the provider.", "Não há evidências de erro da sua parte; o status depende do provedor.");
    } else if (key === "PROVIDER_REJECTED") {
      const provider = c.provider ? c.provider.label : t("La plataforma", "The platform", "A plataforma");
      v.happened = locale() === "en"
        ? `${provider} shows the operation as rejected or cancelled, and there is no on-chain transaction to verify.`
        : `${provider} mostra a operação como rejeitada ou cancelada, e não há uma transação na rede para verificar.`;
      v.recover.text = t("Confirma que el saldo esté de vuelta en la cuenta de origen.", "Confirm that the balance has returned to the source account.", "Confirme se o saldo voltou para a conta de origem.");
      v.ratingText = t("Sin transacción en la red no hay fondos en tránsito; el motivo del rechazo lo informa el proveedor.", "Without an on-chain transaction, no funds are in transit; the provider can explain the reason for the rejection.", "Sem uma transação na rede, não há fundos em trânsito; o provedor pode informar o motivo da rejeição.");
    } else if (key === "NEED_HASH") {
      const provider = c.provider ? c.provider.label : t("La plataforma", "The platform", "A plataforma");
      v.happened = locale() === "en"
        ? `${provider} says the operation was sent, but the hash (TxID) is unavailable.`
        : `${provider} informa que a operação foi enviada, mas o hash (TxID) não está disponível.`;
    } else if (key === "NETWORK_NOT_VERIFIABLE") {
      const networks = uniq([c.A.src_network, c.A.dst_network].filter((n) => ["unsupported_evm", "non_evm"].includes(K.networkKind(n)))).join(" / ");
      v.happened = locale() === "en"
        ? `The operation involves ${networks}, which this tool does not query.`
        : `A operação envolve ${networks}, uma rede que esta ferramenta não consulta.`;
    } else if (key === "ORIGIN_FAILED") {
      const fee = c.D.feePaid ? ` (≈ ${c.D.feePaid})` : "";
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} was recorded as failed on ${c.D.chain}. A failed transaction does not move the principal funds; they remain in the source wallet or account.`
        : `A transação ${tx(c)} foi registrada como falha em ${c.D.chain}. Uma transação com falha não transfere os fundos principais; eles permanecem na carteira ou conta de origem.`;
      v.why = locale() === "en"
        ? `The funds did not arrive because they were never sent. Only the gas already spent${fee} is lost.`
        : `Os fundos não chegaram porque nunca foram enviados. Apenas o gas já gasto${fee} é perdido.`;
      v.steps = locale() === "en"
        ? ["Confirm that the balance is still in the source wallet.", "Try again with enough gas and check the approvals and swap or bridge settings."]
        : ["Confirme se o saldo ainda está na carteira de origem.", "Tente novamente com gas suficiente e confira as aprovações e os parâmetros do swap ou da ponte."];
    } else if (key === "WRONG_NETWORK_DECLARED") {
      const dep = c.A.flow === "exchange_deposit";
      v.happened = locale() === "en"
        ? `According to your report, the transfer used ${c.A.src_network}, while ${dep ? "the platform" : "your wallet"} expected ${c.A.dst_network}. There is no hash to verify this on-chain.`
        : `De acordo com o que você informou, a transferência foi feita por ${c.A.src_network}, enquanto ${dep ? "a plataforma" : "sua carteira"} esperava ${c.A.dst_network}. Não há hash para verificar isso na rede.`;
      v.why = locale() === "en"
        ? `Networks are independent: the funds have not disappeared, but remain on ${c.A.src_network}. ${["unsupported_evm", "supported"].includes(c.srcKind) && ["unsupported_evm", "supported"].includes(c.dstKind) ? "Across EVM networks, the same wallet usually controls the same address on both." : "If either network is non-EVM, the address formats are incompatible and the funds may be inaccessible."}`
        : `As redes são independentes: os fundos não desapareceram, mas permanecem em ${c.A.src_network}. ${["unsupported_evm", "supported"].includes(c.srcKind) && ["unsupported_evm", "supported"].includes(c.dstKind) ? "Entre redes EVM, a mesma carteira geralmente controla o mesmo endereço em ambas." : "Se alguma rede não for EVM, os formatos de endereço são incompatíveis e os fundos podem ficar inacessíveis."}`;
      v.recover.text = dep
        ? t("Depende de la plataforma: algunas recuperan depósitos por red equivocada, otras no.", "It depends on the platform: some recover deposits sent on the wrong network, others do not.", "Depende da plataforma: algumas recuperam depósitos enviados pela rede errada, outras não.")
        : locale() === "en" ? `If this is your personal EVM wallet, the funds are probably accessible on ${c.A.src_network}.` : `Se esta for sua carteira pessoal EVM, provavelmente poderá acessar os fundos em ${c.A.src_network}.`;
      v.ratingText = locale() === "en" ? "The information provided indicates that the wrong network was used. The hash can verify this." : "As informações indicam que a rede errada foi usada. O hash pode confirmar isso.";
      v.steps = dep
        ? [locale() === "en" ? "Contact the platform’s support team with the hash and the network used." : "Entre em contato com o suporte da plataforma e informe o hash e a rede usada.", locale() === "en" ? "Do not send again before you receive a response." : "Não envie novamente antes de receber uma resposta."]
        : [locale() === "en" ? `Check your balance on ${c.A.src_network}.` : `Confira seu saldo em ${c.A.src_network}.`, locale() === "en" ? "Get the hash to verify it in the block explorer." : "Obtenha o hash para verificar no explorador de blocos."];
    } else if (key === "WRONG_NETWORK_ON_SOURCE") {
      const dep = c.A.flow === "exchange_deposit";
      v.happened = dep
        ? locale() === "en" ? `Transaction ${tx(c)} sent ${assetText(c)} to the address on ${c.D.chain}, but the platform expected ${c.A.dst_network}.` : `A transação ${tx(c)} enviou ${assetText(c)} para o endereço em ${c.D.chain}, mas a plataforma esperava ${c.A.dst_network}.`
        : locale() === "en" ? `Transaction ${tx(c)} sent ${assetText(c)} to your address on ${c.D.chain}. It did not reach ${c.A.dst_network}; this was a direct transfer on ${c.D.chain}.` : `A transação ${tx(c)} enviou ${assetText(c)} para seu endereço em ${c.D.chain}. Ela não chegou a ${c.A.dst_network}; foi uma transferência direta em ${c.D.chain}.`;
      v.ratingText = locale() === "en" ? "The operation completed, but on a different network than expected." : "A operação foi concluída, mas em uma rede diferente da esperada.";
      v.why = dep
        ? locale() === "en"
          ? `The funds are at that address on ${c.D.chain}. If the platform does not support that network for this asset, it will not credit them automatically.`
          : `Os fundos estão nesse endereço na rede ${c.D.chain}. Se a plataforma não aceitar essa rede para esse ativo, não fará o crédito automaticamente.`
        : locale() === "en"
          ? `That is why you cannot see them on ${c.A.dst_network}: they are on ${c.D.chain}. Since EVM networks share the same address format, the same wallet usually controls them there.`
          : `Por isso você não os vê em ${c.A.dst_network}: eles estão em ${c.D.chain}. Como as redes EVM usam o mesmo formato de endereço, geralmente a mesma carteira os controla nessa rede.`;
      if (!dep) v.recover.text = locale() === "en"
        ? `Probably accessible: switch your wallet to ${c.D.chain} (if it is a personal wallet, not a contract).`
        : `Provavelmente acessíveis: mude sua carteira para a rede ${c.D.chain} (se for uma carteira pessoal, não um contrato).`;
      v.steps = dep
        ? [locale() === "en" ? `Contact the platform’s support team with hash ${c.D.txHash} and explain that you deposited on ${c.D.chain}.` : `Entre em contato com o suporte da plataforma, informe o hash ${c.D.txHash} e explique que o depósito foi feito em ${c.D.chain}.`, locale() === "en" ? "Do not send again before you receive a response." : "Não envie novamente antes de receber uma resposta."]
        : [locale() === "en" ? `Switch your wallet to ${c.D.chain} to view the balance.` : `Mude sua carteira para ${c.D.chain} para ver o saldo.`, locale() === "en" ? `To move the funds to ${c.A.dst_network}, use a bridge from ${c.D.chain}.` : `Para transferir os fundos para ${c.A.dst_network}, use uma ponte a partir de ${c.D.chain}.`];
    } else if (key === "FUNDS_DELIVERED") {
      v.happened = locale() === "en"
        ? `The network shows a compatible incoming transfer to the wallet on ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}: ${c.R && c.R.transfer && c.R.transfer.destinationAmount ? `${c.R.transfer.destinationAmount} ${c.R.transfer.matchedAsset || ""}` : assetText(c)}.`
        : `A rede mostra uma transferência de entrada compatível para a carteira em ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}: ${c.R && c.R.transfer && c.R.transfer.destinationAmount ? `${c.R.transfer.destinationAmount} ${c.R.transfer.matchedAsset || ""}` : assetText(c)}.`;
      v.why = ["not_visible", "not_arrived", "cannot_use"].includes(c.A.symptom)
        ? locale() === "en" ? "If you cannot see the funds, the issue is how your wallet or platform displays them, not the network. Common causes are viewing another network, a token that must be added manually, or a platform crediting delay." : "Se você não vê os fundos, o problema está na exibição da carteira ou plataforma, não na rede. As causas comuns são estar em outra rede, precisar adicionar o token manualmente ou haver atraso no crédito da plataforma."
        : t("No se detecta ningún problema con la operación.", "No issue with the operation was detected.", "Nenhum problema com a operação foi detectado.");
      v.ratingText = locale() === "en" ? "The operation was completed correctly according to the on-chain evidence." : "A operação foi concluída corretamente de acordo com as evidências da rede.";
      v.steps = ["not_visible", "not_arrived", "cannot_use"].includes(c.A.symptom)
        ? [locale() === "en" ? `Switch your wallet to ${c.deliveryChain} and check the balance there.` : `Mude sua carteira para ${c.deliveryChain} e confira o saldo.`, locale() === "en" ? "If the token does not appear, add its contract manually or check hidden tokens." : "Se o token não aparecer, adicione o contrato manualmente ou confira os tokens ocultos.", locale() === "en" ? "Confirm in the explorer that the token appears at your address." : "Confirme no explorador se o token aparece no seu endereço."]
        : [];
    } else if (key === "SWAP_NOT_BRIDGE") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} swapped tokens on ${c.D.chain}, rather than bridging them to ${c.A.dst_network || "another network"}.`
        : `A transação ${tx(c)} fez um swap de tokens em ${c.D.chain}, em vez de transferi-los para ${c.A.dst_network || "outra rede"}.`;
      v.why = locale() === "en"
        ? `The result remains in your wallet on ${c.D.chain}, which is why it does not appear on the other network.`
        : `O resultado ficou na sua carteira em ${c.D.chain}, por isso não aparece na outra rede.`;
      v.recover.text = locale() === "en"
        ? `The tokens are on ${c.D.chain}; you can use them there or move them with a bridge.`
        : `Os tokens estão em ${c.D.chain}; você pode usá-los nessa rede ou transferi-los por uma ponte.`;
      v.steps[0] = locale() === "en" ? `Check your balance on ${c.D.chain}.` : `Confira o saldo na rede ${c.D.chain}.`;
    } else if (key === "DELIVERED_OTHER_NETWORK") {
      v.happened = locale() === "en"
        ? `The search found no incoming transfer on ${c.A.dst_network || "the selected network"}, but found a compatible transfer to the wallet on ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}.`
        : `A busca não encontrou uma transferência de entrada em ${c.A.dst_network || "na rede selecionada"}, mas encontrou uma transferência compatível para a carteira em ${c.deliveryChain}${c.deliveryHash ? ` (hash ${K.shortHash(c.deliveryHash)})` : ""}.`;
      v.why = locale() === "en"
        ? `That is why you cannot see them where expected. The match is based on wallet, asset and amount, so it strongly suggests these are your funds but does not cryptographically prove the transactions are linked.`
        : `Por isso você não os vê onde esperava. A correspondência considera carteira, ativo e valor; é muito provável que sejam seus fundos, mas isso não prova criptograficamente a ligação entre as transações.`;
      v.recover.text = locale() === "en"
        ? `Probably accessible on ${c.deliveryChain} with the same wallet.`
        : `Provavelmente acessíveis em ${c.deliveryChain} usando a mesma carteira.`;
      v.steps[0] = locale() === "en"
        ? `Switch your wallet to ${c.deliveryChain} and check the balance there.`
        : `Mude sua carteira para ${c.deliveryChain} e confira o saldo nessa rede.`;
    } else if (key === "IN_TRANSIT") {
      v.happened = locale() === "en"
        ? `The source transaction ${tx(c)} succeeded on ${c.D.chain}${c.protocol ? ` and used ${c.protocol}` : ""}. No compatible incoming transfer has been found at the destination yet.`
        : `A transação de origem ${tx(c)} foi concluída em ${c.D.chain}${c.protocol ? ` e passou pela ${c.protocol}` : ""}. Ainda não foi encontrada uma transferência de entrada compatível no destino.`;
      v.why = locale() === "en"
        ? `This is normal for ${c.timing.label.toLowerCase()}: the usual timeframe is ${c.timing.expected}.`
        : `Isso é normal para ${c.timing.label.toLowerCase()}: o prazo habitual é ${c.timing.expected}.`;
    } else if (key === "DELAYED_BEYOND_NORMAL") {
      v.happened = locale() === "en"
        ? `The source transaction ${tx(c)} succeeded on ${c.D.chain}${c.protocol ? ` via ${c.protocol}` : ""}, but no compatible incoming transfer was found on the queried networks.`
        : `A transação de origem ${tx(c)} foi concluída em ${c.D.chain}${c.protocol ? ` pela ${c.protocol}` : ""}, mas não foi encontrada uma transferência de entrada compatível nas redes consultadas.`;
      v.why = locale() === "en"
        ? `The usual timeframe is ${c.timing.expected}, and it has passed. The network cannot explain why: it may be a provider delay or incident, or the delivery may have gone to another address or asset. The network does not record the reason.`
        : `O prazo habitual é ${c.timing.expected} e já passou. A rede não permite saber o motivo: pode ser um atraso ou problema do provedor, ou a entrega pode ter sido feita para outro endereço ou ativo. A rede não registra o motivo.`;
      v.recover.text = locale() === "en"
        ? "The funds do not appear to be lost: they left the source and depend on the provider to complete the transfer or refund them."
        : "Os fundos não parecem estar perdidos: saíram da origem e dependem do provedor para concluir a entrega ou reembolsá-los.";
      v.ratingText = locale() === "en"
        ? "The source transfer was completed correctly based on what can be verified. The delay is on the delivery side."
        : "O envio de origem foi concluído corretamente com base no que pode ser verificado. O atraso está na etapa de entrega.";
      v.steps[0] = locale() === "en"
        ? `Contact ${c.protocol ? `the ${c.protocol} bridge` : "the provider"} with hash ${c.D.txHash}, the source network and the destination network.`
        : `Entre em contato com ${c.protocol ? `a ponte ${c.protocol}` : "o provedor"} e informe o hash ${c.D.txHash}, a rede de origem e a rede de destino.`;
      v.steps[1] = locale() === "en"
        ? "Ask for the operation’s internal status and, if applicable, a refund."
        : "Peça o status interno da operação e, se aplicável, um reembolso.";
      v.steps[2] = locale() === "en" ? "Do not repeat the transfer in the meantime." : "Enquanto isso, não repita a transferência.";
    } else if (key === "ARRIVAL_UNCONFIRMED") {
      v.happened = locale() === "en"
        ? `The source transaction ${tx(c)} succeeded on ${c.D.chain}. Delivery to the destination could not be confirmed or ruled out.`
        : `A transação de origem ${tx(c)} foi concluída em ${c.D.chain}. Não foi possível confirmar nem descartar a entrega no destino.`;
      v.why = c.delivery === "search_incomplete"
        ? t("La búsqueda en destino no pudo completarse (una red no respondió o aún no avanzó lo suficiente).", "The destination search could not be completed (a network did not respond or has not advanced enough yet).", "Não foi possível concluir a busca no destino (uma rede não respondeu ou ainda não avançou o suficiente).")
        : t("No hay referencia de tiempo suficiente, o no se dio la dirección de destino, para concluir.", "There is not enough timing information, or no destination address was provided, to draw a conclusion.", "Não há informações suficientes sobre o tempo, ou o endereço de destino não foi informado, para chegar a uma conclusão.");
    } else if (key === "MEMO_MISSING") {
      v.happened = locale() === "en"
        ? "You reported that the platform required a memo or tag and you did not include it."
        : "Você informou que a plataforma exigiu um memo ou tag e que ele não foi incluído.";
    } else if (key === "APPROVAL_ONLY") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} only approved a contract to spend tokens; it did not send funds.`
        : `A transação ${tx(c)} apenas autorizou um contrato a gastar tokens; não enviou fundos.`;
    } else if (key === "DEPOSIT_ARRIVED_PENDING_CREDIT") {
      v.happened = locale() === "en"
        ? `Transaction ${tx(c)} sent ${assetText(c)} to the specified address on ${c.D.chain}, and the network confirms it.`
        : `A transação ${tx(c)} enviou ${assetText(c)} para o endereço informado em ${c.D.chain}, e a rede confirma o envio.`;
    } else if (key === "FOUND_BY_SEARCH") {
      const chain = c.E.inbound.matchedChain;
      const hash = c.E.inbound.transfer && c.E.inbound.transfer.hash ? ` (hash ${K.shortHash(c.E.inbound.transfer.hash)})` : "";
      v.happened = locale() === "en"
        ? `Without a hash, a recent incoming transfer matching the wallet, asset and amount was found on ${chain}${hash}.`
        : `Sem o hash, foi encontrada em ${chain} uma transferência de entrada recente compatível com a carteira, o ativo e o valor${hash}.`;
    }
    if (key === "APPROVAL_ONLY") {
      v.steps[0] = locale() === "en"
        ? "Return to the app and complete the next step (swap, deposit or bridge)."
        : "Volte ao aplicativo e conclua a próxima etapa (swap, depósito ou ponte).";
    } else if (key === "DELIVERED_OTHER_NETWORK") {
      v.why = locale() === "en"
        ? `That is why you cannot see them where expected. The match is based on wallet, asset and amount, so it strongly suggests these are your funds but does not cryptographically prove the transactions are linked.`
        : `Por isso você não os vê onde esperava. A correspondência considera carteira, ativo e valor; é muito provável que sejam seus fundos, mas isso não prova criptograficamente a ligação entre as transações.`;
      v.recover.text = locale() === "en"
        ? `Probably accessible on ${c.deliveryChain} with the same wallet.`
        : `Provavelmente acessíveis em ${c.deliveryChain} usando a mesma carteira.`;
      v.steps[0] = locale() === "en"
        ? `Switch your wallet to ${c.deliveryChain} and check the balance there.`
        : `Mude sua carteira para ${c.deliveryChain} e confira o saldo nessa rede.`;
    } else if (key === "IN_TRANSIT") {
      v.why = locale() === "en"
        ? `This is normal for ${c.timing.label.toLowerCase()}: the usual timeframe is ${c.timing.expected}.`
        : `Isso é normal para ${c.timing.label.toLowerCase()}: o prazo habitual é ${c.timing.expected}.`;
    } else if (key === "DELAYED_BEYOND_NORMAL") {
      v.why = locale() === "en"
        ? `The usual timeframe is ${c.timing.expected}, and it has passed. The network cannot explain why: it may be a provider delay or incident, or the delivery may have gone to another address or asset. The network does not record the reason.`
        : `O prazo habitual é ${c.timing.expected} e já passou. A rede não permite saber o motivo: pode ser um atraso ou problema do provedor, ou a entrega pode ter sido feita para outro endereço ou ativo. A rede não registra o motivo.`;
      v.recover.text = locale() === "en"
        ? "The funds do not appear to be lost: they left the source and depend on the provider to complete the transfer or refund them."
        : "Os fundos não parecem estar perdidos: saíram da origem e dependem do provedor para concluir a entrega ou reembolsá-los.";
      v.ratingText = locale() === "en"
        ? "The source transfer was completed correctly based on what can be verified. The delay is on the delivery side."
        : "O envio de origem foi concluído corretamente com base no que pode ser verificado. O atraso está na etapa de entrega.";
      v.steps = [
        locale() === "en"
          ? `Contact ${c.protocol ? `the ${c.protocol} bridge` : "the provider"} with hash ${c.D.txHash}, the source network and the destination network.`
          : `Entre em contato com ${c.protocol ? `a ponte ${c.protocol}` : "o provedor"} e informe o hash ${c.D.txHash}, a rede de origem e a rede de destino.`,
        locale() === "en" ? "Ask for the operation’s internal status and, if applicable, a refund." : "Peça o status interno da operação e, se aplicável, um reembolso.",
        locale() === "en" ? "Do not repeat the transfer in the meantime." : "Enquanto isso, não repita a transferência.",
      ];
    } else if (key === "ARRIVAL_UNCONFIRMED") {
      v.why = c.delivery === "search_incomplete"
        ? t("La búsqueda en destino no pudo completarse (una red no respondió o aún no avanzó lo suficiente).", "The destination search could not be completed (a network did not respond or has not advanced enough yet).", "Não foi possível concluir a busca no destino (uma rede não respondeu ou ainda não avançou o suficiente).")
        : t("No hay referencia de tiempo suficiente, o no se dio la dirección de destino, para concluir.", "There is not enough timing information, or no destination address was provided, to draw a conclusion.", "Não há informações suficientes sobre o tempo, ou o endereço de destino não foi informado, para chegar a uma conclusão.");
    }
    return v;
  }

  function decide(ctx) {
    const { A, D, has } = ctx;
    if (ctx.txState === "failed") return "ORIGIN_FAILED";
    if (ctx.txState === "replaced") return "ORIGIN_REPLACED";
    if (ctx.txState === "pending") return "ORIGIN_PENDING";
    if (ctx.txState === "success") {
      if (has("burn_target") || has("burn_recipient")) return "BURN_ADDRESS";
      if (has("sent_to_token_contract")) return "TOKEN_CONTRACT";
      if (has("address_poisoning") || has("address_typo")) return "LOOKALIKE_ADDRESS";
      if (has("recipient_mismatch")) return "WRONG_RECIPIENT";
      if (has("wrong_network_delivery")) return "WRONG_NETWORK_ON_SOURCE";
      if (has("dex_not_bridge")) return "SWAP_NOT_BRIDGE";
      if (has("approval_only")) return "APPROVAL_ONLY";
      if (ctx.delivery === "expected") return A.flow === "exchange_deposit" && ["not_arrived", "not_visible", "cannot_use"].includes(A.symptom) ? "DEPOSIT_ARRIVED_PENDING_CREDIT" : "FUNDS_DELIVERED";
      if (ctx.delivery === "other_network") return "DELIVERED_OTHER_NETWORK";
      if (A.memo === "required_missing") return "MEMO_MISSING";
      if (ctx.delivery === "not_found" || ctx.delivery === "candidates") {
        if (ctx.timingStatus === "within") return "IN_TRANSIT";
        if (ctx.timingStatus === "beyond") return "DELAYED_BEYOND_NORMAL";
      }
      return "ARRIVAL_UNCONFIRMED";
    }
    // Sin transacción verificada
    if (ctx.addressProblem && ctx.addrCls && ctx.addrCls.kind !== "evm_missing_prefix") return "INPUT_ADDRESS_ERROR";
    if (ctx.addrNet === false) return "INPUT_ADDRESS_ERROR";
    if (ctx.declaredMismatch) return "WRONG_NETWORK_DECLARED";
    if (A.memo === "required_missing") return "MEMO_MISSING";
    if (ctx.inboundState === "found" || ctx.inboundState === "found_other") return "FOUND_BY_SEARCH";
    if (!A.tx_hash) {
      if (A.provider_status === "review" || A.provider_status === "processing") return "PROVIDER_PROCESSING";
      if (A.provider_status === "rejected") return "PROVIDER_REJECTED";
      if (["unsupported_evm", "non_evm"].includes(ctx.srcKind) || ["unsupported_evm", "non_evm"].includes(ctx.dstKind)) return "NETWORK_NOT_VERIFIABLE";
      if (A.provider_status === "completed_sent") return "NEED_HASH";
      return "INSUFFICIENT_DATA";
    }
    if (["unsupported_evm", "non_evm"].includes(ctx.srcKind) || ["unsupported_evm", "non_evm"].includes(ctx.dstKind)) return "NETWORK_NOT_VERIFIABLE";
    if (A.provider_status === "review" || A.provider_status === "processing") return "PROVIDER_PROCESSING";
    if (ctx.E.detect && ctx.E.detect.state === "not_found") return "HASH_NOT_FOUND";
    return "INSUFFICIENT_DATA";
  }

  // ───────────── Confianza y límites ─────────────
  function buildConfidence(ctx, verdictKey) {
    const { E, D } = ctx;
    const reasons = [];
    let level;
    if (D) {
      const conclusive = ["ORIGIN_FAILED", "ORIGIN_REPLACED", "BURN_ADDRESS", "TOKEN_CONTRACT", "LOOKALIKE_ADDRESS", "WRONG_RECIPIENT", "APPROVAL_ONLY", "SWAP_NOT_BRIDGE", "WRONG_NETWORK_ON_SOURCE"].includes(verdictKey);
      const radarOk = ctx.delivery === "expected" || ctx.delivery === "other_network";
      if (conclusive || radarOk) {
        level = "high";
        reasons.push(t("La conclusión se apoya en la transacción verificada en la red.", "The conclusion is based on the transaction verified on-chain.", "A conclusão se baseia na transação verificada na rede."));
      } else if (ctx.delivery === "not_found") {
        level = "medium";
        reasons.push(t("El origen está verificado, pero la ausencia de entrada en destino no prueba por sí sola que no llegará.", "The source is verified, but the absence of an incoming destination transfer does not by itself prove it will not arrive.", "A origem foi verificada, mas a ausência de uma entrada no destino não prova, por si só, que ela não chegará."));
      } else {
        level = "medium";
        reasons.push(t("El origen está verificado; la entrega no se pudo confirmar.", "The source is verified; delivery could not be confirmed.", "A origem foi verificada; não foi possível confirmar a entrega."));
      }
    } else if (ctx.inboundState === "found" || ctx.inboundState === "found_other") {
      level = "medium";
      reasons.push(t("Hay una coincidencia por wallet, activo y monto, pero sin hash no se prueba el vínculo.", "There is a match by wallet, asset and amount, but without a hash the link cannot be proven.", "Há uma correspondência por carteira, ativo e valor, mas sem o hash não é possível comprovar a ligação."));
    } else {
      level = "low";
      reasons.push(t("No hay evidencia verificada en la red: la evaluación se basa en lo declarado.", "There is no verified on-chain evidence; the evaluation is based on what was reported.", "Não há evidência verificada na rede; a avaliação se baseia no que foi informado."));
    }
    if (E.errors && E.errors.length) {
      reasons.push(t("Algunas consultas fallaron; lo que no se pudo consultar se trata como «no determinado».", "Some queries failed; anything that could not be checked is treated as “undetermined.”", "Algumas consultas falharam; o que não pôde ser consultado é tratado como “indeterminado.”"));
      if (level === "high") level = "medium";
    }
    return { level, reasons };
  }

  function buildLimits(ctx) {
    const { A, E } = ctx;
    const limits = [t("La evaluación usa datos públicos de la red y lo que declaraste. No puede ver los sistemas internos de exchanges ni de puentes, ni las razones de una revisión interna.", "This evaluation uses public network data and your statements. It cannot see exchange or bridge internal systems or the reasons for an internal review.", "Esta avaliação usa dados públicos da rede e o que você informou. Ela não acessa os sistemas internos de exchanges ou pontes nem os motivos de uma análise interna.")];
    if (!A.tx_hash) limits.push(t("No se dispuso del hash: lo declarado no se pudo contrastar con la transacción.", "No hash was provided, so the information could not be checked against the transaction.", "O hash não foi fornecido; não foi possível comparar as informações com a transação."));
    if (ctx.delivery === "expected" || ctx.delivery === "other_network" || ctx.inboundState) limits.push(t("La coincidencia en destino se hace por wallet, activo y monto; indica la entrega, pero no es una prueba criptográfica de que ambas transacciones estén vinculadas.", "Destination matches are based on wallet, asset and amount; they indicate delivery but are not cryptographic proof that the transactions are linked.", "As correspondências no destino são baseadas em carteira, ativo e valor; indicam a entrega, mas não são prova criptográfica de que as transações estejam vinculadas."));
    if (ctx.timing.thresholdMinutes) limits.push(t("Los tiempos mencionados son referencias orientativas y no garantías de ningún proveedor.", "The times mentioned are estimates, not guarantees from any provider.", "Os prazos mencionados são referências, não garantias de qualquer provedor."));
    if (E.skipped === "no_key") limits.push(t("No se configuró la API key de Alchemy, por lo que no se pudo consultar la red.", "No Alchemy API key was configured, so the network could not be queried.", "A chave de API da Alchemy não foi configurada, então não foi possível consultar a rede."));
    for (const err of E.errors || []) limits.push(t(`No se pudo completar «${err.step}»: ${err.message}`, `Could not complete “${err.step}”: ${err.message}`, `Não foi possível concluir “${err.step}”: ${err.message}`));
    return uniq(limits);
  }

  function buildFacts(ctx) {
    const { A, D, E } = ctx;
    const facts = [];
    const f = (basis, label, value) => value !== undefined && value !== null && value !== "" && facts.push({ basis, label: factLabel(label), value: String(value) });
    if (A.flow) f("declared", "Operación", K.FLOWS[A.flow] ? K.FLOWS[A.flow].short : A.flow);
    if (A.provider) f("declared", "Proveedor", A.provider);
    if (A.asset) f("declared", "Activo", A.asset === "OTHER" ? A.asset_other || "Otro" : A.asset);
    if (A.amount) f("declared", "Monto", A.amount);
    if (A.src_network) f("declared", "Red de envío", A.src_network);
    if (A.dst_network) f("declared", "Red esperada", A.dst_network);
    if (A.dst_address) f("declared", "Dirección de destino", A.dst_address);
    if (A.provider_status) f("declared", "Estado en el proveedor", providerStatusText(A.provider_status));
    if (D) {
      f("chain", "Red de la transacción", D.chain);
      f("chain", "Estado", ctx.txState === "success" ? t("Exitosa", "Succeeded", "Concluída") : ctx.txState === "failed" ? t("Fallida", "Failed", "Falhou") : t("Pendiente", "Pending", "Pendente"));
      f("chain", "Bloque", D.blockNumber);
      f("chain", "Remitente", D.from);
      f("chain", "Contrato / receptor", D.to);
      if (D.originAssets.length) f("chain", "Activos movidos", D.originAssets.map((a) => `${a.amount} ${a.symbol}`).join(" + "));
      if (D.bridgeMatches.length) f("chain", "Puente / router reconocido", uniq(D.bridgeMatches.map((m) => m.name)).join(", "));
      if (D.originTimestamp) f("chain", "Momento del envío", K.formatUtc(D.originTimestamp));
      if (ctx.deliveryChain) f("chain", "Entrada hallada en", `${ctx.deliveryChain}${ctx.deliveryHash ? ` (${ctx.deliveryHash})` : ""}`);
    }
    if (E.txChain && !D) f("chain", "Red del hash", E.txChain);
    return facts;
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((s) => s && !seen.has(s) && seen.add(s));
  }

  const COPY = {
    "No se puede comparar la red de envío con la esperada": ["Cannot compare the sending network with the expected network", "Não é possível comparar a rede de envio com a rede esperada"],
    "Falta saber una de las dos redes, por lo que no se puede confirmar que coincidan.": ["One of the networks is missing, so it cannot be confirmed that they match.", "Falta informar uma das redes, então não é possível confirmar se elas coincidem."],
    "Según lo que indicaste, enviaste por la misma red que esperaba el destino.": ["According to your report, you used the same network expected by the destination.", "De acordo com o que você informou, o envio foi feito pela mesma rede esperada pelo destino."],
    "Las redes son sistemas independientes: un envío por una red no llega a otra. Los fondos no desaparecen, pero quedan en la red por la que se enviaron.": ["Networks are independent systems: a transfer on one network does not arrive on another. The funds have not disappeared; they remain on the network used to send them.", "As redes são sistemas independentes: uma transferência em uma rede não chega a outra. Os fundos não desapareceram; permanecem na rede usada no envio."],
    "El origen y el destino son la misma red": ["The source and destination are the same network", "A origem e o destino são a mesma rede"],
    "Un puente sirve para cambiar de red. Con la misma red de origen y destino no se trata de un puente (quizá un swap o una transferencia).": ["A bridge moves funds between networks. If the source and destination are the same network, this is not a bridge (it may be a swap or transfer).", "Uma ponte transfere fundos entre redes. Se a origem e o destino são a mesma rede, não se trata de uma ponte (talvez seja um swap ou uma transferência)."],
    "Las redes de origen y destino son distintas, como corresponde a un puente.": ["The source and destination networks are different, as expected for a bridge.", "As redes de origem e destino são diferentes, como esperado em uma operação de ponte."],
    "Esta herramienta solo consulta Ethereum, Polygon, Optimism, Arbitrum y Base. Lo relativo a esas otras redes se evalúa únicamente con lo que declaraste; el explorador de esa red es la fuente para confirmarlo.": ["This tool only queries Ethereum, Polygon, Optimism, Arbitrum and Base. Other networks are assessed only from your answers; use that network’s explorer to verify them.", "Esta ferramenta consulta apenas Ethereum, Polygon, Optimism, Arbitrum e Base. As demais redes são avaliadas apenas com base no que você informou; consulte o explorador da rede para verificar."],
    "No se indicó la dirección de destino": ["No destination address was provided", "Nenhum endereço de destino foi informado"],
    "Sin la dirección no se puede comprobar quién recibió los fondos ni buscar la entrada en la wallet.": ["Without the address, it is not possible to check who received the funds or search for an incoming transfer to the wallet.", "Sem o endereço, não é possível verificar quem recebeu os fundos nem buscar uma transferência de entrada na carteira."],
    "La dirección tiene un formato válido": ["The address has a valid format", "O endereço tem um formato válido"],
    "Es una dirección EVM bien formada (y, si mezcla mayúsculas y minúsculas, su checksum es correcto).": ["This is a well-formed EVM address (and its checksum is valid if it uses mixed case).", "Este é um endereço EVM bem formado (e o checksum está correto, caso misture letras maiúsculas e minúsculas)."],
    "La dirección es una dirección de quema": ["This is a burn address", "Este é um endereço de queima"],
    "Los fondos enviados a esa dirección quedan inaccesibles de forma permanente.": ["Funds sent to this address become permanently inaccessible.", "Os fundos enviados para esse endereço ficam permanentemente inacessíveis."],
    "El tipo de dirección corresponde a la red indicada.": ["The address format matches the specified network.", "O formato do endereço corresponde à rede indicada."],
    "La dirección se escribió a mano": ["The address was typed manually", "O endereço foi digitado manualmente"],
    "La dirección se tomó del historial o de contactos": ["The address was copied from history or contacts", "O endereço foi copiado do histórico ou dos contatos"],
    "El hash no aparece en ninguna de las 5 redes consultadas": ["The hash was not found on any of the five queried networks", "O hash não foi encontrado em nenhuma das cinco redes consultadas"],
    "No hay hash para verificar la transacción": ["There is no hash to verify the transaction", "Não há hash para verificar a transação"],
    "No hay hash para verificar la transacción": ["There is no hash to verify the transaction", "Não há hash para verificar a transação"],
    "No se pudo consultar la transacción en la red": ["The transaction could not be queried on the network", "Não foi possível consultar a transação na rede"],
    "La red la registró como fallida: no se movieron los fondos principales.": ["The network recorded it as failed; the principal funds did not move.", "A rede registrou a transação como falha; os fundos principais não foram transferidos."],
    "No hay hash para verificar la transacción": ["There is no hash to verify the transaction", "Não há hash para verificar a transação"],
    "No hay hash para verificar la transacción": ["There is no hash to verify the transaction", "Não há hash para verificar a transação"],
    "El monto coincide con lo declarado": ["The amount matches what was reported", "O valor corresponde ao informado"],
    "El activo que se movió no coincide con el declarado": ["The transferred asset does not match the one reported", "O ativo transferido não corresponde ao informado"],
    "No se encontró una entrada compatible en ninguna red": ["No compatible incoming transfer was found on any network", "Nenhuma transferência de entrada compatível foi encontrada em qualquer rede"],
    "Hay entradas a la wallet, pero ninguna coincide con la operación": ["Incoming transfers to the wallet were found, but none match the operation", "Foram encontradas transferências de entrada na carteira, mas nenhuma corresponde à operação"],
    "La búsqueda de la entrega no pudo completarse": ["The delivery search could not be completed", "Não foi possível concluir a busca pela entrega"],
    "No se pudo buscar la entrega en destino": ["Could not search for delivery on the destination network", "Não foi possível buscar a entrega na rede de destino"],
    "La entrega no se puede buscar en cadena en esa red": ["On-chain delivery cannot be searched for on that network", "Não é possível buscar a entrega on-chain nessa rede"],
    "No se puede buscar la entrega sin la dirección de destino": ["Cannot search for delivery without the destination address", "Não é possível buscar a entrega sem o endereço de destino"],
    "El proveedor no muestra ningún estado": ["The provider shows no status", "O provedor não exibe um status"],
    "Faltó el memo / tag obligatorio": ["The required memo/tag was missing", "Faltou o memo/tag obrigatório"],
    "El memo / tag se incluyó": ["The memo/tag was included", "O memo/tag foi incluído"],
    "En la red el depósito llegó a la dirección indicada": ["The deposit reached the specified address on-chain", "O depósito chegou on-chain ao endereço informado"],
    "Alguien te indicó hacer este envío": ["Someone told you to make this transfer", "Alguém orientou você a fazer esta transferência"],
    "Operación": ["Operation", "Operação"], "Proveedor": ["Provider", "Provedor"], "Activo": ["Asset", "Ativo"],
    "Monto": ["Amount", "Valor"], "Red de envío": ["Sending network", "Rede de envio"], "Red esperada": ["Expected network", "Rede esperada"],
    "Dirección de destino": ["Destination address", "Endereço de destino"], "Estado en el proveedor": ["Provider status", "Status no provedor"],
    "No hay fondos que recuperar: están en origen.": ["There are no funds to recover; they remain at the source.", "Não há fundos a recuperar; eles permanecem na origem."],
    "No hay fondos en riesgo por esta transacción.": ["No funds are at risk from this transaction.", "Nenhum fundo está em risco por causa desta transação."],
    "Los fondos siguen en origen mientras no se confirme.": ["The funds remain at the source until the transaction is confirmed.", "Os fundos permanecem na origem até a confirmação da transação."],
    "No es recuperable: nadie controla esa dirección.": ["It cannot be recovered; no one controls that address.", "Não é possível recuperar; ninguém controla esse endereço."],
    "Poco probable: solo si el equipo del token tiene una función de rescate.": ["Unlikely: only if the token team has a recovery function.", "Improvável: somente se a equipe do token tiver uma função de resgate."],
    "Normalmente no es recuperable: solo el dueño de esa dirección podría devolverlos.": ["Usually unrecoverable; only the owner of that address could return them.", "Geralmente não é possível recuperar; somente o titular desse endereço poderia devolvê-los."],
    "Depende de quién controle la dirección receptora.": ["It depends on who controls the recipient address.", "Depende de quem controla o endereço destinatário."],
    "Los fondos siguen en tu wallet.": ["The funds remain in your wallet.", "Os fundos permanecem na sua carteira."],
    "No hay nada que recuperar: los fondos están en la dirección.": ["There is nothing to recover; the funds are at the address.", "Não há nada a recuperar; os fundos estão no endereço."],
    "Los fondos están en la dirección de la plataforma; su soporte es quien puede acreditarlos.": ["The funds are at the platform’s address; only its support team can credit them.", "Os fundos estão no endereço da plataforma; somente o suporte dela pode creditá-los."],
    "No hay nada que recuperar: la operación está en curso.": ["There is nothing to recover; the operation is in progress.", "Não há nada a recuperar; a operação está em andamento."],
    "No se puede determinar con la evidencia disponible.": ["This cannot be determined from the available evidence.", "Não é possível determinar com as evidências disponíveis."],
    "No se puede determinar desde aquí.": ["This cannot be determined here.", "Não é possível determinar por aqui."],
    "No se puede determinar sin el hash.": ["This cannot be determined without the hash.", "Não é possível determinar sem o hash."],
    "No se puede determinar.": ["Cannot be determined.", "Não é possível determinar."],
    "Confirma si fue un error de copiado o un contrato que lo hizo.": ["Check whether this was a copy error or caused by a contract.", "Verifique se isso ocorreu por um erro ao copiar ou por ação de um contrato."],
    "Si se usó una aplicación, repórtalo a su soporte con el hash.": ["If you used an app, report it to its support team with the hash.", "Se você usou um aplicativo, informe o suporte dele e forneça o hash."],
    "Antes de reenviar, verifica la dirección de destino completa.": ["Before sending again, verify the complete destination address.", "Antes de enviar novamente, confira o endereço de destino completo."],
    "No envíes más fondos a esa dirección.": ["Do not send more funds to that address.", "Não envie mais fundos para esse endereço."],
    "Si no reconoces el permiso, revócalo.": ["If you do not recognize the approval, revoke it.", "Se você não reconhece a aprovação, revogue-a."],
    "Para cambiar de red usa un puente.": ["Use a bridge to move to another network.", "Use uma ponte para mudar de rede."],
    "No reenvíes antes de tener su respuesta.": ["Do not send again before you hear back.", "Não envie novamente antes de receber uma resposta."],
    "Mientras tanto no repitas el envío.": ["Do not repeat the transfer in the meantime.", "Enquanto isso, não repita a transferência."],
    "Espera unos minutos y vuelve a consultar.": ["Wait a few minutes and check again.", "Aguarde alguns minutos e consulte novamente."],
    "Vuelve a evaluar en unos minutos.": ["Run the evaluation again in a few minutes.", "Faça uma nova avaliação em alguns minutos."],
    "Consulta al soporte del proveedor el motivo y el plazo.": ["Ask the provider’s support team for the reason and expected timeframe.", "Pergunte ao suporte do provedor o motivo e o prazo previsto."],
    "Pide al proveedor el motivo del rechazo.": ["Ask the provider why it was rejected.", "Peça ao provedor o motivo da rejeição."],
    "Revisa el saldo en la cuenta o wallet de origen.": ["Check the balance in the source account or wallet.", "Confira o saldo na conta ou carteira de origem."],
    "Consigue el hash para confirmarlo en el explorador.": ["Get the hash to verify it in the block explorer.", "Obtenha o hash para verificar no explorador de blocos."],
    "No se detecta ningún problema con la operación.": ["No issue with the operation was detected.", "Nenhum problema com a operação foi detectado."],
    "La operación se hizo correctamente según la evidencia de la red.": ["The operation was completed correctly according to the on-chain evidence.", "A operação foi realizada corretamente de acordo com as evidências da rede."],
    "La operación se completó, pero por una red distinta de la esperada.": ["The operation completed, but on a different network than expected.", "A operação foi concluída, mas em uma rede diferente da esperada."],
    "Falta un dato obligatorio en el depósito.": ["A required deposit detail is missing.", "Falta uma informação obrigatória no depósito."],
    "No se pudo evaluar la transacción.": ["The transaction could not be evaluated.", "Não foi possível avaliar a transação."],
    "Faltan datos para evaluar la operación.": ["There is not enough information to evaluate the operation.", "Faltam informações para avaliar a operação."],
    "Vuelve a ejecutar la evaluación con el hash.": ["Run the evaluation again with the hash.", "Faça uma nova avaliação usando o hash."],
    "En el futuro, copia el memo junto con la dirección.": ["In the future, copy the memo along with the address.", "Da próxima vez, copie o memo junto com o endereço."],
    "No envíes antes de su respuesta.": ["Do not send again before you receive a response.", "Não envie novamente antes de receber uma resposta."],
    "No hay un error de tu parte demostrado; solo que esta transacción quedó sin efecto.": ["No error on your part has been established; this transaction simply had no effect.", "Não foi comprovado um erro da sua parte; esta transação simplesmente não teve efeito."],
    "La operación no se completó. Los motivos típicos son saldo o gas insuficiente, un permiso (approve) faltante o parámetros como slippage; el detalle del motivo figura en los hallazgos si la red lo informó.": ["The operation did not complete. Common causes include insufficient balance or gas, a missing approval, or settings such as slippage; if the network reported a reason, it appears in the findings.", "A operação não foi concluída. Causas comuns incluem saldo ou gas insuficiente, falta de aprovação ou parâmetros como slippage; se a rede informou o motivo, ele aparece nos resultados."],
    "El primer paso se hizo bien; falta completar el siguiente.": ["The first step succeeded; the next one still needs to be completed.", "A primeira etapa foi concluída; falta concluir a próxima."],
    "No se detecta ningún error en lo que hiciste; solo falta que termine la entrega.": ["No issue with your actions was detected; delivery just needs to finish.", "Nenhum erro na sua ação foi detectado; falta apenas a entrega ser concluída."],
    "No se detecta un error en el envío; falta evidencia sobre la entrega.": ["No issue with the transfer was detected; evidence about delivery is still missing.", "Nenhum erro no envio foi detectado; ainda faltam evidências sobre a entrega."],
    "La dirección tiene un error de escritura (checksum inválido)": ["The address has a typing error (invalid checksum)", "O endereço tem um erro de digitação (checksum inválido)"],
    "Se asumió 0x + los 40 caracteres que indicaste.": ["The 40 characters you provided were treated as an address with the 0x prefix.", "Os 40 caracteres informados foram considerados um endereço com o prefixo 0x."],
    "La dirección tiene un formato válido": ["The address has a valid format", "O endereço tem um formato válido"],
    "El formato de la dirección es coherente con": ["The address format matches", "O formato do endereço corresponde a"],
    "El formato de la dirección no corresponde a la red": ["The address format does not match network", "O formato do endereço não corresponde à rede"],
    "El hash no aparece en ninguna de las 5 redes consultadas": ["The hash was not found on any of the five queried networks", "O hash não foi encontrado em nenhuma das cinco redes consultadas"],
    "La transacción existe y tuvo éxito en": ["The transaction exists and succeeded on", "A transação existe e foi concluída em"],
    "La transacción falló en": ["The transaction failed on", "A transação falhou em"],
    "No hay hash para verificar la transacción": ["There is no hash to verify the transaction", "Não há hash para verificar a transação"],
    "El activo coincide con lo declarado": ["The asset matches what was reported", "O ativo corresponde ao informado"],
    "El monto observado es distinto del declarado": ["The observed amount differs from the reported amount", "O valor observado difere do informado"],
    "Declaraste": ["You reported", "Você informou"],
    "En la red se movió": ["The network shows a transfer of", "A rede mostra uma transferência de"],
    "Se recibió el equivalente a": ["The received amount was equivalent to", "O valor recebido equivaleu a"],
    "Diferencia entre lo enviado y lo recibido:": ["Difference between amount sent and received:", "Diferença entre o valor enviado e o recebido:"],
    "La red muestra que los fondos llegaron a la wallet en": ["The network shows that funds reached the wallet on", "A rede mostra que os fundos chegaram à carteira em"],
    "Los fondos aparecen en": ["Funds appear on", "Os fundos aparecem em"],
    "La búsqueda encontró una entrada compatible en otra red.": ["The search found a compatible incoming transfer on another network.", "A busca encontrou uma transferência de entrada compatível em outra rede."],
    "Se encontraron transferencias entrantes, pero ninguna cumple el rango de monto del mismo activo ni el de valor de un swap. No se puede confirmar la entrega.": ["Incoming transfers were found, but none meet the amount range for the same asset or the value range for a swap. Delivery cannot be confirmed.", "Foram encontradas transferências de entrada, mas nenhuma atende à faixa de valor do mesmo ativo ou à faixa de valor de um swap. Não é possível confirmar a entrega."],
    "Una consulta falló o la red de destino aún no avanzó lo suficiente. No se puede concluir que los fondos no hayan llegado.": ["A query failed or the destination network has not advanced enough yet. It cannot be concluded that the funds did not arrive.", "Uma consulta falhou ou a rede de destino ainda não avançou o suficiente. Não é possível concluir que os fundos não chegaram."],
    "La red de destino no está entre las consultables (Ethereum, Polygon, Optimism, Arbitrum, Base).": ["The destination network is not among those that can be queried (Ethereum, Polygon, Optimism, Arbitrum, Base).", "A rede de destino não está entre as que podem ser consultadas (Ethereum, Polygon, Optimism, Arbitrum, Base)."],
    "Es una correlación, no una prueba de que sea la operación que hiciste.": ["This is a correlation, not proof that it is your transaction.", "Isto é uma correlação, não uma prova de que seja a sua operação."],
    "Los tiempos mencionados son referencias orientativas y no garantías de ningún proveedor.": ["The times mentioned are estimates, not guarantees from any provider.", "Os prazos mencionados são referências, não garantias de qualquer provedor."],
    "Las revisiones de seguridad o verificación las hace el proveedor y no dependen de la red ni de ti; el soporte del proveedor es quien puede informar el motivo y el plazo.": ["Security or identity reviews are handled by the provider, not the network or you; only the provider’s support team can explain the reason and timeframe.", "As análises de segurança ou identidade são feitas pelo provedor, não pela rede nem por você; somente o suporte do provedor pode informar o motivo e o prazo."],
    "Sin el memo, el exchange recibe los fondos pero no sabe a qué cuenta acreditarlos. Suele resolverse con soporte, aportando el hash.": ["Without the memo, the exchange receives the funds but cannot tell which account to credit. Support can often resolve this if you provide the hash.", "Sem o memo, a exchange recebe os fundos, mas não sabe em qual conta creditá-los. O suporte geralmente pode resolver isso com o hash."],
    "Si el explorador muestra el token en tu dirección, la wallet puede no estar mostrándolo: agrega el contrato del token manualmente o revisa los tokens ocultos.": ["If the explorer shows the token at your address, your wallet may simply not display it: add the token contract manually or check hidden tokens.", "Se o explorador mostra o token no seu endereço, a carteira pode simplesmente não exibi-lo: adicione o contrato manualmente ou confira os tokens ocultos."],
    "Otro": ["Other", "Outro"],
    "Los fondos principales siguen en la wallet o cuenta de origen.": ["The principal funds remain in the source wallet or account.", "Os fundos principais permanecem na carteira ou conta de origem."],
    "Por esta transacción no salió ningún fondo. Puede ser una cancelación o una aceleración con otro hash.": ["No funds were sent in this transaction. It may have been cancelled or replaced by a speed-up with another hash.", "Nenhum fundo foi enviado nesta transação. Ela pode ter sido cancelada ou substituída por uma aceleração com outro hash."],
    "Los fondos no se han movido aún. Suele deberse a una comisión baja o a congestión de la red.": ["The funds have not moved yet. This is often due to a low fee or network congestion.", "Os fundos ainda não foram transferidos. Isso geralmente ocorre por uma taxa baixa ou congestionamento da rede."],
    "Esas direcciones no pertenecen a nadie: los fondos quedaron inaccesibles de forma permanente.": ["Those addresses belong to no one; the funds are permanently inaccessible.", "Esses endereços não pertencem a ninguém; os fundos ficaram permanentemente inacessíveis."],
    "Los contratos de token normalmente no tienen forma de devolver tokens recibidos por error, por eso no están accesibles.": ["Token contracts usually cannot return tokens received by mistake, so the funds are inaccessible.", "Contratos de token geralmente não conseguem devolver tokens recebidos por engano, então os fundos ficam inacessíveis."],
    "Los fondos están en esa otra dirección, controlada por alguien más. Este patrón coincide con un error de copiado o con una estafa de «envenenamiento de direcciones».": ["The funds are at that other address, controlled by someone else. This pattern is consistent with a copy error or an address-poisoning scam.", "Os fundos estão nesse outro endereço, controlado por outra pessoa. Esse padrão é compatível com um erro de cópia ou um golpe de envenenamento de endereços."],
    "Los fondos están en el receptor real. Si ese receptor es un exchange o servicio, la acreditación depende de él; si es una dirección ajena, solo su dueño puede devolverlos.": ["The funds are at the actual recipient. If it is an exchange or service, crediting depends on them; if it belongs to someone else, only its owner can return the funds.", "Os fundos estão no destinatário real. Se for uma exchange ou serviço, o crédito depende deles; se for um endereço de outra pessoa, somente o titular poderá devolver os fundos."],
    "El resultado quedó en tu wallet en": ["The result remains in your wallet on", "O resultado ficou na sua carteira em"],
    "El envío real ocurre en una segunda transacción que no se realizó (o no es esta).": ["The actual transfer happens in a second transaction, which either was not made or is not this one.", "A transferência real ocorre em uma segunda transação, que não foi realizada ou não é esta."],
    "Una dirección mal escrita o de otra red es la causa más frecuente de envíos perdidos.": ["A mistyped address or one from another network is the most common cause of lost transfers.", "Um endereço digitado incorretamente ou de outra rede é a causa mais comum de transferências perdidas."],
    "El exchange recibe los fondos en una dirección compartida y usa el memo para saber a qué cuenta acreditarlos. Sin él, no puede asignarlos automáticamente.": ["The exchange receives funds at a shared address and uses the memo to identify the account to credit. Without it, funds cannot be assigned automatically.", "A exchange recebe os fundos em um endereço compartilhado e usa o memo para identificar a conta a creditar. Sem ele, não é possível atribuir os fundos automaticamente."],
    "Sin acceso a esa red no se puede confirmar si los fondos llegaron. Lo que sí se evaluó es la coherencia de lo declarado (redes y formato de dirección).": ["Without access to that network, it is not possible to confirm whether the funds arrived. The consistency of the reported networks and address format was still assessed.", "Sem acesso a essa rede, não é possível confirmar se os fundos chegaram. Ainda foi avaliada a coerência das redes informadas e do formato do endereço."],
    "Mientras esté en proceso, los fondos pueden no haber salido a la red todavía.": ["While it is processing, the funds may not have been sent to the network yet.", "Enquanto estiver em processamento, os fundos talvez ainda não tenham sido enviados à rede."],
    "Cuando una operación se rechaza antes de salir a la red, normalmente los fondos permanecen o se reintegran a la cuenta de origen.": ["When an operation is rejected before reaching the network, the funds usually remain in or are returned to the source account.", "Quando uma operação é rejeitada antes de chegar à rede, os fundos geralmente permanecem na conta de origem ou são devolvidos a ela."],
    "Si el proveedor la envió, existe una transacción en la red. Con su hash se puede comprobar el destino, la red y el activo reales, que es lo que explica por qué no ves los fondos.": ["If the provider sent it, an on-chain transaction exists. Its hash can confirm the actual destination, network and asset, which may explain why the funds are not visible.", "Se o provedor enviou, existe uma transação na rede. O hash permite verificar o destino, a rede e o ativo reais, o que pode explicar por que você não vê os fundos."],
    "Puede estar mal copiado, ser demasiado reciente o pertenecer a una red que no se consulta aquí. Mientras no se confirme, no se puede decir qué pasó con los fondos.": ["It may have been copied incorrectly, be very recent, or belong to a network not queried here. Until verified, it is not possible to say what happened to the funds.", "Ele pode ter sido copiado incorretamente, ser muito recente ou pertencer a uma rede não consultada aqui. Até que seja verificado, não é possível dizer o que aconteceu com os fundos."],
    "Es una correlación por wallet, activo, monto y tiempo, no una prueba de que sea tu operación. Si no la ves, probablemente estés mirando otra red o la wallet no muestra el token.": ["This is a match by wallet, asset, amount and time, not proof that it is your transaction. If you cannot see it, you may be viewing another network or your wallet may not display the token.", "Esta é uma correspondência por carteira, ativo, valor e horário, não uma prova de que seja sua operação. Se não consegue vê-la, talvez esteja na rede errada ou sua carteira não esteja exibindo o token."],
    "No hay una transacción verificada ni datos que permitan concluir.": ["There is no verified transaction or other data to draw a conclusion.", "Não há uma transação verificada nem outros dados que permitam chegar a uma conclusão."],
    "Revisa en tu wallet que el saldo sigue en origen.": ["Check in your wallet that the balance remains at the source.", "Confira na carteira se o saldo permanece na origem."],
    "Reintenta con gas suficiente y revisa permisos y parámetros del intercambio o puente.": ["Try again with enough gas and check the approvals and swap or bridge settings.", "Tente novamente com gas suficiente e confira as aprovações e os parâmetros do swap ou da ponte."],
    "Si no reconoces el permiso, revócalo.": ["If you do not recognize the approval, revoke it.", "Se você não reconhece a aprovação, revogue-a."],
    "Busca en el explorador la transacción que usó el mismo nonce: ahí está el resultado real.": ["Find the transaction that used the same nonce in the explorer; that shows the actual outcome.", "Encontre no explorador a transação que usou o mesmo nonce; ela mostra o resultado real."],
    "Pide el hash de esa transacción a tu wallet o historial.": ["Get the hash for that transaction from your wallet or history.", "Obtenha o hash dessa transação na carteira ou no histórico."],
    "Contacta al equipo del token con el hash; algunos contratos tienen rescate manual.": ["Contact the token team with the hash; some contracts have a manual recovery function.", "Entre em contato com a equipe do token e informe o hash; alguns contratos têm uma função de resgate manual."],
    "Compara ambas direcciones carácter por carácter para entender el origen del error.": ["Compare both addresses character by character to identify the source of the error.", "Compare os dois endereços caractere por caractere para identificar a origem do erro."],
    "Si sospechas una estafa, repórtalo a la plataforma y a las autoridades correspondientes.": ["If you suspect a scam, report it to the platform and the relevant authorities.", "Se suspeitar de um golpe, denuncie à plataforma e às autoridades competentes."],
    "Espera y vuelve a evaluar pasado el tiempo habitual.": ["Wait, then run the evaluation again after the usual timeframe.", "Aguarde e faça uma nova avaliação após o prazo habitual."],
    "Si el puente ofrece un seguimiento por hash, consúltalo.": ["If the bridge offers hash tracking, check it.", "Se a ponte oferecer acompanhamento por hash, consulte-o."],
    "Consulta el estado en la plataforma con el hash.": ["Check the status with the platform using the hash.", "Consulte o status na plataforma usando o hash."],
    "Antes de volver a enviar, copia la dirección de la fuente y verifícala.": ["Before sending again, copy the address from the original source and verify it.", "Antes de enviar novamente, copie o endereço da fonte original e confira-o."],
    "Pide el hash al proveedor.": ["Ask the provider for the hash.", "Peça o hash ao provedor."],
    "Abre un caso con el exchange con el hash, el activo, el monto y la cuenta.": ["Open a case with the exchange and include the hash, asset, amount and account.", "Abra um chamado na exchange e informe o hash, ativo, valor e conta."],
    "Compara el receptor real (en el explorador) con la dirección que creías haber usado.": ["Compare the actual recipient in the explorer with the address you thought you used.", "Compare o destinatário real no explorador com o endereço que você acreditava ter usado."],
    "Para explicar por qué los fondos no llegaron o no están accesibles se necesita ver la transacción en la red o saber el estado exacto que muestra la plataforma.": ["To explain why the funds did not arrive or are inaccessible, the transaction must be checked on-chain or the platform’s exact status must be known.", "Para explicar por que os fundos não chegaram ou estão inacessíveis, é preciso verificar a transação na rede ou saber o status exato mostrado pela plataforma."],
    "Consigue el hash (TxID) del envío con la plataforma que usaste.": ["Get the transaction hash (TxID) from the platform you used.", "Peça à plataforma usada o hash da transação (TxID)."],
    "Indica la dirección de destino y las redes usadas.": ["Provide the destination address and the networks used.", "Informe o endereço de destino e as redes usadas."],
    "Sin el hash solo se puede basar la evaluación en lo que declaraste. Pídelo a la plataforma (suele llamarse TxID).": ["Without the hash, the evaluation can only rely on what you reported. Ask the platform for it (often called a TxID).", "Sem o hash, a avaliação só pode se basear no que você informou. Peça-o à plataforma (geralmente chamado TxID)."],
    "Espera unos minutos y vuelve a consultar.": ["Wait a few minutes and check again.", "Aguarde alguns minutos e consulte novamente."],
    "Si no avanza, acelérala o cancélala desde la wallet usando el mismo nonce.": ["If it does not progress, speed it up or cancel it from your wallet using the same nonce.", "Se não avançar, acelere ou cancele pela carteira usando o mesmo nonce."],
    "Si la plataforma no lo muestra, el motivo está en cómo la plataforma lo acredita: confirmaciones requeridas, monto mínimo, activo y red aceptados, o depósitos hechos desde contratos. Eso solo lo puede confirmar su soporte.": ["If the platform does not show it, the issue is with its crediting process: required confirmations, minimum amount, accepted asset and network, or deposits sent from contracts. Only its support team can confirm which applies.", "Se a plataforma não o exibe, o motivo está no processo de crédito dela: confirmações exigidas, valor mínimo, ativo e rede aceitos ou depósitos enviados por contratos. Somente o suporte pode confirmar."],
    "¿El tiempo transcurrido está cerca del límite habitual": ["The elapsed time is close to the usual threshold", "O tempo decorrido está próximo do limite habitual"],
    "No hay una transacción verificada ni datos que permitan concluir.": ["There is no verified transaction or other data to draw a conclusion.", "Não há uma transação verificada nem outros dados que permitam chegar a uma conclusão."],
    "Falta saber una de las dos redes, por lo que no se puede confirmar que coincidan.": ["One of the networks is missing, so it cannot be confirmed that they match.", "Falta informar uma das redes, então não é possível confirmar se elas coincidem."],
    "Se buscó el hash en Ethereum, Polygon, Optimism, Arbitrum y Base y no existe en ninguna.": ["The hash was searched for on Ethereum, Polygon, Optimism, Arbitrum and Base, but was not found on any of them.", "O hash foi pesquisado em Ethereum, Polygon, Optimism, Arbitrum e Base, mas não foi encontrado em nenhuma delas."],
    "No hay un error de tu parte demostrado; solo que esta transacción quedó sin efecto.": ["No error on your part has been established; this transaction simply had no effect.", "Não foi comprovado um erro da sua parte; esta transação simplesmente não teve efeito."],
    "Busca el hash en el explorador de esa red (por ejemplo BscScan para BNB Chain, Tronscan para Tron).": ["Search for the hash in that network’s explorer (for example, BscScan for BNB Chain or Tronscan for Tron).", "Pesquise o hash no explorador dessa rede (por exemplo, BscScan para BNB Chain ou Tronscan para Tron)."],
    "Abre un caso con la plataforma incluyendo el hash": ["Open a support case with the platform and include the hash", "Abra um chamado na plataforma e inclua o hash"],
    "Pregunta si el depósito cumple su mínimo y sus requisitos de red/activo.": ["Ask whether the deposit meets its minimum and network/asset requirements.", "Pergunte se o depósito atende aos requisitos mínimos e de rede/ativo."],
    "Cambia tu wallet a": ["Switch your wallet to", "Mude sua carteira para"],
    "Verifica la entrada en el explorador de": ["Verify the incoming transfer in the explorer for", "Verifique a transferência de entrada no explorador de"],
    "Contacta al soporte de la plataforma con el hash": ["Contact the platform’s support team with the hash", "Entre em contato com o suporte da plataforma e informe o hash"],
    "No envíes más fondos. Verifica la dirección completa y reporta el caso; los fondos enviados a una dirección ajena normalmente no son recuperables.": ["Do not send more funds. Verify the full address and report the incident; funds sent to someone else’s address usually cannot be recovered.", "Não envie mais fundos. Confira o endereço completo e denuncie o caso; geralmente não é possível recuperar fundos enviados a um endereço de terceiros."],
    "Una diferencia pequeña es habitual por comisiones del servicio o del puente. Es una estimación aritmética, no la tarifa oficial.": ["A small difference is common due to service or bridge fees. This is an arithmetic estimate, not the official fee.", "Uma pequena diferença é comum devido às taxas do serviço ou da ponte. Esta é uma estimativa aritmética, não a taxa oficial."],
    "Es mayor a lo habitual; conviene revisar la comisión que mostró el servicio al confirmar.": ["This is higher than usual; check the fee shown by the service at confirmation.", "Está acima do normal; confira a taxa exibida pelo serviço na confirmação."],
    "El hash no aparece en ninguna de las 5 redes consultadas": ["The hash was not found on any of the five queried networks", "O hash não foi encontrado em nenhuma das cinco redes consultadas"],
    "Lo habitual es": ["The usual timeframe is", "O prazo habitual é"],
    "Han pasado": ["Time elapsed:", "Tempo decorrido:"],
    "Es una referencia orientativa, no una garantía del proveedor.": ["This is an estimate, not a provider guarantee.", "Esta é uma estimativa, não uma garantia do provedor."],
    "La operación se completó correctamente según la evidencia de la red.": ["The operation completed successfully according to the on-chain evidence.", "A operação foi concluída corretamente de acordo com as evidências da rede."],
    "El proveedor no muestra ningún estado": ["The provider shows no status", "O provedor não exibe um status"],
    "Consulta al soporte del proveedor el motivo y el plazo.": ["Ask the provider’s support team for the reason and timeframe.", "Pergunte ao suporte do provedor o motivo e o prazo."],
    "Cuando salga a la red, pide el hash para verificar el destino.": ["Once it reaches the network, ask for the hash to verify the destination.", "Quando chegar à rede, peça o hash para verificar o destino."],
    "Pide el hash de esa transacción a tu wallet o historial.": ["Get that transaction’s hash from your wallet or history.", "Obtenha o hash dessa transação na carteira ou no histórico."],
    "Comprueba en la plataforma si la operación figura como enviada o rechazada.": ["Check whether the platform lists the operation as sent or rejected.", "Confira se a plataforma indica que a operação foi enviada ou rejeitada."],
    "Si se envió, consigue el hash para ver adónde fue.": ["If it was sent, get the hash to see where it went.", "Se foi enviada, obtenha o hash para saber para onde foi."],
    "Los fondos siguen en origen mientras no se confirme.": ["The funds remain at the source until confirmed.", "Os fundos permanecem na origem até a confirmação."],
    "No se detecta ningún error en lo que hiciste; la transacción solo está esperando confirmación.": ["No issue with your actions was detected; the transaction is just waiting for confirmation.", "Nenhum erro na sua ação foi detectado; a transação está apenas aguardando confirmação."],
    "La operación no se hizo correctamente: el destino fue una dirección de quema.": ["The operation was not completed correctly: the destination was a burn address.", "A operação não foi realizada corretamente: o destino era um endereço de queima."],
    "La dirección de destino fue la del contrato del token en lugar de la de una wallet.": ["The destination was the token contract address instead of a wallet address.", "O destino foi o endereço do contrato do token, e não de uma carteira."],
    "La operación no se hizo correctamente: el receptor no es la dirección esperada.": ["The operation was not completed correctly: the recipient is not the expected address.", "A operação não foi realizada corretamente: o destinatário não é o endereço esperado."],
    "La operación se completó, pero fue un tipo de operación distinto del que buscabas.": ["The operation completed, but it was a different type of operation than the one you intended.", "A operação foi concluída, mas era diferente do tipo de operação desejado."],
    "El primer paso se hizo bien; falta completar el siguiente.": ["The first step succeeded; the next one still needs to be completed.", "A primeira etapa foi concluída; falta concluir a próxima."],
    "Del lado de la red, la operación se hizo correctamente. Falta la acreditación interna de la plataforma.": ["The operation succeeded on-chain. The platform still needs to credit it internally.", "A operação foi concluída na rede. Falta a plataforma realizar o crédito interno."],
    "Los fondos llegaron, pero a una red distinta de la esperada.": ["The funds arrived, but on a different network than expected.", "Os fundos chegaram, mas em uma rede diferente da esperada."],
    "El origen salió bien, pero la entrega tarda más de lo habitual": ["The source succeeded, but delivery is taking longer than usual", "A origem foi concluída, mas a entrega está demorando mais do que o normal"],
    "El origen salió bien; la llegada no se pudo confirmar todavía": ["The source succeeded; arrival could not be confirmed yet", "A origem foi concluída; ainda não foi possível confirmar a chegada"],
    "El dato de la dirección tiene un error que explica el problema.": ["The address information has an error that explains the issue.", "O endereço informado tem um erro que explica o problema."],
    "El dato declarado indica una red equivocada. Con el hash se puede comprobar.": ["The reported information indicates the wrong network. The hash can confirm it.", "As informações indicam a rede errada. O hash pode confirmar isso."],
    "Falta un dato obligatorio en el depósito.": ["A required deposit detail is missing.", "Falta uma informação obrigatória no depósito."],
    "Falta verificar la operación en el explorador de esa red.": ["The operation still needs to be checked in that network’s explorer.", "Ainda é preciso verificar a operação no explorador dessa rede."],
    "No hay evidencia de un error de tu parte; el estado depende del proveedor.": ["There is no evidence of an error on your part; the status depends on the provider.", "Não há evidências de erro da sua parte; o status depende do provedor."],
    "Sin transacción en la red no hay fondos en tránsito; el motivo del rechazo lo informa el proveedor.": ["Without an on-chain transaction, no funds are in transit; the provider can explain the rejection.", "Sem uma transação na rede, não há fundos em trânsito; o provedor pode informar o motivo da rejeição."],
    "No es posible evaluar la operación sin ver la transacción.": ["The operation cannot be evaluated without seeing the transaction.", "Não é possível avaliar a operação sem consultar a transação."],
    "No se pudo determinar el motivo exacto.": ["The exact reason could not be determined.", "Não foi possível determinar o motivo exato."],
    "No se puede determinar qué pasó con los fondos.": ["It is not possible to determine what happened to the funds.", "Não é possível determinar o que aconteceu com os fundos."],
    "Espera unos minutos y vuelve a consultar.": ["Wait a few minutes and check again.", "Aguarde alguns minutos e consulte novamente."],
    "Si no avanza, acelérala o cancélala desde la wallet usando el mismo nonce.": ["If it does not progress, speed it up or cancel it from your wallet using the same nonce.", "Se não avançar, acelere ou cancele pela carteira usando o mesmo nonce."],
    "Si la plataforma lo rechazó, no salió nada.": ["If the platform rejected it, nothing was sent.", "Se a plataforma a rejeitou, nada foi enviado."],
    "No reenvíes antes de tener su respuesta.": ["Do not send again before you receive a response.", "Não envie novamente antes de receber uma resposta."],
    "Pide el estado interno de la operación y, si corresponde, un reembolso.": ["Ask for the operation’s internal status and, if applicable, a refund.", "Peça o status interno da operação e, se aplicável, um reembolso."],
    "Si el proveedor ofrece un seguimiento por hash, consúltalo.": ["If the provider offers hash tracking, check it.", "Se o provedor oferecer acompanhamento por hash, consulte-o."],
    "Si el token no aparece, agrega su contrato manualmente o revisa los tokens ocultos.": ["If the token does not appear, add its contract manually or check hidden tokens.", "Se o token não aparecer, adicione o contrato manualmente ou confira os tokens ocultos."],
    "Confirma en el explorador que el token figura en tu dirección.": ["Confirm in the explorer that the token appears at your address.", "Confirme no explorador se o token aparece no seu endereço."],
    "No se detecta ningún error en el envío; falta evidencia sobre la entrega.": ["No issue with the transfer was detected; evidence about delivery is still missing.", "Nenhum erro no envio foi detectado; ainda faltam evidências sobre a entrega."],
    "No se detecta ningún problema con la operación.": ["No issue with the operation was detected.", "Nenhum problema com a operação foi detectado."],
    "Confirma que el saldo esté de vuelta en la cuenta de origen.": ["Confirm that the balance has returned to the source account.", "Confirme se o saldo voltou para a conta de origem."],
    "Pide al proveedor el motivo del rechazo.": ["Ask the provider for the reason for the rejection.", "Peça ao provedor o motivo da rejeição."],
    "Pide al proveedor el hash (TxID) del envío, o búscalo en tu historial de retiros.": ["Ask the provider for the transfer hash (TxID), or find it in your withdrawal history.", "Peça ao provedor o hash (TxID) da transferência ou procure-o no histórico de saques."],
    "Vuelve a ejecutar la evaluación con el hash.": ["Run the evaluation again with the hash.", "Faça uma nova avaliação usando o hash."],
    "Si el token no aparece, agrega su contrato manualmente o revisa los tokens ocultos.": ["If the token does not appear, add its contract manually or check hidden tokens.", "Se o token não aparecer, adicione o contrato manualmente ou confira os tokens ocultos."],
    "Consulta el estado en la plataforma con el hash.": ["Check the status with the platform using the hash.", "Consulte o status na plataforma usando o hash."],
    "Copia de nuevo el hash completo desde la plataforma.": ["Copy the full hash again from the platform.", "Copie novamente o hash completo da plataforma."],
    "Verifica con la plataforma por qué red se hizo la operación.": ["Ask the platform which network was used for the operation.", "Confirme com a plataforma em qual rede a operação foi feita."],
    "Si los fondos fueron a una dirección o red equivocada, contacta a la plataforma con el hash.": ["If the funds were sent to the wrong address or network, contact the platform with the hash.", "Se os fundos foram enviados para o endereço ou rede errada, entre em contato com a plataforma e informe o hash."],
  };
  function localizeCopy(value) {
    if (locale() === "es" || typeof value !== "string") return value;
    if (COPY[value]) return COPY[value][locale() === "en" ? 0 : 1];
    let result = value;
    for (const [source, translations] of Object.entries(COPY)) {
      if (source.length < 24 || !result.includes(source)) continue;
      result = result.split(source).join(translations[locale() === "en" ? 0 : 1]);
    }
    return result;
  }
  function localizeDiagnosisIssue(issue) {
    if (locale() === "es") return issue;
    const storedText = (value) => typeof K.localizeDiagnosisText === "function" ? K.localizeDiagnosisText(value) : value;
    const translated = {
      ...issue,
      title: localizeCopy(storedText(issue.title)),
      detail: localizeCopy(storedText(issue.detail)),
      action: localizeCopy(storedText(issue.action)),
    };
    const titles = {
      origin_replaced: ["The transaction was replaced or dropped", "A transação foi substituída ou descartada"],
      origin_pending: ["The transaction is still pending", "A transação ainda está pendente"],
      burn_target: ["The transaction was sent to a burn address", "A transação foi enviada para um endereço de queima"],
      approval_only: ["This transaction only granted permission (approve); it did not move funds", "Esta transação apenas concedeu uma permissão (approve); não transferiu fundos"],
      burn_recipient: ["Funds were sent to a burn address", "Os fundos foram enviados para um endereço de queima"],
      direct_credit: ["Direct transfer to the expected destination", "Transferência direta para o destino esperado"],
      address_poisoning: ["The recipient looks like your wallet but is NOT the same address", "O destinatário parece sua carteira, mas NÃO é o mesmo endereço"],
      address_typo: ["The recipient is almost identical to your wallet (possible typing error)", "O destinatário é quase igual à sua carteira (possível erro de digitação)"],
      recipient_mismatch: ["The transfer recipient is not the expected wallet", "O destinatário da transferência não é a carteira esperada"],
      sent_to_token_contract: ["Tokens were sent to a token contract address", "Os tokens foram enviados para o endereço de um contrato de token"],
      recipient_is_contract: ["The recipient is a smart contract, not a regular wallet", "O destinatário é um contrato inteligente, não uma carteira comum"],
      sender_is_wallet: ["The sender is the same as the destination wallet", "O remetente é a própria carteira de destino"],
      wallet_encoded: ["The expected wallet appears encoded in the transaction", "A carteira esperada aparece codificada na transação"],
      wallet_not_referenced: ["The expected wallet does not appear in the source transaction", "A carteira esperada não aparece na transação de origem"],
      dex_swap: ["The transaction is a DEX swap", "A transação é um swap em uma DEX"],
      dex_not_bridge: ["This was a swap, not a transfer between networks", "Isto foi um swap, não uma transferência entre redes"],
      l2_withdrawal_delay: ["Withdrawing from an L2 network to Ethereum is not immediate", "Sacar de uma rede L2 para Ethereum não é imediato"],
      unverified_catalog_match: ["The bridge match comes from an unverified entry", "A correspondência de ponte vem de uma entrada não verificada"],
      nft_transfer: ["The transaction transferred an NFT (ERC-721)", "A transação transferiu um NFT (ERC-721)"],
      no_assets_moved: ["The transaction was confirmed but moved no visible value", "A transação foi confirmada, mas não transferiu valor visível"],
    };
    if (titles[issue.id]) translated.title = titles[issue.id][locale() === "en" ? 0 : 1];
    if (issue.id === "origin_failed") {
      const chain = issue.title.replace("La transacción falló en ", "");
      translated.title = locale() === "en" ? `The transaction failed on ${chain}` : `A transação falhou em ${chain}`;
    }
    if (issue.id === "wrong_network_delivery") {
      translated.title = locale() === "en"
        ? issue.title.replace("Los fondos llegaron a tu wallet en ", "Funds reached your wallet on ").replace(", no en ", ", not on ")
        : issue.title.replace("Los fondos llegaron a tu wallet en ", "Os fundos chegaram à sua carteira em ").replace(", no en ", ", não em ");
    }
    if (issue.id === "unknown_token") {
      translated.title = locale() === "en" ? issue.title.replace("Token no reconocido:", "Unrecognized token:") : issue.title.replace("Token no reconocido:", "Token não reconhecido:");
    }
    if (issue.id === "token_variant") {
      translated.title = locale() === "en" ? issue.title.replace("Variante de token:", "Token variant:") : issue.title.replace("Variante de token:", "Variante de token:");
    }
    if (issue.id === "contract_wallet_missing_on_destination") {
      translated.title = locale() === "en"
        ? issue.title.replace("La wallet es un contrato en ", "The wallet is a contract on ").replace(" pero no existe en ", " but does not exist on ")
        : issue.title.replace("La wallet es un contrato en ", "A carteira é um contrato em ").replace(" pero no existe en ", " mas não existe em ");
    }
    if (issue.id === "destination_is_contract") {
      translated.title = locale() === "en"
        ? issue.title.replace("La wallet es un contrato inteligente en ", "The wallet is a smart contract on ")
        : issue.title.replace("La wallet es un contrato inteligente en ", "A carteira é um contrato inteligente em ");
    }
    if (issue.id === "dex_not_bridge") {
      translated.title = locale() === "en"
        ? issue.title.replace("Esto fue un swap en ", "This was a swap on ").replace(", no una transferencia entre redes", ", not a transfer between networks")
        : issue.title.replace("Esto fue un swap en ", "Isto foi um swap em ").replace(", no una transferencia entre redes", ", não uma transferência entre redes");
    }
    if (issue.id === "burn_target") {
      const match = issue.detail.match(/^El destino directo es (.+)\. Los fondos enviados ahí quedan inaccesibles\.$/);
      if (match) translated.detail = locale() === "en" ? `The direct destination is ${match[1]}. Funds sent there become inaccessible.` : `O destino direto é ${match[1]}. Os fundos enviados para lá ficam inacessíveis.`;
      translated.title = t(issue.title, "The transaction was sent to a burn address", "A transação foi enviada para um endereço de queima");
      translated.action = t(issue.action, "Contact the service’s support team as soon as possible with the hash; recovery is usually not possible.", "Entre em contato com o suporte do serviço o quanto antes e informe o hash; normalmente não é possível recuperar os fundos.");
    } else if (issue.id === "burn_recipient") {
      const match = issue.detail.match(/^El receptor de la transferencia es (.+); los fondos quedaron inaccesibles\.$/);
      if (match) translated.detail = locale() === "en" ? `The transfer recipient is ${match[1]}; the funds are inaccessible.` : `O destinatário da transferência é ${match[1]}; os fundos ficaram inacessíveis.`;
      translated.title = t(issue.title, "Funds were sent to a burn address", "Os fundos foram enviados para um endereço de queima");
      translated.action = t(issue.action, "Contact the service’s support team as soon as possible with the hash; recovery is usually not possible.", "Entre em contato com o suporte do serviço o quanto antes e informe o hash; normalmente não é possível recuperar os fundos.");
    } else if (issue.id === "origin_pending") {
      translated.detail = t(issue.detail, "The transaction has not been included in a block yet. This is often due to low gas or network congestion.", "A transação ainda não foi incluída em um bloco. Isso geralmente ocorre por gas baixo ou congestionamento da rede.");
      translated.action = t(issue.action, "Wait a few minutes; if it does not progress, speed it up or cancel it from your wallet using the same nonce.", "Aguarde alguns minutos; se não avançar, acelere ou cancele pela carteira usando o mesmo nonce.");
    } else if (issue.id === "origin_replaced") {
      translated.action = t(issue.action, "Find the transaction with the same nonce in the explorer; it may be a cancellation or a speed-up with another hash.", "Procure no explorador a transação com o mesmo nonce; pode ser um cancelamento ou uma aceleração com outro hash.");
      const match = issue.detail.match(/^La cuenta (.+) ya usó el nonce (\d+) en otra transacción, así que esta nunca se confirmará\. Por esta transacción no salió ningún fondo\.$/);
      if (match) translated.detail = locale() === "en"
        ? `Account ${match[1]} already used nonce ${match[2]} in another transaction, so this one will never be confirmed. No funds were sent in this transaction.`
        : `A conta ${match[1]} já usou o nonce ${match[2]} em outra transação, então esta nunca será confirmada. Nenhum fundo foi enviado nesta transação.`;
    } else if (issue.id === "approval_only") {
      const match = issue.detail.match(/^Autorizó a (.+) a gastar el token (.+), pero ese gasto se hace en una segunda transacción\.$/);
      if (match) translated.detail = locale() === "en"
        ? `It authorized ${match[1]} to spend token ${match[2]}, but that spend happens in a second transaction.`
        : `Autorizou ${match[1]} a gastar o token ${match[2]}, mas esse gasto ocorre em uma segunda transação.`;
    } else if (issue.id === "direct_credit") {
      const chain = issue.detail.match(/en ([^.]+)\.$/);
      if (chain) translated.detail = locale() === "en"
        ? `The transaction sent funds directly to the expected wallet on ${chain[1]}.`
        : `A transação enviou fundos diretamente para a carteira esperada em ${chain[1]}.`;
    } else if (issue.id === "sender_is_wallet") {
      translated.detail = t(issue.detail, "The transaction was sent from the expected wallet itself; check whether it was meant to go to another network or address.", "A transação saiu da própria carteira esperada; confira se a intenção era enviar para outra rede ou endereço.");
    } else if (issue.id === "wallet_encoded") {
      translated.detail = t(issue.detail, "It appears in the call or events alongside a known bridge/router contract, supporting that it is the recipient.", "Ela aparece na chamada ou nos eventos junto com um contrato conhecido de ponte/roteador, o que indica que é o destinatário.");
    } else if (issue.id === "wallet_not_referenced") {
      translated.detail = t(issue.detail, "This is normal if the transfer came from an exchange or intermediary contract; otherwise, verify that the address is correct.", "Isso é normal se a transferência saiu de uma exchange ou contrato intermediário; caso contrário, confira se o endereço está correto.");
      translated.action = t(issue.action, "If an exchange was involved, ask for its withdrawal receipt and check the destination on the specified network.", "Se houve uma exchange, peça o comprovante de saque e confira o destino na rede indicada.");
    } else if (issue.id === "destination_is_contract") {
      translated.detail = t(issue.detail, "A contract may reject ETH or tokens if it is not designed to receive them.", "Um contrato pode rejeitar ETH ou tokens se não estiver preparado para recebê-los.");
    } else if (issue.id === "dex_swap") {
      const target = issue.detail.match(/Llamó a (.+) en (.+)\.$/);
      if (target) translated.detail = locale() === "en" ? `Called ${target[1]} on ${target[2]}.` : `Chamou ${target[1]} em ${target[2]}.`;
    } else if (issue.id === "dex_not_bridge") {
      const chain = issue.detail.match(/en ([^.]+)\.$/);
      if (chain) translated.detail = locale() === "en"
        ? `The transaction called a DEX contract on ${chain[1]}; it did not send funds to another network.`
        : `A transação chamou um contrato DEX em ${chain[1]}; ela não enviou fundos para outra rede.`;
    } else if (issue.id === "l2_withdrawal_delay") {
      translated.detail = t(issue.detail, "Withdrawals through the native Optimism, Base and Arbitrum bridges have a dispute period of about 7 days, followed by a final claim transaction on Ethereum.", "Saques pelas pontes nativas da Optimism, Base e Arbitrum passam por um período de contestação de cerca de 7 dias e depois exigem uma transação final de resgate na Ethereum.");
      translated.action = t(issue.action, "Check the withdrawal status on the official bridge; the funds are delayed, not lost.", "Confira o status do saque na ponte oficial; os fundos estão demorando, não foram perdidos.");
    } else if (issue.id === "unverified_catalog_match") {
      translated.detail = t(issue.detail, "The detected contract is in the legacy catalog, which has not been validated against official sources; it is only a route hint.", "O contrato detectado está no catálogo legado, que não foi validado em fontes oficiais; é apenas uma pista sobre a rota.");
    } else if (issue.id === "token_variant") {
      translated.detail = t(issue.detail, "This network has more than one version of the token (native and bridged). They are different contracts, and some apps accept only one.", "Esta rede tem mais de uma versão do token (nativa e bridged). São contratos diferentes, e alguns aplicativos aceitam apenas uma delas.");
    } else if (issue.id === "nft_transfer") {
      translated.detail = t(issue.detail, "A fungible-token amount does not apply to this transfer; check the NFT in the explorer.", "O valor de tokens fungíveis não se aplica a esta transferência; confira o NFT no explorador.");
    } else if (issue.id === "no_assets_moved") {
      translated.detail = t(issue.detail, "There was no ETH transfer or token Transfer event. This may be a contract instruction or an internal transfer not shown in the receipt.", "Não houve transferência de ETH nem evento Transfer de token. Pode ter sido uma instrução a um contrato ou uma transferência interna que não aparece no recibo.");
      translated.action = t(issue.action, "Check internal transactions and events in the explorer before concluding that no transfer occurred.", "Confira as transações internas e os eventos no explorador antes de concluir que não houve transferência.");
    }
    if (issue.id === "origin_failed") {
      const feeMatch = issue.detail.match(/ El gas ya consumido \(≈ ([^)]+)\) no se reembolsa, pero los fondos principales no se movieron\.$/);
      const fee = feeMatch
        ? t(` El gas ya consumido (≈ ${feeMatch[1]}) no se reembolsa, pero los fondos principales no se movieron.`, ` The gas already spent (≈ ${feeMatch[1]}) is not refunded, but the principal funds did not move.`, ` O gas já gasto (≈ ${feeMatch[1]}) não é reembolsado, mas os fundos principais não foram transferidos.`)
        : t(" Los fondos principales no se movieron.", " The principal funds did not move.", " Os fundos principais não foram transferidos.");
      const gasFailure = issue.detail.match(/^Se agotó el gas \(usó el 100% del límite\)\./);
      const revert = issue.detail.match(/^El contrato revirtió con el motivo: «(.+)»\./);
      translated.detail = gasFailure
        ? t(`The transaction ran out of gas (it used 100% of the limit).${fee}`, `The transaction ran out of gas (it used 100% of the limit).${fee}`, `A transação ficou sem gas (usou 100% do limite).${fee}`)
        : revert
          ? locale() === "en" ? `The contract reverted with reason: “${revert[1]}”.${fee}` : `O contrato reverteu com o motivo: “${revert[1]}”.${fee}`
          : t(`La ejecución revirtió; no se pudo determinar el motivo exacto.${fee}`, `Execution reverted; the exact reason could not be determined.${fee}`, `A execução foi revertida; não foi possível determinar o motivo exato.${fee}`);
      translated.action = issue.detail.startsWith("Se agotó el gas")
        ? t("Reintenta con un límite de gas mayor.", "Try again with a higher gas limit.", "Tente novamente com um limite de gas maior.")
        : t("Revisa saldo suficiente, permisos (approve) y parámetros como slippage o fecha límite antes de reintentar. Los fondos siguen en la wallet de origen.", "Before retrying, check that you have enough balance and permissions (approve), and review settings such as slippage or deadline. The funds remain in the source wallet.", "Antes de tentar novamente, confira se há saldo e permissões (approve) suficientes e revise parâmetros como slippage ou prazo. Os fundos continuam na carteira de origem.");
    } else if (issue.id === "approval_only") {
      translated.action = t("Completa el paso siguiente (swap, depósito o bridge) en la aplicación. Si no reconoces el permiso, revócalo.", "Complete the next step (swap, deposit or bridge) in the app. If you do not recognize this permission, revoke it.", "Conclua a próxima etapa (swap, depósito ou ponte) no aplicativo. Se não reconhecer essa permissão, revogue-a.");
    } else if (issue.id === "wrong_network_delivery") {
      const detail = issue.detail.match(/^Fue una transferencia directa dentro de (.+): no cruzó a (.+)\. Si buscas el saldo en (.+), no lo vas a encontrar ahí\.$/);
      const action = issue.action.match(/^Revisa el saldo de esa wallet seleccionando la red (.+)\. Para llevarlo a (.+) necesitas un puente\.$/);
      if (detail) translated.detail = locale() === "en"
        ? `This was a direct transfer on ${detail[1]}; it did not move to ${detail[2]}. If you are looking for the balance on ${detail[3]}, it will not be there.`
        : `Foi uma transferência direta na ${detail[1]}; ela não foi para ${detail[2]}. Se estiver procurando o saldo na ${detail[3]}, não o encontrará lá.`;
      if (action) translated.action = locale() === "en"
        ? `Check that wallet’s balance on ${action[1]}. To move it to ${action[2]}, you need a bridge.`
        : `Confira o saldo dessa carteira na ${action[1]}. Para transferi-lo para ${action[2]}, você precisa de uma ponte.`;
    } else if (issue.id === "address_poisoning") {
      const match = issue.detail.match(/^Se envió a (.+), mientras que la esperada es (.+)\. Coinciden el inicio y el final pero no el medio: es el patrón típico de «address poisoning» \(dirección falsa en el historial\) o de un error al copiar\.$/);
      if (match) translated.detail = locale() === "en"
        ? `Funds were sent to ${match[1]}, but the expected address is ${match[2]}. The beginning and end match, but the middle does not. This is typical of address poisoning (a fake address in transaction history) or a copying mistake.`
        : `Os fundos foram enviados para ${match[1]}, mas o endereço esperado é ${match[2]}. O início e o fim coincidem, mas o meio não. Esse é o padrão típico de address poisoning (endereço falso no histórico) ou de erro ao copiar.`;
      translated.action = t("No envíes más fondos. Verifica la dirección completa y reporta el caso; los fondos enviados a una dirección ajena normalmente no son recuperables.", "Do not send more funds. Verify the full address and report this; funds sent to someone else’s address usually cannot be recovered.", "Não envie mais fundos. Confira o endereço completo e denuncie o caso; normalmente não é possível recuperar fundos enviados para o endereço de outra pessoa.");
    } else if (issue.id === "address_typo") {
      const match = issue.detail.match(/^Se envió a (.+); la esperada es (.+)\. Difieren en solo (\d+) caracteres\.$/);
      if (match) translated.detail = locale() === "en"
        ? `Funds were sent to ${match[1]}; the expected address is ${match[2]}. They differ by only ${match[3]} characters.`
        : `Os fundos foram enviados para ${match[1]}; o endereço esperado é ${match[2]}. Eles diferem em apenas ${match[3]} caracteres.`;
      translated.action = t("Compara ambas direcciones carácter por carácter. Si no controlas el receptor, los fondos probablemente no son recuperables.", "Compare both addresses character by character. If you do not control the recipient, the funds are probably unrecoverable.", "Compare os dois endereços caractere por caractere. Se não controla o destinatário, provavelmente não será possível recuperar os fundos.");
    } else if (issue.id === "recipient_mismatch") {
      const match = issue.detail.match(/^La transacción envió a (.+), distinta de la wallet esperada \((.+)\)\. Si el receptor es un exchange o servicio, la acreditación puede depender de ellos\.$/);
      if (match) translated.detail = locale() === "en"
        ? `The transaction sent funds to ${match[1]}, not the expected wallet (${match[2]}). If the recipient is an exchange or service, crediting the funds may depend on them.`
        : `A transação enviou fundos para ${match[1]}, e não para a carteira esperada (${match[2]}). Se o destinatário for uma exchange ou serviço, o crédito pode depender deles.`;
      translated.action = t("Confirma qué dirección se pretendía usar. Si fue un exchange, pide al soporte que busque el depósito con este hash.", "Confirm which address was intended. If it was an exchange, ask its support team to look for the deposit using this hash.", "Confirme qual endereço deveria ter sido usado. Se foi uma exchange, peça ao suporte para localizar o depósito usando este hash.");
    } else if (issue.id === "sent_to_token_contract") {
      const match = issue.detail.match(/^El receptor (.+) es el contrato de un token, no una wallet\. Los contratos de token normalmente no pueden devolver tokens recibidos por error\.$/);
      if (match) translated.detail = locale() === "en"
        ? `Recipient ${match[1]} is a token contract, not a wallet. Token contracts usually cannot return tokens sent to them by mistake.`
        : `O destinatário ${match[1]} é um contrato de token, não uma carteira. Normalmente, contratos de token não podem devolver tokens recebidos por engano.`;
      translated.action = t("Contacta al equipo del token con el hash; la recuperación solo es posible si el contrato tiene una función de rescate.", "Contact the token team with the hash. Recovery is possible only if the contract has a rescue function.", "Entre em contato com a equipe do token e informe o hash. A recuperação só será possível se o contrato tiver uma função de resgate.");
    } else if (issue.id === "recipient_is_contract") {
      const match = issue.detail.match(/^(.+) tiene código desplegado en (.+)\. Si no es un contrato diseñado para recibir estos fondos \(p\. ej\. una wallet Safe propia\), pueden quedar atrapados\.$/);
      if (match) translated.detail = locale() === "en"
        ? `${match[1]} has code deployed on ${match[2]}. Unless it is a contract designed to receive these funds (for example, your own Safe wallet), they may be stuck.`
        : `${match[1]} tem código implantado na ${match[2]}. Se não for um contrato projetado para receber esses fundos (por exemplo, uma carteira Safe própria), eles podem ficar presos.`;
      translated.action = t("Revisa en el explorador qué contrato es y si tiene función de retiro.", "Check the block explorer to identify the contract and see whether it has a withdrawal function.", "Consulte o explorador para identificar o contrato e verificar se ele tem uma função de saque.");
    } else if (issue.id === "contract_wallet_missing_on_destination") {
      const match = issue.detail.match(/^Las wallets de contrato \(Safe, cuentas inteligentes\) tienen una dirección distinta o no desplegada en cada red; quien controla esa dirección en (.+) puede no controlarla en (.+)\.$/);
      if (match) translated.detail = locale() === "en"
        ? `Contract wallets (Safes, smart accounts) may have a different address or may not be deployed on every network. Whoever controls that address on ${match[1]} may not control it on ${match[2]}.`
        : `Carteiras de contrato (Safes, contas inteligentes) podem ter endereços diferentes ou não estar implantadas em todas as redes. Quem controla esse endereço na ${match[1]} pode não controlá-lo na ${match[2]}.`;
      translated.action = t("Antes de enviar a otra red, confirma que la misma dirección esté desplegada y controlada por ti en la red destino.", "Before sending to another network, confirm that the same address is deployed there and that you control it.", "Antes de enviar para outra rede, confirme se o mesmo endereço está implantado nela e se você o controla.");
    } else if (issue.id === "dex_not_bridge") {
      const action = issue.action.match(/^Revisa el saldo del nuevo token en la wallet seleccionando la red (.+)\. Para enviarlo a (.+) necesitas un puente\.$/);
      if (action) translated.action = locale() === "en"
        ? `Check your wallet’s balance of the new token on ${action[1]}. To move it to ${action[2]}, you need a bridge.`
        : `Confira o saldo do novo token na carteira selecionando a rede ${action[1]}. Para transferi-lo para ${action[2]}, você precisa de uma ponte.`;
    } else if (issue.id === "unknown_token") {
      translated.detail = t(issue.detail, "It is not in 4kiscan’s list of equivalent tokens, so its counterpart on other networks cannot be verified. A bridge may not support it or may deliver it as a different contract.", "Ele não está na lista de tokens equivalentes do 4kiscan, então não é possível verificar sua equivalência em outras redes. Uma ponte pode não aceitá-lo ou entregá-lo como outro contrato.");
      translated.action = t(issue.action, "Check the block explorer to confirm that it is the official token and that the destination bridge supports it.", "Confira no explorador se esse é o token oficial e se a ponte de destino o aceita.");
    }
    return translated;
  }
  function localizeChecks(checks, ctx) {
    if (locale() === "es") return checks;
    return checks.map((c) => {
      let title = c.title;
      if (c.id === "network_choice") {
        if (c.status === "unknown") title = t("No se puede comparar la red de envío con la esperada", "Cannot compare the sending network with the expected network", "Não é possível comparar a rede de envio com a rede esperada");
        else if (title.startsWith("La red de envío coincide")) title = locale() === "en" ? `The sending network matches the expected network (${ctx.A.src_network})` : `A rede de envio corresponde à rede esperada (${ctx.A.src_network})`;
        else if (title.startsWith("Enviaste por")) title = locale() === "en" ? `You sent on ${ctx.A.src_network}, but the destination expected ${ctx.A.dst_network}` : `Você enviou pela ${ctx.A.src_network}, mas o destino esperava ${ctx.A.dst_network}`;
        else if (title === "El origen y el destino son la misma red") title = t(title, "The source and destination are the same network", "A origem e o destino são a mesma rede");
        else if (title.startsWith("Ruta de puente:")) title = locale() === "en" ? `Bridge route: ${ctx.A.src_network} → ${ctx.A.dst_network}` : `Rota da ponte: ${ctx.A.src_network} → ${ctx.A.dst_network}`;
      } else if (c.id === "network_not_verifiable") {
        title = locale() === "en" ? `Cannot verify ${ctx.A.src_network === ctx.A.dst_network ? ctx.A.src_network : [ctx.A.src_network, ctx.A.dst_network].filter((n) => ["unsupported_evm", "non_evm"].includes(K.networkKind(n))).join(" / ")} on-chain` : `Não é possível verificar ${[ctx.A.src_network, ctx.A.dst_network].filter((n) => ["unsupported_evm", "non_evm"].includes(K.networkKind(n))).join(" / ")} na rede`;
      } else if (c.id === "address_network") {
        title = c.status === "ok"
          ? locale() === "en" ? `The address format matches ${ctx.A.dst_network}` : `O formato do endereço corresponde a ${ctx.A.dst_network}`
          : locale() === "en" ? `The address format does not match ${ctx.A.dst_network}` : `O formato do endereço não corresponde a ${ctx.A.dst_network}`;
      } else if (c.id === "onchain_status" && title.startsWith("La transacción existe")) {
        title = locale() === "en" ? `The transaction exists and succeeded on ${ctx.D.chain}` : `A transação existe e foi concluída em ${ctx.D.chain}`;
      } else if (c.id === "onchain_status" && title.startsWith("La transacción falló")) {
        title = locale() === "en" ? `The transaction failed on ${ctx.D.chain}` : `A transação falhou em ${ctx.D.chain}`;
      } else if (c.id === "provider_status") {
        const provider = ctx.provider ? ctx.provider.label : t("El proveedor", "The provider", "O provedor");
        const status = ctx.A.provider_status;
        if (status === "completed_sent") {
          title = locale() === "en" ? `${provider} reports the operation as completed/sent` : `${provider} informa que a operação foi concluída/enviada`;
          c = { ...c, detail: ctx.A.tx_hash
            ? t("Eso debería corresponder a una transacción en la red; el hash permite confirmarlo.", "That should correspond to an on-chain transaction; the hash can confirm it.", "Isso deve corresponder a uma transação na rede; o hash pode confirmar.")
            : t("Si ya la envió, debe existir una transacción en la red: pídele el hash (TxID) para poder verificar adónde fue.", "If it was sent, there should be an on-chain transaction. Ask for the hash (TxID) to verify where it went.", "Se foi enviada, deve haver uma transação na rede. Peça o hash (TxID) para verificar para onde foi.") };
        } else if (status === "processing") {
          title = locale() === "en" ? `${provider} shows the operation as processing` : `${provider} mostra a operação em andamento`;
          c = { ...c, detail: t("Mientras esté en proceso en sus sistemas, puede no existir aún una transacción en la red.", "While it is being processed in the provider’s systems, an on-chain transaction may not exist yet.", "Enquanto estiver em processamento nos sistemas do provedor, talvez ainda não exista uma transação na rede.") };
        } else if (status === "review") {
          title = locale() === "en" ? `${provider} has the operation under review` : `${provider} está analisando a operação`;
          c = { ...c, detail: t(
            "Las revisiones de seguridad o verificación las hace el proveedor y no dependen de la red ni de ti; el soporte del proveedor es quien puede informar el motivo y el plazo.",
            "Security and identity reviews are handled by the provider, not the network or you; only the provider’s support team can explain the reason and timeframe.",
            "As análises de segurança ou identidade são feitas pelo provedor, não pela rede nem por você; somente o suporte do provedor pode informar o motivo e o prazo."
          ) };
        } else if (status === "rejected") {
          title = locale() === "en" ? `${provider} shows the operation as rejected or cancelled` : `${provider} mostra a operação como rejeitada ou cancelada`;
          c = { ...c, detail: t(
            "Normalmente, si no llegó a salir a la red, los fondos permanecen o se reintegran a la cuenta de origen. Confirma el saldo en el origen.",
            "If it was not sent to the network, the funds usually remain in or are returned to the source account. Check the source balance.",
            "Se não chegou a ser enviada à rede, os fundos geralmente permanecem na conta de origem ou são devolvidos a ela. Confira o saldo na origem."
          ) };
        } else if (status === "no_info") {
          title = t("El proveedor no muestra ningún estado", "The provider shows no status", "O provedor não exibe um status");
          c = { ...c, detail: t(
            "Sin estado visible no se puede saber si la operación llegó a salir; el soporte del proveedor puede confirmarlo.",
            "Without a visible status, it is not possible to know whether the operation was sent; the provider’s support team can confirm.",
            "Sem um status visível, não é possível saber se a operação foi enviada; o suporte do provedor pode confirmar."
          ) };
        }
      } else if (c.id === "timing") {
        const label = ctx.timing.label.toLowerCase();
        const elapsed = ctx.elapsed && ctx.elapsed.basis === "chain" ? humanDuration(ctx.elapsed.min) : null;
        if (ctx.timingStatus === "within") {
          title = locale() === "en" ? `Still within the usual timeframe for ${label}` : `Ainda dentro do prazo habitual para ${label}`;
          c = { ...c, detail: locale() === "en"
            ? `The usual timeframe is ${ctx.timing.expected}.${elapsed ? ` Elapsed time: ${elapsed}.` : ""} This is an estimate, not a provider guarantee.`
            : `O prazo habitual é ${ctx.timing.expected}.${elapsed ? ` Tempo decorrido: ${elapsed}.` : ""} Esta é uma estimativa, não uma garantia do provedor.` };
        } else if (ctx.timingStatus === "beyond") {
          title = locale() === "en" ? `More time than usual has passed for ${label}` : `O tempo passou do habitual para ${label}`;
          c = { ...c, detail: locale() === "en"
            ? `The usual timeframe is ${ctx.timing.expected}.${elapsed ? ` Elapsed time: ${elapsed}.` : ""} This is an estimate; a longer delay is a reason to contact the provider.`
            : `O prazo habitual é ${ctx.timing.expected}.${elapsed ? ` Tempo decorrido: ${elapsed}.` : ""} Esta é uma estimativa; um atraso maior é motivo para consultar o provedor.` };
        } else {
          title = t("El tiempo transcurrido está cerca del límite habitual", "The elapsed time is close to the usual threshold", "O tempo decorrido está próximo do limite habitual");
          c = { ...c, detail: locale() === "en"
            ? `The usual timeframe for ${label} is ${ctx.timing.expected}. The hash can be used to calculate the exact elapsed time.`
            : `O prazo habitual para ${label} é ${ctx.timing.expected}. Com o hash, é possível calcular o tempo exato decorrido.` };
        }
      } else if (c.id === "delivery" && ctx.delivery === "not_found") {
        const searched = ctx.R && ctx.R.searchedNetworks ? ctx.R.searchedNetworks.length : 5;
        c = { ...c, detail: locale() === "en"
          ? `The ${searched} supported networks were searched within the inspected windows (up to 48 hours after sending). This does not prove delivery failed; it may still be in progress.`
          : `As ${searched} redes compatíveis foram pesquisadas dentro dos períodos analisados (até 48 horas após o envio). Isso não prova que a entrega falhou; ela ainda pode estar em andamento.` };
      } else if (c.id === "delivery" && (ctx.inboundState === "found" || ctx.inboundState === "found_other")) {
        const transfer = ctx.E.inbound.transfer;
        const hash = transfer && transfer.hash ? ` Hash: ${transfer.hash}.` : "";
        title = locale() === "en"
          ? `A compatible incoming transfer was found on ${ctx.E.inbound.matchedChain}`
          : `Foi encontrada uma transferência de entrada compatível em ${ctx.E.inbound.matchedChain}`;
        c = { ...c, detail: locale() === "en"
          ? `It matches by wallet${ctx.inboundMatchedByDeclared ? ", reported asset and amount" : ""} within the last 24 hours.${hash} This is a match, not proof that it is your transaction.`
          : `A correspondência considera a carteira${ctx.inboundMatchedByDeclared ? ", o ativo e o valor informados" : ""} nas últimas 24 horas.${hash} É uma correspondência, não uma prova de que seja sua operação.` };
      }
      return { ...c, title: localizeCopy(title), detail: localizeCopy(c.detail) };
    });
  }

  // ───────────── API pública ─────────────
  function evaluate(answers, evidence) {
    const A = answers || {};
    const E = evidence || { errors: [], nowSeconds: Math.floor(Date.now() / 1000) };
    E.errors = E.errors || [];
    E.nowSeconds = E.nowSeconds || Math.floor(Date.now() / 1000);

    const ctx = buildContext(A, E);
    const checks = buildChecks(ctx);
    const key = decide(ctx);
    const v = localizeVerdictCopy(key, ctx, VERDICTS[key](ctx));
    v.headline = localizeHeadline(key, v.headline, ctx);
    const confidence = buildConfidence(ctx, key);

    const alerts = [];
    if (A.third_party === "yes") {
      alerts.push({
        id: "possible_scam", severity: "warning",
        title: t("Posible patrón de estafa", "Possible scam pattern", "Possível padrão de golpe"),
        detail: t("Indicaste que alguien te pidió hacer este envío. Antes de enviar más fondos, verifica la identidad de esa persona o servicio con un canal oficial; nadie legítimo te pide enviar cripto para «desbloquear», «validar» o «reclamar» fondos.", "You indicated that someone asked you to make this transfer. Before sending more funds, verify their identity through an official channel; no legitimate person or service asks you to send crypto to “unlock,” “validate” or “claim” funds.", "Você informou que alguém pediu que fizesse esta transferência. Antes de enviar mais fundos, confirme a identidade dessa pessoa ou serviço por um canal oficial; ninguém legítimo pede que você envie cripto para “desbloquear”, “validar” ou “resgatar” fundos."),
      });
    }
    if (ctx.D && ctx.has("address_poisoning")) {
      alerts.push({
        id: "address_poisoning", severity: "critical",
        title: t("Patrón de envenenamiento de direcciones", "Address poisoning pattern", "Padrão de envenenamento de endereço"),
        detail: t("La dirección receptora imita el inicio y el final de la tuya. No envíes más fondos desde el historial; copia siempre desde la fuente.", "The recipient address imitates the beginning and end of yours. Do not send funds using an address from your history; always copy it from the original source.", "O endereço destinatário imita o início e o final do seu. Não envie mais fundos usando um endereço do histórico; sempre copie-o da fonte original."),
      });
    }

    const issueSteps = (ctx.D ? ctx.D.issues : []).filter((i) => i.action && ["critical", "error", "warn"].includes(i.severity) && !["origin_failed", "origin_replaced", "origin_pending"].includes(i.id)).map((i) => localizeDiagnosisIssue(i).action);
    const nextSteps = dedupe([...v.steps, ...(v.level === "ok" ? [] : issueSteps)]);
    const concepts = uniq([...v.concepts, ...checks.filter((c) => c.status !== "ok").flatMap((c) => c.concepts), ...(ctx.A.symptom === "not_visible" ? ["tokens_no_visibles"] : [])]).slice(0, 8);

    const explanation = [v.happened, v.why].filter(Boolean);
    const userText = (value) => Array.isArray(value) ? value.map(userText) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, userText(v)]))
      : localizeCopy(value);
    return {
      verdict: { code: key, level: v.level, headline: localizeCopy(v.headline) },
      explanation: userText(explanation),
      recoverability: userText(v.recover),
      clientOperation: { rating: v.rating, summary: localizeCopy(v.ratingText) },
      checks: userText(localizeChecks(checks, ctx)),
      facts: userText(buildFacts(ctx)),
      alerts: userText(alerts),
      nextSteps: userText(nextSteps),
      concepts,
      confidence,
      limits: userText(buildLimits(ctx)),
      context: { txState: ctx.txState, delivery: ctx.delivery, timingStatus: ctx.timingStatus, deliveryChain: ctx.deliveryChain, protocol: ctx.protocol },
    };
  }

  Object.assign(K, { evaluate, EVALUATOR_VERDICTS: Object.keys(VERDICTS) });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
