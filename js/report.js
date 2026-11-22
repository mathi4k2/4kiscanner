/* 4kiscan · report.js
 * Informe en texto plano (apto para pegar en un ticket o correo) a partir de las
 * respuestas del cliente y del resultado del evaluador. Sin DOM ni red.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

  const LEVEL_LABEL = { ok: "En orden", attention: "Requiere atención", problem: "Hay un problema", wait: "En espera", unknown: "No determinado" };
  const STATUS_LABEL = { ok: "Correcto", warning: "Atención", problem: "Problema", unknown: "Sin datos", info: "Nota" };
  const BASIS_LABEL = { chain: "verificado en la red", declared: "declarado por el cliente", inferred: "inferido" };
  const OWNER_LABEL = { client: "de parte del cliente", provider: "de parte del proveedor" };
  const RATING_LABEL = { correct: "La operación se hizo bien", partially: "Hay puntos a corregir", incorrect: "Hubo un error en la operación", undetermined: "Todavía no se puede determinar" };
  const RECOVER_LABEL = {
    accessible: "Probablemente accesibles",
    depends: "Depende",
    none_needed: "No hay nada que recuperar",
    unlikely: "Poco probable",
    none: "No recuperables",
    wait: "Esperar",
    unknown: "No determinado",
    ok: "En orden",
  };
  const CONFIDENCE_LABEL = { high: "alta", medium: "media", low: "baja" };

  const levelLabel = (l) => LEVEL_LABEL[l] || LEVEL_LABEL.unknown;
  const ratingLabel = (r) => RATING_LABEL[r] || RATING_LABEL.undetermined;
  const recoverLabel = (l) => RECOVER_LABEL[l] || RECOVER_LABEL.unknown;

  /** @param opts {now?: Date, links?: {label, url}[]} */
  function buildReport(answers, result, opts) {
    const options = opts || {};
    const when = (options.now || new Date()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    const lines = [];
    const push = (...l) => lines.push(...l);

    push("EVALUACIÓN DE OPERACIÓN CRIPTO · 4kiscan", `Generado: ${when}`, "");
    push("VEREDICTO", `${levelLabel(result.verdict.level)}: ${result.verdict.headline}`);
    push(`Confianza: ${CONFIDENCE_LABEL[result.confidence.level] || result.confidence.level}`);
    for (const reason of result.confidence.reasons) push(`  - ${reason}`);
    push("");

    push("QUÉ PASÓ");
    for (const p of result.explanation) push(p);
    push("");

    push("LA OPERACIÓN DEL CLIENTE", `${ratingLabel(result.clientOperation.rating)}. ${result.clientOperation.summary || ""}`.trim(), "");
    push("¿SE PUEDEN RECUPERAR LOS FONDOS?", `${recoverLabel(result.recoverability.level)}. ${result.recoverability.text}`, "");

    if (result.alerts.length) {
      push("ALERTAS");
      for (const a of result.alerts) push(`- ${a.title}: ${a.detail}`);
      push("");
    }

    push("COMPROBACIONES");
    for (const c of result.checks) {
      const owner = OWNER_LABEL[c.owner] && ["problem", "warning"].includes(c.status) ? `; ${OWNER_LABEL[c.owner]}` : "";
      push(`- [${STATUS_LABEL[c.status] || c.status}] ${c.title} (${BASIS_LABEL[c.basis] || c.basis}${owner})`, `    ${c.detail}`);
    }
    push("");

    push("DATOS DE LA OPERACIÓN");
    for (const f of result.facts) push(`- ${f.label}: ${f.value} (${BASIS_LABEL[f.basis] || f.basis})`);
    push("");

    push("PRÓXIMOS PASOS");
    result.nextSteps.forEach((s, i) => push(`${i + 1}. ${s}`));
    push("");

    push("LÍMITES DE ESTA EVALUACIÓN");
    for (const l of result.limits) push(`- ${l}`);
    if (options.links && options.links.length) {
      push("", "ENLACES");
      for (const link of options.links) push(`- ${link.label}: ${link.url}`);
    }
    push("", "Este informe usa datos públicos de la red y lo declarado por el cliente. No es asesoría legal ni financiera.");
    return lines.join("\n");
  }

  Object.assign(K, { LEVEL_LABEL, STATUS_LABEL, BASIS_LABEL, OWNER_LABEL, RATING_LABEL, RECOVER_LABEL, levelLabel, ratingLabel, recoverLabel, buildReport });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
