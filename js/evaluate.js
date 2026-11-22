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

  const lower = (v) => String(v == null ? "" : v).toLowerCase();
  const uniq = (list) => [...new Set(list.filter(Boolean))];
  const SOURCE_FLOWS = ["exchange_withdrawal", "exchange_deposit", "wallet_transfer"];

  // ───────────── Utilidades de texto ─────────────
  function explorerTx(chain, hash) {
    return K.CHAINS[chain] && hash ? `${K.CHAINS[chain].explorer}/tx/${hash}` : null;
  }
  function humanDuration(minutes) {
    if (!Number.isFinite(minutes)) return "más de lo indicado";
    if (minutes < 1) return "menos de 1 minuto";
    if (minutes < 90) return `${Math.round(minutes)} minutos`;
    if (minutes < 48 * 60) return `${Math.round(minutes / 60)} horas`;
    return `${Math.round(minutes / (24 * 60))} días`;
  }
  const PROVIDER_STATUS_TEXT = {
    completed_sent: "completada / enviada",
    processing: "en proceso",
    review: "en revisión",
    rejected: "rechazada o cancelada",
    no_info: "sin estado visible",
  };

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
    return "los fondos";
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
        add(`chain_${issue.id}`, "onchain", status, issue.title, issue.detail + (issue.action ? ` ${issue.action}` : ""), { basis: "chain", owner, concepts, issueId: issue.id });
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
      happened: `${c.provider ? c.provider.label : "El proveedor"} muestra la operación ${PROVIDER_STATUS_TEXT[c.A.provider_status]}${c.A.tx_hash ? "" : " y no hay transacción en la red que verificar"}.`,
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
        reasons.push("La conclusión se apoya en la transacción verificada en la red.");
      } else if (ctx.delivery === "not_found") {
        level = "medium";
        reasons.push("El origen está verificado, pero la ausencia de entrada en destino no prueba por sí sola que no llegará.");
      } else {
        level = "medium";
        reasons.push("El origen está verificado; la entrega no se pudo confirmar.");
      }
    } else if (ctx.inboundState === "found" || ctx.inboundState === "found_other") {
      level = "medium";
      reasons.push("Hay una coincidencia por wallet, activo y monto, pero sin hash no se prueba el vínculo.");
    } else {
      level = "low";
      reasons.push("No hay evidencia verificada en la red: la evaluación se basa en lo declarado.");
    }
    if (E.errors && E.errors.length) {
      reasons.push("Algunas consultas fallaron; lo que no se pudo consultar se trata como «no determinado».");
      if (level === "high") level = "medium";
    }
    return { level, reasons };
  }

  function buildLimits(ctx) {
    const { A, E } = ctx;
    const limits = ["La evaluación usa datos públicos de la red y lo que declaraste. No puede ver los sistemas internos de exchanges ni de puentes, ni las razones de una revisión interna."];
    if (!A.tx_hash) limits.push("No se dispuso del hash: lo declarado no se pudo contrastar con la transacción.");
    if (ctx.delivery === "expected" || ctx.delivery === "other_network" || ctx.inboundState) limits.push("La coincidencia en destino se hace por wallet, activo y monto; indica la entrega, pero no es una prueba criptográfica de que ambas transacciones estén vinculadas.");
    if (ctx.timing.thresholdMinutes) limits.push("Los tiempos mencionados son referencias orientativas y no garantías de ningún proveedor.");
    if (E.skipped === "no_key") limits.push("No se configuró la API key de Alchemy, por lo que no se pudo consultar la red.");
    for (const err of E.errors || []) limits.push(`No se pudo completar «${err.step}»: ${err.message}`);
    return uniq(limits);
  }

  function buildFacts(ctx) {
    const { A, D, E } = ctx;
    const facts = [];
    const f = (basis, label, value) => value !== undefined && value !== null && value !== "" && facts.push({ basis, label, value: String(value) });
    if (A.flow) f("declared", "Operación", K.FLOWS[A.flow] ? K.FLOWS[A.flow].short : A.flow);
    if (A.provider) f("declared", "Proveedor", A.provider);
    if (A.asset) f("declared", "Activo", A.asset === "OTHER" ? A.asset_other || "Otro" : A.asset);
    if (A.amount) f("declared", "Monto", A.amount);
    if (A.src_network) f("declared", "Red de envío", A.src_network);
    if (A.dst_network) f("declared", "Red esperada", A.dst_network);
    if (A.dst_address) f("declared", "Dirección de destino", A.dst_address);
    if (A.provider_status) f("declared", "Estado en el proveedor", PROVIDER_STATUS_TEXT[A.provider_status]);
    if (D) {
      f("chain", "Red de la transacción", D.chain);
      f("chain", "Estado", ctx.txState === "success" ? "Exitosa" : ctx.txState === "failed" ? "Fallida" : "Pendiente");
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

  // ───────────── API pública ─────────────
  function evaluate(answers, evidence) {
    const A = answers || {};
    const E = evidence || { errors: [], nowSeconds: Math.floor(Date.now() / 1000) };
    E.errors = E.errors || [];
    E.nowSeconds = E.nowSeconds || Math.floor(Date.now() / 1000);

    const ctx = buildContext(A, E);
    const checks = buildChecks(ctx);
    const key = decide(ctx);
    const v = VERDICTS[key](ctx);
    const confidence = buildConfidence(ctx, key);

    const alerts = [];
    if (A.third_party === "yes") {
      alerts.push({ id: "possible_scam", severity: "warning", title: "Posible patrón de estafa", detail: "Indicaste que alguien te pidió hacer este envío. Antes de enviar más fondos, verifica la identidad de esa persona o servicio con un canal oficial; nadie legítimo te pide enviar cripto para «desbloquear», «validar» o «reclamar» fondos." });
    }
    if (ctx.D && ctx.has("address_poisoning")) {
      alerts.push({ id: "address_poisoning", severity: "critical", title: "Patrón de envenenamiento de direcciones", detail: "La dirección receptora imita el inicio y el final de la tuya. No envíes más fondos desde el historial; copia siempre desde la fuente." });
    }

    const issueSteps = (ctx.D ? ctx.D.issues : []).filter((i) => i.action && ["critical", "error", "warn"].includes(i.severity) && !["origin_failed", "origin_replaced", "origin_pending"].includes(i.id)).map((i) => i.action);
    const nextSteps = dedupe([...v.steps, ...(v.level === "ok" ? [] : issueSteps)]);
    const concepts = uniq([...v.concepts, ...checks.filter((c) => c.status !== "ok").flatMap((c) => c.concepts), ...(ctx.A.symptom === "not_visible" ? ["tokens_no_visibles"] : [])]).slice(0, 8);

    const explanation = [v.happened, v.why].filter(Boolean);
    return {
      verdict: { code: key, level: v.level, headline: v.headline },
      explanation,
      recoverability: v.recover,
      clientOperation: { rating: v.rating, summary: v.ratingText },
      checks,
      facts: buildFacts(ctx),
      alerts,
      nextSteps,
      concepts,
      confidence,
      limits: buildLimits(ctx),
      context: { txState: ctx.txState, delivery: ctx.delivery, timingStatus: ctx.timingStatus, deliveryChain: ctx.deliveryChain, protocol: ctx.protocol },
    };
  }

  Object.assign(K, { evaluate, EVALUATOR_VERDICTS: Object.keys(VERDICTS) });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
