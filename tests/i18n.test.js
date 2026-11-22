const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const K = require("./load.js");
require("../js/i18n.js");

const ANSWERS = {
  flow: "bridge",
  asset: "OTHER",
  symptom: "not_arrived",
  dst_network: "Tron",
};

test("todos los idiomas tienen el mismo conjunto de claves de traducción", () => {
  const keys = Object.keys(K.LOCALES.en).sort();
  for (const locale of ["es", "en", "pt"]) {
    assert.deepEqual(Object.keys(K.LOCALES[locale]).sort(), keys, `${locale} has missing translation keys`);
    for (const key of keys) assert.ok(K.LOCALES[locale][key], `${locale}/${key} is empty`);
  }
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const markupKeys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)].map((match) => match[1]);
  for (const key of markupKeys) {
    for (const locale of ["es", "en", "pt"]) assert.ok(K.LOCALES[locale][key], `${locale}/${key} is missing for index.html`);
  }
});

test("cada idioma traduce todas las preguntas visibles", () => {
  const spanishPattern = /[¿¡]|\b(?:los fondos no llegaron|no lo sé|no indicado|menos de 1 hora|otra operación|en proceso|qué operación)\b/i;
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    for (const question of K.QUESTIONS) {
      const contents = [
        question.prompt(ANSWERS),
        question.help(ANSWERS),
        question.placeholder || "",
        ...(question.options ? question.options(ANSWERS).map((option) => option.label) : []),
      ];
      for (const content of contents) {
        assert.ok(!spanishPattern.test(content), `${locale}/${question.id} contains Spanish copy: ${content}`);
      }
    }
  }
});

test("el idioma seleccionado se conserva en memoria si el almacenamiento no está disponible", () => {
  K.setLocale("pt");
  assert.equal(K.getLocale(), "pt");
  assert.equal(K.nextQuestion({}).prompt({}), K.t("questionFlowPrompt"));
});

test("los informes usan etiquetas del idioma activo", () => {
  const answers = {
    flow: "exchange_withdrawal", provider: "Binance", symptom: "not_arrived",
    elapsed: "lt1h", asset: "USDC", amount: "100", src_network: "Ethereum",
    dst_network: "Polygon", dst_address: "0x" + "ab".repeat(20), third_party: "yes",
    provider_status: "completed_sent", viewing_network: "Polygon", tx_hash: null,
  };
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    const result = K.evaluate(answers, {
      errors: [], skipped: "no_key", nowSeconds: 1_800_000_000,
      addrClass: K.classifyAddress(answers.dst_address),
    });
    const report = K.buildReport(answers, result, {
      now: new Date("2026-11-21T12:00:00Z"),
      locale,
    });
    assert.ok(report.startsWith(locale === "en" ? "CRYPTO TRANSACTION EVALUATION" : "AVALIAÇÃO DE OPERAÇÃO CRIPTO"));
    assert.doesNotMatch(report, /¿|¡/);
    if (locale === "en") assert.doesNotMatch(report, /\b(?:QUÉ PASÓ|PRÓXIMOS PASOS|Confianza: baja|No es asesoría legal)\b/i);
    if (locale === "pt") assert.doesNotMatch(report, /\b(?:QUÉ PASÓ|PRÓXIMOS PASOS|Confianza: baixa|No es asesoría legal)\b/i);
  }
});

test("los mensajes, flujos y variantes usan el idioma activo en cada llamada", async () => {
  const cosmosAddress = K.classifyAddress(`cosmos1${"q".repeat(38)}`);
  const addressMessages = {};
  const issues = {};
  const deadAddress = K.DEAD_ADDRESS;
  const legacyUsdt = "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58";
  const labels = {};
  const panicMessages = {};
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    addressMessages[locale] = K.explainAddressInput(cosmosAddress).title;
    panicMessages[locale] = K.decodeRevertData(`0x4e487b71${"0".repeat(63)}1`).message;
    labels[locale] = {
      flow: K.FLOWS.bridge.label,
      provider: K.findProvider("Optimism bridge").label,
      variant: K.tokenIdentity("Optimism", legacyUsdt, "ETH").variant,
    };
    issues[locale] = await K.findIssues({}, {
      chain: "Polygon",
      destChain: "Polygon",
      wallet: "0x" + "ab".repeat(20),
      tx: { from: "0x" + "cd".repeat(20), to: deadAddress },
      to: deadAddress,
      from: "0x" + "cd".repeat(20),
      call: { kind: "native" },
      status: "0x1",
      logs: [],
      transfers: [],
      assets: [],
      bridgeMatches: [],
    });
  }
  assert.match(addressMessages.en, /Cosmos address/);
  assert.match(addressMessages.pt, /rede Cosmos/);
  assert.match(labels.en.flow, /moved funds/);
  assert.equal(labels.en.provider, "Official Optimism Bridge");
  assert.equal(labels.en.variant, "USDT (bridged, legacy)");
  assert.match(labels.pt.flow, /Transferi fundos/);
  assert.equal(labels.pt.provider, "Ponte oficial da Optimism");
  assert.equal(labels.pt.variant, "USDT (bridged, legado)");
  assert.equal(panicMessages.en, "assertion failed");
  assert.equal(panicMessages.pt, "assert falhou");
  for (const locale of ["en", "pt"]) {
    assert.equal(issues[locale][0].id, "burn_target");
    assert.doesNotMatch(issues[locale][0].detail, /El destino directo/);
    assert.doesNotMatch(issues[locale][0].action, /Contacta cuanto antes/);
  }
  assert.match(issues.en[0].detail, /direct destination/);
  assert.match(issues.pt[0].detail, /destino direto/);
});

test("evaluate re-localizes provider status and stored diagnostic issues on each call", () => {
  const evidence = {
    nowSeconds: 1_800_000_000,
    errors: [],
    diagnosis: {
      statusCode: "DESTINATION_CREDIT_FOUND",
      chain: "Polygon",
      txHash: "0x" + "11".repeat(32),
      from: "0x" + "cd".repeat(20),
      to: K.DEAD_ADDRESS,
      blockNumber: 123,
      originAssets: [],
      bridgeMatches: [],
      issues: [{
        id: "burn_target",
        severity: "critical",
        title: "La transacción se envió a una dirección de quema",
        detail: `El destino directo es ${K.DEAD_ADDRESS}. Los fondos enviados ahí quedan inaccesibles.`,
        action: "Contacta cuanto antes al soporte del servicio con el hash; normalmente no es recuperable.",
      }],
    },
  };
  const answers = { flow: "wallet_transfer", provider_status: "processing", tx_hash: "0x" + "11".repeat(32) };
  K.setLocale("en");
  const en = K.evaluate(answers, evidence);
  K.setLocale("pt");
  const pt = K.evaluate(answers, evidence);
  const enIssue = en.checks.find((check) => check.id === "chain_burn_target");
  const ptIssue = pt.checks.find((check) => check.id === "chain_burn_target");
  assert.match(en.facts.find((fact) => fact.label === "Provider status").value, /processing/);
  assert.match(pt.facts.find((fact) => fact.label === "Status no provedor").value, /andamento/);
  assert.match(enIssue.title, /burn address/);
  assert.match(enIssue.detail, /direct destination/);
  assert.match(enIssue.detail, /Contact the service/);
  assert.match(ptIssue.title, /endereço de queima/);
  assert.match(ptIssue.detail, /destino direto/);
  assert.match(ptIssue.detail, /Entre em contato/);
});

test("evaluate localizes the complete failed-transaction result", () => {
  const hash = "0x" + "22".repeat(32);
  const evidence = {
    nowSeconds: 1_800_000_000,
    errors: [],
    diagnosis: {
      statusCode: "ORIGIN_FAILED",
      chain: "Polygon",
      txHash: hash,
      from: "0x" + "cd".repeat(20),
      to: "0x" + "ab".repeat(20),
      blockNumber: 123,
      originTimestamp: 1_799_999_000,
      feePaid: "0.01 POL",
      originAssets: [],
      bridgeMatches: [],
      issues: [],
    },
  };
  const answers = { flow: "wallet_transfer", tx_hash: hash, symptom: "not_arrived" };
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    const result = K.evaluate(answers, evidence);
    const copy = [...result.explanation, ...result.nextSteps, ...result.checks.map((check) => check.detail)].join("\n");
    assert.doesNotMatch(copy, /La transacción|No llegaron|Confirma en tu wallet|La red la registró/);
    assert.match(result.explanation[0], locale === "en" ? /was recorded as failed/ : /foi registrada como falha/);
    assert.match(result.explanation[1], locale === "en" ? /gas already spent/ : /gas já gasto/);
  }
});

test("evaluate localizes provider and unverifiable-network verdicts and checks", () => {
  const hash = "0x" + "11".repeat(32);
  const cases = [
    {
      code: "PROVIDER_PROCESSING",
      answers: { flow: "exchange_withdrawal", provider: "Binance", provider_status: "processing" },
      evidence: {},
    },
    {
      code: "PROVIDER_REJECTED",
      answers: { flow: "exchange_withdrawal", provider: "Binance", provider_status: "rejected" },
      evidence: {},
    },
    {
      code: "NEED_HASH",
      answers: { flow: "exchange_withdrawal", provider: "Binance", provider_status: "completed_sent" },
      evidence: {},
    },
    {
      code: "NETWORK_NOT_VERIFIABLE",
      answers: { flow: "bridge", src_network: "Tron", dst_network: "Polygon" },
      evidence: {},
    },
    {
      code: "HASH_NOT_FOUND",
      answers: { flow: "wallet_transfer", tx_hash: hash, src_network: "Polygon", dst_network: "Polygon" },
      evidence: { detect: { state: "not_found" }, skipped: "no_key" },
    },
  ];
  const spanishPattern = /muestra la operación|indica que la operación fue enviada|La operación involucra|Si los fondos fueron|Copia de nuevo|Verifica con la plataforma|Binance muestra|No se dispone del hash/i;
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    assert.equal(
      K.timingProfile({ flow: "bridge", protocol: null, src: "Polygon", dst: "Base" }).label,
      locale === "en" ? "Cross-network bridge" : "Ponte entre redes",
    );
    for (const scenario of cases) {
      const result = K.evaluate(scenario.answers, {
        errors: [],
        nowSeconds: 1_800_000_000,
        ...scenario.evidence,
      });
      assert.equal(result.verdict.code, scenario.code);
      const text = [
        result.verdict.headline,
        ...result.explanation,
        result.recoverability.text,
        result.clientOperation.summary,
        ...result.nextSteps,
        ...result.checks.flatMap((check) => [check.title, check.detail]),
      ].join("\n");
      assert.doesNotMatch(text, spanishPattern, `${locale}/${scenario.code} contains Spanish copy`);
    }
  }
});

test("evaluate localizes dynamic on-chain verdict narratives", () => {
  const hash = "0x" + "11".repeat(32);
  const wallet = "0x" + "ab".repeat(20);
  const sender = "0x" + "cd".repeat(20);
  const diagnosis = (statusCode, issueId) => ({
    statusCode,
    chain: "Polygon",
    txHash: hash,
    from: sender,
    to: wallet,
    blockNumber: 123,
    originTimestamp: 1_799_999_700,
    originAssets: [],
    bridgeMatches: [],
    issues: issueId ? [{ id: issueId, severity: "critical", title: "", detail: "", action: "" }] : [],
  });
  const cases = [
    { code: "ORIGIN_REPLACED", answers: { flow: "wallet_transfer", tx_hash: hash }, evidence: { diagnosis: diagnosis("ORIGIN_PENDING", "origin_replaced") } },
    { code: "ORIGIN_PENDING", answers: { flow: "wallet_transfer", tx_hash: hash }, evidence: { diagnosis: diagnosis("ORIGIN_PENDING") } },
    { code: "BURN_ADDRESS", answers: { flow: "wallet_transfer", tx_hash: hash }, evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS", "burn_target") } },
    { code: "WRONG_RECIPIENT", answers: { flow: "wallet_transfer", tx_hash: hash, dst_address: wallet }, evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS", "recipient_mismatch") } },
    { code: "WRONG_NETWORK_ON_SOURCE", answers: { flow: "wallet_transfer", tx_hash: hash, dst_network: "Base" }, evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS", "wrong_network_delivery") } },
    { code: "SWAP_NOT_BRIDGE", answers: { flow: "bridge", tx_hash: hash, dst_network: "Base" }, evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS", "dex_not_bridge") } },
    {
      code: "DELIVERED_OTHER_NETWORK",
      answers: { flow: "bridge", tx_hash: hash, dst_network: "Optimism" },
      evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS"), radar: { state: "found", fallbackMatch: true, matchedChain: "Base", transfer: { hash } } },
      includeChecks: true,
    },
    {
      code: "IN_TRANSIT",
      answers: { flow: "bridge", tx_hash: hash, src_network: "Polygon", dst_network: "Base", elapsed: "lt1h" },
      evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS"), radar: { state: "no_match_global", searchedNetworks: ["Base"] } },
      includeChecks: true,
    },
    {
      code: "DELAYED_BEYOND_NORMAL",
      answers: { flow: "bridge", tx_hash: hash, src_network: "Polygon", dst_network: "Base", elapsed: "1_7d" },
      evidence: {
        diagnosis: { ...diagnosis("ORIGIN_SUCCESS"), originTimestamp: 1_799_913_600 },
        radar: { state: "no_match_global", searchedNetworks: ["Base"] },
      },
      includeChecks: true,
    },
    {
      code: "ARRIVAL_UNCONFIRMED",
      answers: { flow: "bridge", tx_hash: hash, src_network: "Polygon", dst_network: "Base" },
      evidence: {
        diagnosis: { ...diagnosis("ORIGIN_SUCCESS"), originTimestamp: undefined },
        radar: { state: "error", error: "Destination search failed." },
      },
    },
    {
      code: "MEMO_MISSING",
      answers: { flow: "exchange_deposit", tx_hash: hash, src_network: "Polygon", dst_network: "Polygon", memo: "required_missing" },
      evidence: { diagnosis: diagnosis("ORIGIN_SUCCESS") },
      includeChecks: true,
    },
    {
      code: "DEPOSIT_ARRIVED_PENDING_CREDIT",
      answers: { flow: "exchange_deposit", tx_hash: hash, dst_network: "Polygon", symptom: "not_visible" },
      evidence: { diagnosis: diagnosis("DESTINATION_CREDIT_FOUND") },
    },
    {
      code: "FOUND_BY_SEARCH",
      answers: { flow: "wallet_transfer", src_network: "Polygon", dst_network: "Polygon", dst_address: wallet },
      evidence: {
        inbound: { state: "found", matchedChain: "Polygon", transfer: { hash }, fallbackMatch: false },
        inboundMatchedByDeclared: true,
      },
      includeChecks: true,
    },
  ];
  const spanishPattern = /La transacción|La cuenta ya usó|La búsqueda no encontró|Por eso no los ves|en destino todavía|Esto es normal para|envió los fondos a una dirección distinta|Se buscó en|Esto no prueba|Lo habitual es|Han pasado/i;
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    for (const scenario of cases) {
      const result = K.evaluate(scenario.answers, {
        errors: [],
        nowSeconds: 1_800_000_000,
        ...scenario.evidence,
      });
      assert.equal(result.verdict.code, scenario.code);
      const text = [
        result.verdict.headline,
        ...result.explanation,
        result.recoverability.text,
        result.clientOperation.summary,
        ...result.nextSteps,
        ...result.limits,
        ...(scenario.includeChecks ? result.checks.flatMap((check) => [check.title, check.detail]) : []),
      ].join("\n");
      assert.doesNotMatch(text, spanishPattern, `${locale}/${scenario.code} contains Spanish copy`);
    }
  }
});

test("evaluate re-localizes dynamic diagnosis copy stored in Spanish evidence", async () => {
  const wallet = "0x" + "ab".repeat(20);
  const other = "0x" + "cd".repeat(20);
  const hash = "0x" + "33".repeat(32);
  const base = {
    chain: "Polygon",
    destChain: "Polygon",
    wallet,
    tx: { from: other, to: other, input: "0x" },
    to: other,
    from: other,
    call: { kind: "native" },
    status: "0x1",
    logs: [],
    transfers: [],
    assets: [],
    bridgeMatches: [],
  };
  K.setLocale("es");
  const poisoned = wallet.slice(0, 6) + "f".repeat(32) + wallet.slice(-4);
  const api = { getCode: async () => "0x" };
  const poisoningIssues = await K.findIssues(api, { ...base, tx: { ...base.tx, to: poisoned }, to: poisoned });
  const networkIssues = await K.findIssues(api, {
    ...base,
    destChain: "Base",
    tx: { ...base.tx, to: wallet },
    to: wallet,
  });
  const tokenIssues = await K.findIssues(api, {
    ...base,
    assets: [{ known: false, tokenAddress: other, symbol: other }],
  });
  const evidence = {
    nowSeconds: 1_800_000_000,
    errors: [],
    diagnosis: {
      statusCode: "DESTINATION_CREDIT_FOUND",
      chain: "Polygon",
      txHash: hash,
      from: other,
      to: wallet,
      blockNumber: 123,
      destinationChain: "Base",
      destinationWallet: wallet,
      originAssets: [],
      bridgeMatches: [],
      issues: [...poisoningIssues, ...networkIssues, ...tokenIssues],
    },
  };
  const answers = { flow: "wallet_transfer", src_network: "Polygon", dst_network: "Base", dst_address: wallet, tx_hash: hash };
  for (const locale of ["en", "pt"]) {
    K.setLocale(locale);
    const result = K.evaluate(answers, evidence);
    const issueCheck = (id) => result.checks.find((check) => check.issueId === id);
    assert.match(issueCheck("address_poisoning").detail, locale === "en" ? /Funds were sent to/ : /Os fundos foram enviados para/);
    assert.match(issueCheck("wrong_network_delivery").detail, locale === "en" ? /direct transfer on Polygon/ : /transferência direta na Polygon/);
    assert.match(issueCheck("unknown_token").detail, locale === "en" ? /not in 4kiscan’s list/ : /não está na lista/);
  }
});
