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
    const locale = options.locale || (typeof K.getLocale === "function" ? K.getLocale() : "es");
    const copy = locale === "en" ? {
      title: "CRYPTO TRANSACTION EVALUATION · 4kiscan", verdict: "VERDICT", confidence: "Confidence",
      happened: "WHAT HAPPENED", operation: "CLIENT OPERATION", recover: "CAN THE FUNDS BE RECOVERED?",
      alerts: "ALERTS", checks: "CHECKS", data: "TRANSACTION DATA", steps: "NEXT STEPS", limits: "LIMITS OF THIS EVALUATION",
      links: "LINKS", disclaimer: "This report uses public network data and information declared by the client. It is not legal or financial advice.",
    } : locale === "pt" ? {
      title: "AVALIAÇÃO DE OPERAÇÃO CRIPTO · 4kiscan", verdict: "VEREDITO", confidence: "Confiança",
      happened: "O QUE ACONTECEU", operation: "OPERAÇÃO DO CLIENTE", recover: "OS FUNDOS PODEM SER RECUPERADOS?",
      alerts: "ALERTAS", checks: "VERIFICAÇÕES", data: "DADOS DA OPERAÇÃO", steps: "PRÓXIMOS PASSOS", limits: "LIMITES DESTA AVALIAÇÃO",
      links: "LINKS", disclaimer: "Este relatório usa dados públicos da rede e informações declaradas pelo cliente. Não constitui aconselhamento jurídico ou financeiro.",
    } : null;
    const when = (options.now || new Date()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    const lines = [];
    const push = (...l) => lines.push(...l);
    const c = copy || {
      title: "EVALUACIÓN DE OPERACIÓN CRIPTO · 4kiscan", verdict: "VEREDICTO", confidence: "Confianza",
      happened: "QUÉ PASÓ", operation: "LA OPERACIÓN DEL CLIENTE", recover: "¿SE PUEDEN RECUPERAR LOS FONDOS?",
      alerts: "ALERTAS", checks: "COMPROBACIONES", data: "DATOS DE LA OPERACIÓN", steps: "PRÓXIMOS PASOS", limits: "LÍMITES DE ESTA EVALUACIÓN",
      links: "ENLACES", disclaimer: "Este informe usa datos públicos de la red y lo declarado por el cliente. No es asesoría legal ni financiera.",
    };
    const generated = locale === "en" ? "Generated" : locale === "pt" ? "Gerado" : "Generado";
    push(c.title, `${generated}: ${when}`, "");
    push(c.verdict, `${levelLabel(result.verdict.level)}: ${result.verdict.headline}`);
    push(`${c.confidence}: ${CONFIDENCE_LABEL[result.confidence.level] || result.confidence.level}`);
    for (const reason of result.confidence.reasons) push(`  - ${reason}`);
    push("");

    push(c.happened);
    for (const p of result.explanation) push(p);
    push("");

    push(c.operation, `${ratingLabel(result.clientOperation.rating)}. ${result.clientOperation.summary || ""}`.trim(), "");
    push(c.recover, `${recoverLabel(result.recoverability.level)}. ${result.recoverability.text}`, "");

    if (result.alerts.length) {
      push(c.alerts);
      for (const a of result.alerts) push(`- ${a.title}: ${a.detail}`);
      push("");
    }

    push(c.checks);
    for (const c of result.checks) {
      const owner = OWNER_LABEL[c.owner] && ["problem", "warning"].includes(c.status) ? `; ${OWNER_LABEL[c.owner]}` : "";
      push(`- [${STATUS_LABEL[c.status] || c.status}] ${c.title} (${BASIS_LABEL[c.basis] || c.basis}${owner})`, `    ${c.detail}`);
    }
    push("");

    push(c.data);
    for (const f of result.facts) push(`- ${f.label}: ${f.value} (${BASIS_LABEL[f.basis] || f.basis})`);
    push("");

    push(c.steps);
    result.nextSteps.forEach((s, i) => push(`${i + 1}. ${s}`));
    push("");

    push(c.limits);
    for (const l of result.limits) push(`- ${l}`);
    if (options.links && options.links.length) {
      push("", c.links);
      for (const link of options.links) push(`- ${link.label}: ${link.url}`);
    }
    push("", c.disclaimer);
    return lines.join("\n");
  }

  Object.assign(K, { LEVEL_LABEL, STATUS_LABEL, BASIS_LABEL, OWNER_LABEL, RATING_LABEL, RECOVER_LABEL, levelLabel, ratingLabel, recoverLabel, buildReport });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
