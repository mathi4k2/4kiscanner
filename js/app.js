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
    flashId: null,
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
  const STEP_LABELS = {
    es: STEP_LABEL,
    en: {
      detect: "Looking for the transaction across the five networks",
      transaction: "Reading the transaction and receipt",
      diagnose: "Analyzing what the transaction did",
      radar: "Looking for funds arriving in the destination wallet",
      lifi: "Checking the bridge status",
      inbound: "Looking for recent incoming transfers in your wallet",
    },
    pt: {
      detect: "Procurando a transação nas cinco redes",
      transaction: "Lendo a transação e o recibo",
      diagnose: "Analisando o que a transação fez",
      radar: "Procurando a chegada dos fundos na carteira de destino",
      lifi: "Consultando o estado da ponte",
      inbound: "Procurando entradas recentes na sua carteira",
    },
  };
  const BASIS_TEXT = { chain: "verified", declared: "declared", inferred: "inferred" };
  const OWNER_TEXT = { client: "ownerClient", provider: "ownerProvider" };
  const basisText = (basis) => BASIS_TEXT[basis] ? K.t(BASIS_TEXT[basis]) : basis;
  const ownerText = (owner) => OWNER_TEXT[owner] ? K.t(OWNER_TEXT[owner]) : "";
  const isMobile = () => window.matchMedia("(max-width: 39.99em)").matches;
  const isHexLong = (v) => /^0x[0-9a-f]{20,}$/i.test(String(v).trim());

  function announce(message) {
    const live = $("#live");
    if (live) { live.textContent = ""; setTimeout(() => { live.textContent = message; }, 30); }
  }

  function conceptBlock(ids, summary) {
    const concepts = K.conceptsFor(ids);
    if (!concepts.length) return "";
    return `<details class="learn"><summary>${esc(summary || K.t("conceptsQuestion"))}</summary>${concepts
      .map((c) => `<div class="term"><p><span class="term__name">${esc(c.term)}.</span> <span class="term__short">${esc(c.short)}</span></p><details><summary>${esc(K.t("more"))}</summary><p>${esc(c.long)}</p></details></div>`)
      .join("")}</details>`;
  }

  function explorerLinks() {
    const links = [];
    const E = state.evidence;
    if (!E) return links;
    const hash = state.answers.tx_hash;
    if (E.txChain && K.CHAINS[E.txChain] && hash) links.push({ label: `${K.t("linkOrigin")} ${E.txChain}`, url: `${K.CHAINS[E.txChain].explorer}/tx/${hash}` });
    const transfer = E.radar && E.radar.state === "found" && E.radar.transfer;
    if (transfer && transfer.hash && E.radar.matchedChain && K.CHAINS[E.radar.matchedChain]) {
      links.push({ label: `${K.t("linkDestination")} (${E.radar.matchedChain})`, url: `${K.CHAINS[E.radar.matchedChain].explorer}/tx/${transfer.hash}` });
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
        const none = row.answer === K.t("noAnswer");
        return `<li class="transcript__item"><div class="transcript__q">${esc(row.question)}</div><div class="transcript__a${none ? " transcript__a--none" : ""}">${esc(row.answer)}</div>${noteHtml}<button type="button" class="transcript__edit" data-edit="${esc(row.id)}" aria-label="${esc(K.t("editAnswer"))}: ${esc(row.question)}">${esc(K.t("change"))}</button></li>`;
      })
      .join("");
    aside.innerHTML = `<details ${wide ? "open" : ""}><summary class="transcript__title">${esc(K.t("transcriptTitle"))} (${rows.length})</summary><ol class="transcript__list">${items}</ol><div class="actions"><button type="button" class="btn btn--quiet" data-action="restart">${esc(K.t("restart"))}</button></div></details>`;
  }

  // ───────────── Etapas ─────────────
  function renderIntro() {
    const keyNote = state.apiKey
      ? ""
      : `<p class="note">${esc(K.t("introKeyNote"))}</p>`;
    return `<div class="intro">
      <h1 class="lead" tabindex="-1" data-focus>${esc(K.t("introTitle"))}</h1>
      <p class="prose">${esc(K.t("introText"))}</p>
      <ul class="intro__list">
        <li><strong>${esc(K.t("introPoint1Title"))}</strong> ${esc(K.t("introPoint1Text"))}</li>
        <li><strong>${esc(K.t("introPoint2Title"))}</strong> ${esc(K.t("introPoint2Text"))}</li>
        <li><strong>${esc(K.t("introPoint3Title"))}</strong> ${esc(K.t("introPoint3Text"))}</li>
      </ul>
      <div class="actions"><button type="button" class="btn" data-action="start">${esc(K.t("start"))}</button></div>
      ${keyNote}
    </div>`;
  }

  function inputFor(q) {
    const prev = state.draft && state.draft.id === q.id && state.draft.value != null ? String(state.draft.value) : "";
    const mono = q.type === "address" || q.type === "hash" ? " mono" : "";
    const inputMode = q.type === "number" ? ' inputmode="decimal"' : "";
    return `<form class="qform" data-form="${esc(q.id)}" novalidate>
      <label class="field" for="answer-input"><span class="field__label">${K.t("answer")}</span>
        <input id="answer-input" type="text" class="${mono.trim()}" value="${esc(prev)}" placeholder="${esc(q.placeholder || "")}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="${q.optional ? "next" : "done"}"${inputMode} aria-describedby="answer-error"></label>
      <p class="error" id="answer-error" role="alert"></p>
      <div class="actions"><button type="submit" class="btn">${K.t("continue")}</button>${q.optional ? `<button type="button" class="btn btn--quiet" data-skip>${K.t("unknownAnswer")}</button>` : ""}</div>
    </form>`;
  }

  function flashHtml() {
    const f = state.flash;
    if (!f) return "";
    const tone = f.severity === "error" ? " alert--critical" : f.severity === "info" ? " alert--info" : "";
    return `<div class="alert flash${tone}" role="note"><strong>${esc(K.t("flashPrefix"))} ${esc(f.title)}</strong>${esc(f.detail || "")}</div>`;
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
      ${answered > 0 ? `<p class="question__nav"><button type="button" class="backlink" data-action="prev">${K.t("back")}</button></p>` : ""}
      <div class="progress"><span>${K.t("question")} ${answered + 1} ${K.t("of")} ${total}</span><div class="progress__bar" role="progressbar" aria-label="${K.t("progress")}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${answered}"><div class="progress__fill" data-fill="${total ? Math.round((answered / total) * 100) : 0}"></div></div></div>
      <h1 class="question__prompt" id="q-prompt" tabindex="-1" data-focus>${esc(q.prompt(state.answers))}</h1>
      <p class="question__help">${esc(q.help(state.answers))}</p>
      ${options}
      ${q.type === "choice" ? '<p class="error" id="answer-error" role="alert"></p>' : ""}
      ${conceptBlock(q.concepts, K.t("conceptsQuestion"))}
    </div>`;
  }

  function renderReview() {
    return `<div class="intro">
      ${flashHtml()}
      <h1 class="lead" tabindex="-1" data-focus>${K.t("ready")}</h1>
      <p class="prose">${esc(K.t("readyText"))} ${state.apiKey ? esc(K.t("readyWithKey")) : esc(K.t("readyNoKey"))}</p>
      <div class="actions"><button type="button" class="btn" data-action="evaluate">${esc(K.t("evaluate"))}</button><button type="button" class="btn btn--quiet" data-action="prev">${esc(K.t("lastQuestion"))}</button>${state.apiKey ? "" : `<button type="button" class="btn btn--quiet" data-action="settings">${esc(K.t("addKey"))}</button>`}</div>
    </div>`;
  }

  function renderChecking() {
    const items = state.steps
      .map((name, i) => {
        const active = i === state.steps.length - 1;
        return `<li data-state="${active ? "active" : "done"}"><span class="steps__mark" aria-hidden="true">${active ? "…" : "✓"}</span><span>${esc(STEP_LABELS[K.getLocale()][name] || name)}</span></li>`;
      })
      .join("");
    return `<div class="intro">
      <h1 class="lead" tabindex="-1" data-focus>${esc(K.t("checkingTitle"))}</h1>
      <p class="prose">${esc(K.t("checkingText"))}</p>
      <ul class="steps" id="steps">${items}</ul>
      <div class="actions"><button type="button" class="btn btn--quiet" data-action="cancel">${esc(K.t("cancel"))}</button></div>
    </div>`;
  }

  function renderError() {
    const message = state.error ? `${K.t("buildVerdictError")} ${state.error}` : K.t("unexpectedError");
    return `<div class="intro"><h1 class="lead" tabindex="-1" data-focus>${esc(K.t("errorTitle"))}</h1><p class="prose">${esc(message)}</p><div class="actions"><button type="button" class="btn" data-action="evaluate">${esc(K.t("retry"))}</button><button type="button" class="btn btn--quiet" data-action="back">${esc(K.t("backQuestions"))}</button></div></div>`;
  }

  function checkHtml(c) {
    const status = K.statusLabel(c.status);
    const owner = OWNER_TEXT[c.owner] && ["problem", "warning"].includes(c.status) ? `<span>${esc(ownerText(c.owner))}</span>` : "";
    const chips = (c.concepts || [])
      .filter((id) => K.CONCEPTS[id])
      .slice(0, 3)
      .map((id) => `<a href="#c-${esc(id)}" data-concept="${esc(id)}">${esc(K.CONCEPTS[id].term)}</a>`)
      .join("");
    return `<li class="ledger__item" data-basis="${esc(c.basis)}"><div class="ledger__head"><span class="status" data-status="${esc(c.status)}">${esc(status)}</span><span class="ledger__title">${esc(c.title)}</span></div><p class="ledger__detail">${esc(c.detail)}</p><div class="ledger__meta"><span>${esc(basisText(c.basis))}</span>${owner}${chips ? `<span class="chips">${esc(K.t("concepts"))}: ${chips}</span>` : ""}</div></li>`;
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
    const checks = `<p class="section__sub">${esc(K.t("checksSub"))}</p>
        <ul class="legend" aria-label="${esc(K.t("readLines"))}"><li><span class="rule-sample"></span>${esc(K.t("verified"))}</li><li><span class="rule-sample rule-sample--declared"></span>${esc(K.t("declared"))}</li><li><span class="rule-sample rule-sample--inferred"></span>${esc(K.t("inferred"))}</li></ul>
        <ul class="ledger">${r.checks.map(checkHtml).join("")}</ul>`;
    const facts = `<dl class="facts">${r.facts.map((f) => `<div class="facts__row" data-basis="${esc(f.basis)}"><dt>${esc(f.label)} · ${esc(basisText(f.basis).toLowerCase())}</dt><dd${isHexLong(f.value) ? ' class="mono"' : ""}>${esc(f.value)}</dd></div>`).join("")}</dl>
        ${links.length ? `<ul class="bullets bullets--after">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></li>`).join("")}</ul>` : ""}`;
    const trust = `<ul class="bullets">${r.confidence.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        <h3 class="section__title section__title--minor">${esc(K.t("limits"))}</h3>
        <ul class="bullets">${r.limits.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
    const conceptList = concepts.map((c) => `<details class="learn" id="c-${esc(c.id)}"><summary>${esc(c.term)}</summary><div class="term"><p>${esc(c.short)}</p><p class="term__long">${esc(c.long)}</p></div></details>`).join("");
    return `<article class="result">
      <header class="verdict" data-level="${esc(level)}">
        <div class="verdict__row"><span class="stamp">${esc(K.levelLabel(level))}</span><span class="verdict__confidence">${esc(K.t("confidence"))} ${esc(K.t(`confidence_${r.confidence.level}`))}</span></div>
        <h1 class="verdict__headline" tabindex="-1" data-focus>${esc(r.verdict.headline)}</h1>
      </header>

      ${noKey ? `<div class="alert section" role="note"><strong>${esc(K.t("noNetworkTitle"))}</strong>${esc(K.t("noNetworkText"))} <button type="button" class="btn btn--quiet" data-action="settings">${esc(K.t("addKey"))}</button></div>` : ""}

      <div class="result__layout">
        <div class="result__main">
          <section class="section" aria-labelledby="h-que-paso"><h2 class="section__title" id="h-que-paso">${esc(K.t("happened"))}</h2><div class="prose">${r.explanation.map((p) => `<p>${esc(p)}</p>`).join("")}</div></section>
          ${alerts ? `<section class="section" aria-label="${esc(K.t("alerts"))}">${alerts}</section>` : ""}
          <section class="section" aria-labelledby="h-pasos"><h2 class="section__title" id="h-pasos">${esc(K.t("nextSteps"))}</h2><ol class="steps-list">${r.nextSteps.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol></section>
          ${fold("h-checks", `${esc(K.t("checks"))} <span class="fold__count">(${r.checks.length})</span>`, checks, open)}
          ${fold("h-datos", esc(K.t("transactionData")), facts, open)}
          ${fold("h-conf", esc(K.t("trust")), trust, open)}
          ${concepts.length ? fold("h-conc", esc(K.t("resultConcepts")), conceptList, false) : ""}
        </div>

        <div class="result__aside">
          <div class="pair">
            <div class="panel"><p class="panel__label">${esc(K.t("clientOperation"))}</p><p class="panel__value">${esc(K.ratingLabel(r.clientOperation.rating))}</p><p class="panel__text">${esc(r.clientOperation.summary || "")}</p></div>
            <div class="panel"><p class="panel__label">${esc(K.t("recoverFunds"))}</p><p class="panel__value">${esc(K.recoverLabel(r.recoverability.level))}</p><p class="panel__text">${esc(r.recoverability.text)}</p></div>
          </div>
          <div class="result-actions">
            <button type="button" class="btn" data-action="copy">${esc(K.t("copyReport"))}</button>
            <button type="button" class="btn btn--quiet" data-action="back">${esc(K.t("reviewAnswers"))}</button>
            <span class="toast" id="toast" role="status"></span>
          </div>
          <div class="result__more">
            ${noKey && !state.apiKey ? "" : `<button type="button" class="btn btn--quiet" data-action="evaluate">${esc(K.t("evaluateAgain"))}</button>`}
            <button type="button" class="btn btn--quiet" data-action="restart">${esc(K.t("restart"))}</button>
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
    $("#link-label").textContent = state.apiKey ? K.t("networkConnected") : K.t("noKey");
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
    state.flashId = state.flash ? id : null;
    for (const key of Object.keys(state.notes)) if (state.answers[key] === undefined) delete state.notes[key];
    state.draft = null;
    state.result = null;
    saveSession();
    render(true);
  }

  function editAnswer(id) {
    state.flash = null;
    state.flashId = null;
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
    state.flashId = null;
    state.result = null;
    state.evidence = null;
    state.stage = "intro";
    store.remove("sessionStorage", SESSION_STORE);
    render(true);
  }

  async function evaluateNow() {
    const runId = ++state.runId;
    state.flash = null;
    state.flashId = null;
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
                return `<li data-state="${active ? "active" : "done"}"><span class="steps__mark" aria-hidden="true">${active ? "…" : "✓"}</span><span>${esc(STEP_LABELS[K.getLocale()][s] || s)}</span></li>`;
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
      state.error = String((error && error.message) || error);
    }
    render(true);
    announce(state.result ? `${K.t("reportReady")} ${state.result.verdict.headline}` : K.t("reportFailed"));
  }

  async function copyReport() {
    const text = K.buildReport(state.answers, state.result, { links: explorerLinks(), locale: K.getLocale() });
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
    const message = ok ? K.t("toastCopied") : K.t("toastCopyFailed");
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
    if (!key) return setSettingsResult("error", K.t("pasteKey"));
    setSettingsResult("", K.t("testing"));
    try {
      const block = await K.createApi({ apiKey: key, retries: 0, timeoutMs: 8000 }).latestBlock("Ethereum");
      setSettingsResult("ok", K.t("keyConnection").replace("{block}", block.number));
    } catch (error) {
      setSettingsResult("error", error.message || K.t("noConnection"));
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
    announce(key ? K.t("keySaved") : K.t("keyRemoved"));
  }
  function clearKey() {
    store.remove("localStorage", KEY_STORE);
    store.remove("sessionStorage", KEY_STORE);
    state.apiKey = "";
    state.remembered = false;
    $("#api-key").value = "";
    $("#remember-key").checked = false;
    updateLinkStatus();
    setSettingsResult("ok", K.t("removeKeyConfirm"));
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
  function refreshLocalizedNotes() {
    for (const id of ["dst_address", "tx_hash"]) {
      if (state.answers[id] === undefined || state.answers[id] === null) {
        delete state.notes[id];
        continue;
      }
      const validation = K.validateAnswer(id, state.answers[id], state.answers);
      if (validation && validation.note) state.notes[id] = validation.note;
      else delete state.notes[id];
    }
    state.flash = state.flashId ? state.notes[state.flashId] || null : null;
  }

  function applyDocumentTranslations() {
    const locale = K.getLocale();
    document.documentElement.lang = locale;
    const select = $("#language-select");
    if (select) {
      select.value = locale;
      select.setAttribute("aria-label", K.t("language"));
    }
    $$("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (key === "settingsIntro") el.innerHTML = K.t(key);
      else el.textContent = K.t(key);
    });
    $$("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = K.t(el.dataset.i18nPlaceholder);
    });
    $$("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", K.t(el.dataset.i18nAriaLabel));
    });
    document.title = K.t("pageTitle");
    const description = $('meta[name="description"]');
    if (description) description.content = K.t("pageDescription");
  }

  function init() {
    applyDocumentTranslations();
    loadKey();
    loadSession();
    $("#stage").addEventListener("click", onStageClick);
    $("#stage").addEventListener("submit", onStageSubmit);
    $("#transcript").addEventListener("click", onTranscriptClick);
    $("#open-settings").addEventListener("click", openSettings);
    $("#key-test").addEventListener("click", testKey);
    $("#key-clear").addEventListener("click", clearKey);
    $("#settings-form").addEventListener("submit", saveKey);
    $("#language-select").addEventListener("change", (event) => {
      K.setLocale(event.target.value);
      refreshLocalizedNotes();
      if (state.stage === "result" && state.evidence) state.result = K.evaluate(state.answers, state.evidence);
      $("#settings-result").textContent = "";
      $("#settings-result").dataset.kind = "";
      applyDocumentTranslations();
      render(false);
      announce(K.t("localeChanged"));
    });
    document.addEventListener("keydown", onKeydown);
    // Al imprimir, los apartados plegados se abren para que el informe salga completo.
    window.addEventListener("beforeprint", () => $$("details.fold").forEach((d) => { d.open = true; }));
    render(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
