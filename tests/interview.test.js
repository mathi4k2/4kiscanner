const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const GOOD = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const HASH = "0x" + "ab".repeat(32);
const answer = (a, id, raw) => { const r = K.applyAnswer(a, id, raw); assert.ok(r.result.ok, `${id}: ${r.result.error}`); return r.answers; };
const ids = (a) => K.applicableQuestions(a).map((q) => q.id);

test("flujo: la primera pregunta es el tipo de operación y no se puede omitir", () => {
  assert.equal(K.nextQuestion({}).id, "flow");
  assert.equal(K.validateAnswer("flow", K.SKIP, {}).ok, false);
  assert.equal(K.validateAnswer("flow", "no existe", {}).ok, false);
  assert.equal(K.validateAnswer("flow", "bridge", {}).value, "bridge");
});

test("preguntas condicionales según la operación", () => {
  assert.ok(!ids({ flow: "swap" }).includes("dst_network"));
  assert.ok(ids({ flow: "swap" }).includes("src_network"));
  assert.ok(!ids({ flow: "onramp" }).includes("src_network"));
  assert.ok(ids({ flow: "onramp" }).includes("dst_network"));
  assert.ok(!ids({ flow: "bridge" }).includes("addr_source"));
  assert.ok(ids({ flow: "exchange_deposit" }).includes("addr_source"));
  assert.ok(!ids({ flow: "wallet_transfer" }).includes("provider_status"));
  assert.ok(ids({ flow: "exchange_withdrawal" }).includes("provider_status"));
  // el memo solo aplica a depósitos en redes no EVM o desconocidas
  assert.ok(!ids({ flow: "exchange_deposit", dst_network: "Polygon" }).includes("memo"));
  assert.ok(ids({ flow: "exchange_deposit", dst_network: "Tron" }).includes("memo"));
  assert.ok(ids({ flow: "exchange_deposit", dst_network: "unknown" }).includes("memo"));
  // el token personalizado solo si eligió «Otro»
  assert.ok(ids({ flow: "bridge", asset: "OTHER" }).includes("asset_other"));
  assert.ok(!ids({ flow: "bridge", asset: "USDC" }).includes("asset_other"));
  // dónde mira el saldo solo si el síntoma es de «no veo»
  assert.ok(ids({ flow: "bridge", symptom: "not_arrived" }).includes("viewing_network"));
  assert.ok(!ids({ flow: "bridge", symptom: "pending_status" }).includes("viewing_network"));
  assert.ok(!ids({ flow: "exchange_deposit", symptom: "not_arrived" }).includes("viewing_network"));
});

test("las preguntas se formulan según el contexto", () => {
  const q = (id, a) => K.QUESTIONS.find((x) => x.id === id).prompt(a);
  assert.match(q("src_network", { flow: "exchange_withdrawal" }), /formulario de retiro/);
  assert.match(q("src_network", { flow: "bridge" }), /red de origen/);
  assert.match(q("dst_address", { flow: "exchange_deposit" }), /dirección de depósito/);
  assert.match(q("provider", { flow: "bridge" }), /puente/);
});

test("recorrido completo: solo se pide lo necesario y termina", () => {
  let a = {};
  const script = { flow: "exchange_withdrawal", provider: "Binance", symptom: "not_arrived", elapsed: "1_24h", asset: "USDT", amount: "100,5", src_network: "Ethereum", dst_network: "Polygon", dst_address: GOOD, addr_source: "provider_page", third_party: "no", provider_status: "completed_sent", viewing_network: "Polygon", tx_hash: HASH };
  let guard = 0;
  for (let q = K.nextQuestion(a); q; q = K.nextQuestion(a)) {
    assert.ok(script[q.id] !== undefined, `pregunta inesperada: ${q.id}`);
    a = answer(a, q.id, script[q.id]);
    assert.ok(++guard < 30);
  }
  assert.equal(a.amount, "100.5");
  assert.equal(a.dst_address, GOOD.toLowerCase());
  assert.equal(a.tx_hash, HASH);
  const p = K.progress(a);
  assert.equal(p.answered, p.total);
});

test("omitir: solo preguntas opcionales", () => {
  for (const id of ["provider", "amount", "dst_address", "tx_hash"]) assert.deepEqual(K.validateAnswer(id, K.SKIP, {}), { ok: true, value: null });
  for (const id of ["flow", "symptom", "elapsed", "asset", "src_network", "dst_network", "third_party"]) assert.equal(K.validateAnswer(id, K.SKIP, { flow: "bridge" }).ok, false);
  // una pregunta omitida cuenta como respondida (no se vuelve a preguntar)
  const a = answer({ flow: "bridge" }, "provider", K.SKIP);
  assert.equal(a.provider, null);
  assert.notEqual(K.nextQuestion(a).id, "provider");
});

test("montos: formatos regionales y valores inválidos", () => {
  const p = K.parseAmount;
  assert.equal(p("250"), "250");
  assert.equal(p("0,5"), "0.5");
  assert.equal(p("1.234,56"), "1234.56");
  assert.equal(p("1,234.56"), "1234.56");
  assert.equal(p("1,234,567"), "1234567");
  assert.equal(p("1.234.567"), "1234567");
  assert.equal(p("$ 99"), "99");
  assert.equal(p("0"), null);
  assert.equal(p("-5"), null);
  assert.equal(p("abc"), null);
  assert.equal(p(""), null);
  assert.equal(K.validateAnswer("amount", "mucho", {}).ok, false);
});

test("direcciones: se aceptan con aviso explicativo; no se pierde lo que escribió", () => {
  const ok = K.validateAnswer("dst_address", GOOD, {});
  assert.equal(ok.value, GOOD.toLowerCase());
  assert.equal(ok.note, undefined);
  const bad = K.validateAnswer("dst_address", "0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed", {});
  assert.equal(bad.ok, true);
  assert.equal(bad.extra.dst_address_kind, "evm_bad_checksum");
  assert.match(bad.note.title, /checksum/);
  const tron = K.validateAnswer("dst_address", "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm", {});
  assert.equal(tron.extra.dst_address_kind, "tron");
  assert.equal(tron.value, "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm");
  assert.equal(K.validateAnswer("dst_address", "ab".repeat(20), {}).value, "0x" + "ab".repeat(20));
});

test("hash: se normaliza; los enlaces aportan la red; lo inválido se rechaza con explicación", () => {
  const url = K.validateAnswer("tx_hash", `https://basescan.org/tx/${HASH}`, {});
  assert.equal(url.value, HASH);
  assert.equal(url.extra.tx_chain_hint, "Base");
  const noPrefix = K.validateAnswer("tx_hash", "ab".repeat(32), {});
  assert.equal(noPrefix.value, HASH);
  assert.equal(noPrefix.note.severity, "warn");
  const addr = K.validateAnswer("tx_hash", GOOD, {});
  assert.equal(addr.ok, false);
  assert.match(addr.error, /dirección de wallet/);
  assert.equal(K.validateAnswer("tx_hash", "hola", {}).ok, false);
});

test("cambiar una respuesta poda las que dejan de aplicar", () => {
  let a = { flow: "exchange_deposit", src_network: "Polygon", dst_network: "Tron", memo: "required_missing", addr_source: "typed", provider_status: "no_info" };
  a = answer(a, "dst_network", "Polygon"); // memo ya no aplica
  assert.equal(a.memo, undefined);
  a = answer(a, "flow", "swap");           // cascada
  assert.equal(a.dst_network, undefined);
  assert.equal(a.addr_source, undefined);
  assert.equal(a.provider_status, undefined);
  assert.equal(a.src_network, "Polygon");
  // el hash y su pista de red se podan juntos
  const b = K.pruneAnswers({ flow: "swap", tx_hash: HASH, tx_chain_hint: "Base" });
  assert.equal(b.tx_hash, HASH);
});

test("describeAnswers muestra etiquetas legibles", () => {
  const rows = K.describeAnswers({ flow: "bridge", provider: null, symptom: "not_arrived", elapsed: "lt1h", src_network: "Polygon" });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.answer]));
  assert.match(byId.flow, /puente/);
  assert.equal(byId.provider, "No indicado");
  assert.equal(byId.symptom, "Los fondos no llegaron");
  assert.equal(byId.src_network, "Polygon");
});

test("redes y direcciones: coherencia de formato", () => {
  assert.equal(K.networkKind("Polygon"), "supported");
  assert.equal(K.networkKind("BNB Chain"), "unsupported_evm");
  assert.equal(K.networkKind("Tron"), "non_evm");
  assert.equal(K.networkKind("unknown"), "unknown");
  assert.equal(K.addressMatchesNetwork("evm", "Polygon"), true);
  assert.equal(K.addressMatchesNetwork("evm", "BNB Chain"), true);
  assert.equal(K.addressMatchesNetwork("evm", "Tron"), false);
  assert.equal(K.addressMatchesNetwork("tron", "Polygon"), false);
  assert.equal(K.addressMatchesNetwork("tron", "Tron"), true);
  assert.equal(K.addressMatchesNetwork("tron", "Solana"), false);
  assert.equal(K.addressMatchesNetwork("evm", "unknown"), null);
  assert.equal(K.addressMatchesNetwork("xrp", "Otra red no EVM"), null);
});

test("proveedores: reconocimiento y precedencia del nombre más específico", () => {
  assert.equal(K.findProvider("Across").kind, "bridge");
  assert.equal(K.findProvider("uso binance").kind, "exchange");
  assert.equal(K.findProvider("Coinbase Wallet").kind, "wallet");
  assert.equal(K.findProvider("Coinbase").kind, "exchange");
  assert.equal(K.findProvider("Jumper exchange").protocol, "LI.FI");
  assert.equal(K.findProvider("superbridge").protocol, "Optimism Native Bridge");
  assert.equal(K.findProvider("algo raro"), null);
  assert.equal(K.findProvider(""), null);
});

test("perfiles de tiempo", () => {
  const t = (c) => K.timingProfile(c);
  assert.equal(t({ flow: "bridge", protocol: "Across", src: "Polygon", dst: "Base" }).id, "bridge_fast");
  assert.equal(t({ flow: "bridge", protocol: "Connext", src: "Polygon", dst: "Base" }).id, "bridge_standard");
  assert.equal(t({ flow: "bridge", protocol: "Optimism Native Bridge", src: "Optimism", dst: "Ethereum" }).thresholdMinutes, 8 * 24 * 60);
  assert.equal(t({ flow: "bridge", protocol: "Base Native Bridge", src: "Ethereum", dst: "Base" }).id, "native_l1_to_l2");
  assert.equal(t({ flow: "bridge", protocol: "Polygon Native Bridge", src: "Polygon", dst: "Ethereum" }).id, "polygon_withdraw");
  assert.equal(t({ flow: "swap" }).id, "swap");
  assert.equal(t({ flow: "exchange_withdrawal" }).thresholdMinutes, 24 * 60);
  assert.equal(t({ flow: "onramp" }).thresholdMinutes, null);
  assert.equal(t({ flow: "other" }).id, "unknown");
});

test("glosario: todos los conceptos referenciados existen", () => {
  for (const q of K.QUESTIONS) for (const c of q.concepts || []) assert.ok(K.CONCEPTS[c], `${q.id} → ${c}`);
  for (const c of Object.values(K.CONCEPTS)) { assert.ok(c.term && c.short && c.long); assert.ok(c.long.length > c.short.length); }
  assert.deepEqual(K.conceptsFor(["red", "red", "nope", "hash"]).map((c) => c.id), ["red", "hash"]);
});
