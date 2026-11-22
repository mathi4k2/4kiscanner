/* 4kiscan · app.js
 * Interfaz: entrevista paso a paso → verificación en la red → dictamen.
 * Toda la lógica de decisión vive en los módulos puros (interview, evidence,
 * evaluate, report); aquí solo se dibuja y se conectan los eventos.
 */
(function () {
  "use strict";
  const K = globalThis.Kiscan;
  const esc = K.escapeHtml;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const KEY_STORE = "kiscan.apiKey";
  const SESSION_STORE = "kiscan.session";

  // ───────────── Almacenamiento (siempre tolerante a fallos) ─────────────
  const store = {
    get(area, key) {
      try { return window[area].getItem(key); } catch (error) { return null; }
    },
    set(area, key, value) {
      try { window[area].setItem(key, value); return true; } catch (error) { return false; }
    },
    remove(area, key) {
      try { window[area].removeItem(key); } catch (error) { /* sin almacenamiento */ }
    },
  };

  const state = {
    stage: "intro", // intro | interview | checking | result | error
    answers: {},
    notes: {},
    draft: null, // {id, value} al editar una respuesta
    flash: null, // aviso sobre la última respuesta (formato, red, checksum…)
    steps: [],
    runId: 0,
    result: null,
    evidence: null,
    error: null,
    apiKey: "",
    remembered: false,
  };

  function loadKey() {
    const local = store.get("localStorage", KEY_STORE);
    const session = store.get("sessionStorage", KEY_STORE);
    state.apiKey = (local || session || "").trim();
    state.remembered = !!local;
  }
  function loadSession() {
    try {
      const saved = JSON.parse(store.get("sessionStorage", SESSION_STORE) || "null");
      if (saved && saved.answers && typeof saved.answers === "object" && Object.keys(saved.answers).length) {
        state.answers = K.pruneAnswers(saved.answers);
        state.notes = saved.notes && typeof saved.notes === "object" ? saved.notes : {};
        state.stage = "interview";
      }
    } catch (error) { /* sesión corrupta: se ignora */ }
  }
  function saveSession() {
    store.set("sessionStorage", SESSION_STORE, JSON.stringify({ answers: state.answers, notes: state.notes }));
  }

  // ───────────── Utilidades de vista ─────────────
  const LEVEL_TEXT = K.LEVEL_LABEL;
  const STEP_LABEL = {
    detect: "Buscando la transacción en las cinco redes",
    transaction: "Leyendo la transacción y su recibo",
    diagnose: "Analizando qué hizo la transacción",
    radar: "Buscando la llegada de los fondos a la wallet de destino",
    lifi: "Consultando el estado del puente",
    inbound: "Buscando entradas recientes en tu wallet",
  };
  const BASIS_TEXT = { chain: "Verificado en la red", declared: "Lo que declaraste", inferred: "Inferido" };
  const OWNER_TEXT = { client: "De tu lado", provider: "Del lado del proveedor" };
  const isMobile = () => window.matchMedia("(max-width: 39.99em)").matches;
  const isHexLong = (v) => /^0x[0-9a-f]{20,}$/i.test(String(v).trim());

  function announce(message) {
    const live = $("#live");
    if (live) { live.textContent = ""; setTimeout(() => { live.textContent = message; }, 30); }
  }

  function conceptBlock(ids, summary) {
    const concepts = K.conceptsFor(ids);
    if (!concepts.length) return "";
    return `<details class="learn"><summary>${esc(summary || "¿Qué significa esto?")}</summary>${concepts
      .map((c) => `<div class="term"><p><span class="term__name">${esc(c.term)}.</span> <span class="term__short">${esc(c.short)}</span></p><details><summary>Ver más</summary><p>${esc(c.long)}</p></details></div>`)
      .join("")}</details>`;
  }

  function explorerLinks() {
    const links = [];
    const E = state.evidence;
    if (!E) return links;
    const hash = state.answers.tx_hash;
    if (E.txChain && K.CHAINS[E.txChain] && hash) links.push({ label: `Transacción de origen en ${E.txChain}`, url: `${K.CHAINS[E.txChain].explorer}/tx/${hash}` });
    const transfer = E.radar && E.radar.state === "found" && E.radar.transfer;
    if (transfer && transfer.hash && E.radar.matchedChain && K.CHAINS[E.radar.matchedChain]) {
      links.push({ label: `Entrada en destino (${E.radar.matchedChain})`, url: `${K.CHAINS[E.radar.matchedChain].explorer}/tx/${transfer.hash}` });
    }
    return links;
  }

  // ───────────── Transcripción ─────────────
  function renderTranscript() {
    const aside = $("#transcript");
    const layout = $("#main");
    const rows = K.describeAnswers(state.answers);
    const show = state.stage !== "intro" && rows.length > 0;
    layout.dataset.hasTranscript = String(show);
    aside.hidden = !show;
    if (!show) { aside.innerHTML = ""; return; }
    const wide = window.matchMedia("(min-width: 56.01rem)").matches;
    const items = rows
      .map((row) => {
        const note = state.notes[row.id];
        const noteHtml = note ? `<div class="transcript__note${note.severity === "error" ? " transcript__note--error" : ""}"><strong>${esc(note.title)}</strong>${esc(note.detail || "")}</div>` : "";
        const none = row.answer === "No indicado";
        return `<li class="transcript__item"><div class="transcript__q">${esc(row.question)}</div><div class="transcript__a${none ? " transcript__a--none" : ""}">${esc(row.answer)}</div>${noteHtml}<button type="button" class="transcript__edit" data-edit="${esc(row.id)}" aria-label="Cambiar la respuesta: ${esc(row.question)}">Cambiar</button></li>`;
      })
      .join("");
    aside.innerHTML = `<details ${wide ? "open" : ""}><summary class="transcript__title">Lo que llevamos (${rows.length})</summary><ol class="transcript__list">${items}</ol><div class="actions"><button type="button" class="btn btn--quiet" data-action="restart">Empezar de nuevo</button></div></details>`;
  }

  // ───────────── Etapas ─────────────
  function renderIntro() {
    const keyNote = state.apiKey
      ? ""
      : `<p class="note">Todavía no hay una clave de Alchemy. Puedes usar el evaluador igual: solo se basará en lo que cuentes. Si quieres que además compruebe la transacción en la red, agrégala en «Conexión con la red».</p>`;
    return `<div class="intro">
      <h1 class="lead" tabindex="-1" data-focus>¿Qué pasó con tus fondos?</h1>
      <p class="prose">Te haremos unas preguntas sobre la operación, el proveedor y las redes. Con tus respuestas, y con la transacción si tienes su hash, revisamos si la operación se hizo bien y por qué los fondos no llegaron o no están accesibles.</p>
      <ul class="intro__list">
        <li><strong>Separamos lo verificado de lo declarado.</strong> Lo que se comprueba en la red se marca distinto de lo que tú cuentas.</li>
        <li><strong>Explicamos los conceptos cuando hacen falta.</strong> Red, hash, memo, approve: sin dar nada por sabido.</li>
        <li><strong>Si algo no se puede saber, lo decimos.</strong> No adivinamos ni atribuimos culpas sin evidencia.</li>
      </ul>
      <div class="actions"><button type="button" class="btn" data-action="start">Empezar</button></div>
      ${keyNote}
    </div>`;
  }

  function inputFor(q) {
    const prev = state.draft && state.draft.id === q.id && state.draft.value != null ? String(state.draft.value) : "";
    const mono = q.type === "address" || q.type === "hash" ? " mono" : "";
    const inputMode = q.type === "number" ? ' inputmode="decimal"' : "";
    return `<form class="qform" data-form="${esc(q.id)}" novalidate>
      <label class="field" for="answer-input"><span class="field__label">Tu respuesta</span>
        <input id="answer-input" type="text" class="${mono.trim()}" value="${esc(prev)}" placeholder="${esc(q.placeholder || "")}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="${q.optional ? "next" : "done"}"${inputMode} aria-describedby="answer-error"></label>
      <p class="error" id="answer-error" role="alert"></p>
      <div class="actions"><button type="submit" class="btn">Continuar</button>${q.optional ? '<button type="button" class="btn btn--quiet" data-skip>No sé / prefiero omitir</button>' : ""}</div>
    </form>`;
  }

  function flashHtml() {
    const f = state.flash;
    if (!f) return "";
    const tone = f.severity === "error" ? " alert--critical" : f.severity === "info" ? " alert--info" : "";
    return `<div class="alert flash${tone}" role="note"><strong>Sobre tu respuesta anterior: ${esc(f.title)}</strong>${esc(f.detail || "")}</div>`;
  }

  function renderQuestion(q) {
    const { answered, total } = K.progress(state.answers);
    const options =
      q.type === "choice"
        ? `<div class="options" role="group" aria-labelledby="q-prompt">${q
            .options(state.answers)
            .map((o, i) => `<button type="button" class="option" data-choice="${esc(o.value)}" data-q="${esc(q.id)}"${i < 9 ? ` aria-keyshortcuts="${i + 1}"` : ""} aria-pressed="${state.draft && state.draft.id === q.id && state.draft.value === o.value}"><span class="option__label">${esc(o.label)}</span>${i < 9 ? `<kbd class="option__key" aria-hidden="true">${i + 1}</kbd>` : ""}</button>`)
            .join("")}</div>`
        : inputFor(q);
    return `<div class="question">
      ${flashHtml()}
      ${answered > 0 ? '<p class="question__nav"><button type="button" class="backlink" data-action="prev">Volver a la pregunta anterior</button></p>' : ""}
      <div class="progress"><span>Pregunta ${answered + 1} de ${total}</span><div class="progress__bar" role="progressbar" aria-label="Avance de la entrevista" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${answered}"><div class="progress__fill" data-fill="${total ? Math.round((answered / total) * 100) : 0}"></div></div></div>
      <h1 class="question__prompt" id="q-prompt" tabindex="-1" data-focus>${esc(q.prompt(state.answers))}</h1>
      <p class="question__help">${esc(q.help(state.answers))}</p>
      ${options}
      ${q.type === "choice" ? '<p class="error" id="answer-error" role="alert"></p>' : ""}
      ${conceptBlock(q.concepts, "Aclarar conceptos de esta pregunta")}
    </div>`;
  }

  function renderReview() {
    return `<div class="intro">
      ${flashHtml()}
      <h1 class="lead" tabindex="-1" data-focus>Listo para evaluar</h1>
      <p class="prose">Revisa lo que nos contaste en «Lo que llevamos»; puedes cambiar cualquier respuesta. ${
        state.apiKey ? "Al evaluar, comprobaremos la transacción y la llegada de los fondos directamente en la red." : "Sin clave de Alchemy la evaluación se basará solo en lo que declaraste."
      }</p>
      <div class="actions"><button type="button" class="btn" data-action="evaluate">Evaluar la operación</button><button type="button" class="btn btn--quiet" data-action="prev">Volver a la última pregunta</button>${state.apiKey ? "" : '<button type="button" class="btn btn--quiet" data-action="settings">Agregar clave de Alchemy</button>'}</div>
    </div>`;
  }

  function renderChecking() {
    const items = state.steps
      .map((name, i) => {
        const active = i === state.steps.length - 1;
        return `<li data-state="${active ? "active" : "done"}"><span class="steps__mark" aria-hidden="true">${active ? "…" : "✓"}</span><span>${esc(STEP_LABEL[name] || name)}</span></li>`;
      })
      .join("");
    return `<div class="intro">
      <h1 class="lead" tabindex="-1" data-focus>Revisando la operación</h1>
      <p class="prose">Consultamos la red y comparamos lo que encontramos con lo que nos contaste. Puede tardar unos segundos.</p>
      <ul class="steps" id="steps">${items}</ul>
      <div class="actions"><button type="button" class="btn btn--quiet" data-action="cancel">Cancelar y volver a las preguntas</button></div>
    </div>`;
  }

  function renderError() {
    return `<div class="intro"><h1 class="lead" tabindex="-1" data-focus>No pudimos completar la evaluación</h1><p class="prose">${esc(state.error || "Ocurrió un error inesperado.")}</p><div class="actions"><button type="button" class="btn" data-action="evaluate">Intentar de nuevo</button><button type="button" class="btn btn--quiet" data-action="back">Volver a las preguntas</button></div></div>`;
  }

  function checkHtml(c) {
    const status = K.STATUS_LABEL[c.status] || c.status;
    const owner = OWNER_TEXT[c.owner] && ["problem", "warning"].includes(c.status) ? `<span>${esc(OWNER_TEXT[c.owner])}</span>` : "";
    const chips = (c.concepts || [])
      .filter((id) => K.CONCEPTS[id])
      .slice(0, 3)
      .map((id) => `<a href="#c-${esc(id)}" data-concept="${esc(id)}">${esc(K.CONCEPTS[id].term)}</a>`)
      .join("");
    return `<li class="ledger__item" data-basis="${esc(c.basis)}"><div class="ledger__head"><span class="status" data-status="${esc(c.status)}">${esc(status)}</span><span class="ledger__title">${esc(c.title)}</span></div><p class="ledger__detail">${esc(c.detail)}</p><div class="ledger__meta"><span>${esc(BASIS_TEXT[c.basis] || c.basis)}</span>${owner}${chips ? `<span class="chips">Conceptos: ${chips}</span>` : ""}</div></li>`;
  }

  function fold(id, title, inner, open) {
    return `<section class="section fold-section" aria-labelledby="${id}"><details class="fold"${open ? " open" : ""}><summary class="fold__summary"><h2 class="section__title" id="${id}">${title}</h2></summary>${inner}</details></section>`;
  }

  function renderResult() {
    const r = state.result;
    const E = state.evidence || {};
    const level = LEVEL_TEXT[r.verdict.level] ? r.verdict.level : "unknown";
    const links = explorerLinks();
    const noKey = E.skipped === "no_key";
    const open = !isMobile(); // en móvil las secciones de detalle empiezan plegadas
    const alerts = r.alerts.map((a) => `<div class="alert${a.severity === "critical" ? " alert--critical" : ""}" role="note"><strong>${esc(a.title)}</strong>${esc(a.detail)}</div>`).join("");
    const concepts = K.conceptsFor(r.concepts);
    const checks = `<p class="section__sub">La línea a la izquierda de cada punto indica de dónde sale el dato.</p>
        <ul class="legend" aria-label="Cómo leer las líneas"><li><span class="rule-sample"></span>Verificado en la red</li><li><span class="rule-sample rule-sample--declared"></span>Lo que declaraste</li><li><span class="rule-sample rule-sample--inferred"></span>Inferido</li></ul>
        <ul class="ledger">${r.checks.map(checkHtml).join("")}</ul>`;
    const facts = `<dl class="facts">${r.facts.map((f) => `<div class="facts__row" data-basis="${esc(f.basis)}"><dt>${esc(f.label)} · ${esc((BASIS_TEXT[f.basis] || f.basis).toLowerCase())}</dt><dd${isHexLong(f.value) ? ' class="mono"' : ""}>${esc(f.value)}</dd></div>`).join("")}</dl>
        ${links.length ? `<ul class="bullets bullets--after">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></li>`).join("")}</ul>` : ""}`;
    const trust = `<ul class="bullets">${r.confidence.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        <h3 class="section__title section__title--minor">Límites</h3>
        <ul class="bullets">${r.limits.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
    const conceptList = concepts.map((c) => `<details class="learn" id="c-${esc(c.id)}"><summary>${esc(c.term)}</summary><div class="term"><p>${esc(c.short)}</p><p class="term__long">${esc(c.long)}</p></div></details>`).join("");
    return `<article class="result">
      <header class="verdict" data-level="${esc(level)}">
        <div class="verdict__row"><span class="stamp">${esc(K.levelLabel(level))}</span><span class="verdict__confidence">Confianza ${esc({ high: "alta", medium: "media", low: "baja" }[r.confidence.level] || r.confidence.level)}</span></div>
        <h1 class="verdict__headline" tabindex="-1" data-focus>${esc(r.verdict.headline)}</h1>
      </header>

      ${noKey ? `<div class="alert section" role="note"><strong>Esta evaluación no consultó la red</strong>Se basa solo en lo que declaraste. <button type="button" class="btn btn--quiet" data-action="settings">Agregar clave de Alchemy</button></div>` : ""}

      <div class="result__layout">
        <div class="result__main">
          <section class="section" aria-labelledby="h-que-paso"><h2 class="section__title" id="h-que-paso">Qué pasó</h2><div class="prose">${r.explanation.map((p) => `<p>${esc(p)}</p>`).join("")}</div></section>
          ${alerts ? `<section class="section" aria-label="Alertas">${alerts}</section>` : ""}
          <section class="section" aria-labelledby="h-pasos"><h2 class="section__title" id="h-pasos">Qué hacer ahora</h2><ol class="steps-list">${r.nextSteps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol></section>
          ${fold("h-checks", `Qué comprobamos <span class="fold__count">(${r.checks.length})</span>`, checks, open)}
          ${fold("h-datos", "Datos de la operación", facts, open)}
          ${fold("h-conf", "Cuánto confiar en esta evaluación", trust, open)}
          ${concepts.length ? fold("h-conc", "Conceptos para entender el resultado", conceptList, false) : ""}
        </div>

        <div class="result__aside">
          <div class="pair">
            <div class="panel"><p class="panel__label">La operación del cliente</p><p class="panel__value">${esc(K.ratingLabel(r.clientOperation.rating))}</p><p class="panel__text">${esc(r.clientOperation.summary || "")}</p></div>
            <div class="panel"><p class="panel__label">¿Se pueden recuperar los fondos?</p><p class="panel__value">${esc(K.recoverLabel(r.recoverability.level))}</p><p class="panel__text">${esc(r.recoverability.text)}</p></div>
          </div>
          <div class="result-actions">
            <button type="button" class="btn" data-action="copy">Copiar informe</button>
            <button type="button" class="btn btn--quiet" data-action="back">Revisar respuestas</button>
            <span class="toast" id="toast" role="status"></span>
          </div>
          <div class="result__more">
            ${noKey && !state.apiKey ? "" : '<button type="button" class="btn btn--quiet" data-action="evaluate">Evaluar de nuevo</button>'}
            <button type="button" class="btn btn--quiet" data-action="restart">Empezar de nuevo</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  // ───────────── Render principal ─────────────
  function render(focus) {
    const stage = $("#stage");
    let html;
    if (state.stage === "intro") html = renderIntro();
    else if (state.stage === "checking") html = renderChecking();
    else if (state.stage === "error") html = renderError();
    else if (state.stage === "result" && state.result) html = renderResult();
    else {
      const q = K.nextQuestion(state.answers);
      html = q ? renderQuestion(q) : renderReview();
    }
    document.body.dataset.stage = state.stage;
    $("#main").dataset.stage = state.stage === "interview" && !K.nextQuestion(state.answers) ? "review" : state.stage;
    stage.innerHTML = html;
    const fill = $("[data-fill]", stage);
    if (fill) fill.style.width = fill.dataset.fill + "%";
    renderTranscript();
    updateLinkStatus();
    if (focus) {
      const target = $("[data-focus]", stage);
      if (target) target.focus({ preventScroll: false });
      const input = $("#answer-input", stage);
      if (input) input.focus();
    }
  }

  function updateLinkStatus() {
    const button = $("#open-settings");
    button.dataset.state = state.apiKey ? "on" : "off";
    $("#link-label").textContent = state.apiKey ? "Red conectada" : "Sin clave de Alchemy";
  }

  // ───────────── Acciones ─────────────
  function submitAnswer(id, raw) {
    const { answers, result } = K.applyAnswer(state.answers, id, raw);
    if (!result.ok) {
      const error = $("#answer-error");
      const input = $("#answer-input");
      if (error) error.textContent = result.error;
      if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
      return;
    }
    state.answers = answers;
    if (result.note) state.notes[id] = result.note;
    else delete state.notes[id];
    state.flash = result.note && ["error", "warn"].includes(result.note.severity) ? result.note : null;
    for (const key of Object.keys(state.notes)) if (state.answers[key] === undefined) delete state.notes[key];
    state.draft = null;
    state.result = null;
    saveSession();
    render(true);
  }

  function editAnswer(id) {
    state.flash = null;
    state.draft = { id, value: state.answers[id] };
    delete state.answers[id];
    if (id === "tx_hash") delete state.answers.tx_chain_hint;
    if (id === "dst_address") delete state.answers.dst_address_kind;
    delete state.notes[id];
    state.stage = "interview";
    state.result = null;
    state.runId++;
    saveSession();
    render(true);
  }

  function goBack() {
    const rows = K.describeAnswers(state.answers);
    if (rows.length) editAnswer(rows[rows.length - 1].id);
  }

  function restart() {
    state.runId++;
    state.answers = {};
    state.notes = {};
    state.draft = null;
    state.flash = null;
    state.result = null;
    state.evidence = null;
    state.stage = "intro";
    store.remove("sessionStorage", SESSION_STORE);
    render(true);
  }

  async function evaluateNow() {
    const runId = ++state.runId;
    state.flash = null;
    state.stage = "checking";
    state.steps = [];
    state.result = null;
    render(true);
    const api = K.createApi({ apiKey: state.apiKey });
    let evidence;
    try {
      evidence = await K.gatherEvidence(api, state.answers, {
        onStep: (name) => {
          if (runId !== state.runId) return;
          state.steps.push(name);
          const list = $("#steps");
          if (list) {
            list.innerHTML = state.steps
              .map((s, i) => {
                const active = i === state.steps.length - 1;
                return `<li data-state="${active ? "active" : "done"}"><span class="steps__mark" aria-hidden="true">${active ? "…" : "✓"}</span><span>${esc(STEP_LABEL[s] || s)}</span></li>`;
              })
              .join("");
          }
        },
      });
    } catch (error) {
      evidence = { errors: [{ step: "general", code: "unexpected", message: String((error && error.message) || error) }], nowSeconds: Math.floor(Date.now() / 1000), noKey: !api.hasKey };
    }
    if (runId !== state.runId) return; // el usuario canceló o cambió algo
    try {
      state.evidence = evidence;
      state.result = K.evaluate(state.answers, evidence);
      state.stage = "result";
      state.error = null;
    } catch (error) {
      state.stage = "error";
      state.error = "Se produjo un error al armar el dictamen: " + String((error && error.message) || error);
    }
    render(true);
    announce(state.result ? `Dictamen listo: ${state.result.verdict.headline}` : "No se pudo completar la evaluación");
  }

  async function copyReport() {
    const text = K.buildReport(state.answers, state.result, { links: explorerLinks() });
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      area.remove();
    }
    const toast = $("#toast");
    const message = ok ? "Informe copiado" : "No se pudo copiar; selecciona el texto manualmente";
    if (toast) toast.textContent = message;
    announce(message);
  }

  // ───────────── Eventos del escenario ─────────────
  function onStageClick(event) {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.dataset.choice !== undefined) {
      submitAnswer(target.dataset.q, target.dataset.choice);
    } else if (target.hasAttribute("data-skip")) {
      const form = target.closest("form");
      submitAnswer(form.dataset.form, K.SKIP);
    } else if (target.dataset.concept) {
      event.preventDefault();
      const details = document.getElementById("c-" + target.dataset.concept);
      if (details) {
        for (let el = details; el; el = el.parentElement && el.parentElement.closest("details")) el.open = true;
        details.scrollIntoView({ block: "center" });
        $("summary", details).focus();
      }
    } else if (target.dataset.action) {
      const action = target.dataset.action;
      if (action === "start") { state.stage = "interview"; render(true); }
      else if (action === "evaluate") evaluateNow();
      else if (action === "cancel" || action === "back") { state.runId++; state.stage = "interview"; render(true); }
      else if (action === "restart") restart();
      else if (action === "prev") goBack();
      else if (action === "copy") copyReport();
      else if (action === "settings") openSettings();
    }
  }
  function onStageSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    submitAnswer(form.dataset.form, $("#answer-input", form).value);
  }
  function onTranscriptClick(event) {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.edit) editAnswer(target.dataset.edit);
    else if (target.dataset.action === "restart") restart();
  }

  // ───────────── Configuración de la clave ─────────────
  function openSettings() {
    const dialog = $("#settings");
    $("#api-key").value = state.apiKey;
    $("#remember-key").checked = state.remembered;
    const result = $("#settings-result");
    result.textContent = "";
    result.dataset.kind = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("#api-key").focus();
  }
  function setSettingsResult(kind, message) {
    const result = $("#settings-result");
    result.dataset.kind = kind;
    result.textContent = message;
  }
  async function testKey() {
    const key = $("#api-key").value.trim();
    if (!key) return setSettingsResult("error", "Pega primero una clave.");
    setSettingsResult("", "Probando…");
    try {
      const block = await K.createApi({ apiKey: key, retries: 0, timeoutMs: 8000 }).latestBlock("Ethereum");
      setSettingsResult("ok", `Conexión correcta (Ethereum, bloque ${block.number}).`);
    } catch (error) {
      setSettingsResult("error", error.message || "No se pudo conectar.");
    }
  }
  function saveKey(event) {
    const key = $("#api-key").value.trim();
    const remember = $("#remember-key").checked;
    store.remove("localStorage", KEY_STORE);
    store.remove("sessionStorage", KEY_STORE);
    if (key) store.set(remember ? "localStorage" : "sessionStorage", KEY_STORE, key);
    state.apiKey = key;
    state.remembered = !!key && remember;
    updateLinkStatus();
    if (state.stage === "interview" || state.stage === "intro") render(false);
    else if (state.stage === "result") render(false);
    announce(key ? "Clave guardada" : "Clave eliminada");
  }
  function clearKey() {
    store.remove("localStorage", KEY_STORE);
    store.remove("sessionStorage", KEY_STORE);
    state.apiKey = "";
    state.remembered = false;
    $("#api-key").value = "";
    $("#remember-key").checked = false;
    updateLinkStatus();
    setSettingsResult("ok", "Clave eliminada de este navegador.");
  }

  function onKeydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (state.stage !== "interview" || $("#settings").open) return;
    const tag = (event.target.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || event.target.isContentEditable) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const option = $$(".option", $("#stage"))[Number(event.key) - 1];
    if (option) { event.preventDefault(); option.click(); }
  }

  // ───────────── Arranque ─────────────
  function init() {
    loadKey();
    loadSession();
    $("#stage").addEventListener("click", onStageClick);
    $("#stage").addEventListener("submit", onStageSubmit);
    $("#transcript").addEventListener("click", onTranscriptClick);
    $("#open-settings").addEventListener("click", openSettings);
    $("#key-test").addEventListener("click", testKey);
    $("#key-clear").addEventListener("click", clearKey);
    $("#settings-form").addEventListener("submit", saveKey);
    document.addEventListener("keydown", onKeydown);
    // Al imprimir, los apartados plegados se abren para que el informe salga completo.
    window.addEventListener("beforeprint", () => $$("details.fold").forEach((d) => { d.open = true; }));
    render(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
