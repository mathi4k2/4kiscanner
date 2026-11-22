// Escenarios de punta a punta: respuestas del cliente + API simulada → gatherEvidence → evaluate.
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const NOW = 1_800_000_000;
const WALLET = "0x" + "ab".repeat(20);
const SENDER = "0x" + "cd".repeat(20);
const OTHER = "0x" + "ee".repeat(20);
const HASH = "0x" + "11".repeat(32);
const USDC_POLY = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SPOKE_POLY = "0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096";
const UNI_BASE = "0x2626664c2603336e57b271c5c0b26f421741e481";
const w = (h) => h.replace(/^0x/, "").padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);

function api(o = {}) {
  return {
    hasKey: o.hasKey !== false,
    detectNetwork: async () => o.detect || { state: "detected", networks: [o.chain || "Polygon"], errors: [] },
    getTxAndReceipt: async () => o.txr,
    latestBlock: async (c) => { if (o.failChains && o.failChains.includes(c)) throw new K.RpcError("HTTP 500", "http"); return { number: 1_000_000, timestamp: NOW }; },
    blockTimestamp: async (c, n) => (Number(n) === 16 && c === (o.chain || "Polygon") ? NOW - (o.ageSeconds == null ? 300 : o.ageSeconds) : NOW - (1_000_000 - Number(n)) * K.CHAINS[c].averageBlockTime),
    assetTransfers: async (c) => ({ transfers: (o.transfers && o.transfers[c]) || [] }),
    tokenLabels: async () => ({ symbol: null, name: null }),
    tokenDecimals: async () => 18,
    historicalPrice: async () => null,
    lifiStatus: async () => ({ available: false, reason: "not_lifi" }),
    getCode: async (c, a) => (o.code && o.code[a]) || "0x",
    getNonce: async () => (o.nonce == null ? 0 : o.nonce),
    ethCall: async () => { throw new K.RpcError("x", "revert"); },
  };
}
const receipt = (logs = [], o = {}) => ({ status: "0x1", logs, blockNumber: "0x10", gasUsed: "0x5208", effectiveGasPrice: "0x1", ...o });
const tx = (o = {}) => ({ hash: HASH, from: SENDER, to: SPOKE_POLY, value: "0x0", input: "0x12345678" + w(WALLET), nonce: "0x1", gas: "0x30d40", ...o });
const tlog = (token, from, to, raw) => ({ address: token, topics: [K.TRANSFER_TOPIC, "0x" + w(from), "0x" + w(to)], data: hex(raw) });
const incoming = (token, raw, ts, hash = "0x" + "22".repeat(32)) => ({ hash, from: SENDER, to: WALLET, category: "erc20", blockNum: "0x10", asset: "USDC", rawContract: { address: token, value: hex(raw), decimal: "0x6" }, metadata: { blockTimestamp: new Date(ts * 1000).toISOString() } });
const bridgeTxr = () => ({ transaction: tx(), receipt: receipt([tlog(USDC_POLY, SENDER, SPOKE_POLY, 5_000_000)]) });

const BASE_ANSWERS = { flow: "bridge", symptom: "not_arrived", elapsed: "lt1h", asset: "USDC", amount: "5", src_network: "Polygon", dst_network: "Base", dst_address: WALLET, third_party: "no", provider_status: "completed_sent", viewing_network: "Base", tx_hash: HASH };

async function run(answers, apiOpts = {}) {
  const a = { ...BASE_ANSWERS, ...answers };
  const E = await K.gatherEvidence(api(apiOpts), a, { nowSeconds: NOW });
  return { r: K.evaluate(a, E), E, a };
}
const code = async (answers, apiOpts) => (await run(answers, apiOpts)).r.verdict.code;

// ───────────── Con transacción verificada ─────────────
test("ORIGIN_FAILED: la transacción revirtió", async () => {
  const { r } = await run({}, { txr: { transaction: tx(), receipt: receipt([], { status: "0x0", gasUsed: "0x100" }) } });
  assert.equal(r.verdict.code, "ORIGIN_FAILED");
  assert.equal(r.verdict.level, "problem");
  assert.equal(r.confidence.level, "high");
});
test("ORIGIN_PENDING y ORIGIN_REPLACED", async () => {
  assert.equal(await code({}, { txr: { transaction: tx(), receipt: null }, nonce: 1 }), "ORIGIN_PENDING");
  assert.equal(await code({}, { txr: { transaction: tx(), receipt: null }, nonce: 9 }), "ORIGIN_REPLACED");
});
test("BURN_ADDRESS: envío a 0x…dEaD", async () => {
  assert.equal(await code({ dst_network: "Polygon", flow: "wallet_transfer" }, { txr: { transaction: tx({ to: K.DEAD_ADDRESS, value: "0x1", input: "0x" }), receipt: receipt() } }), "BURN_ADDRESS");
});
test("TOKEN_CONTRACT: tokens enviados al contrato del token", async () => {
  const t = tx({ to: USDC_POLY, input: "0xa9059cbb" + w(USDC_POLY) + w("4c4b40") });
  assert.equal(await code({ dst_network: "Polygon", flow: "wallet_transfer" }, { txr: { transaction: t, receipt: receipt([tlog(USDC_POLY, SENDER, USDC_POLY, 5_000_000)]) } }), "TOKEN_CONTRACT");
});
test("LOOKALIKE_ADDRESS: address poisoning dispara alerta crítica", async () => {
  const fake = WALLET.slice(0, 6) + "f".repeat(32) + WALLET.slice(-4);
  const { r } = await run({ dst_network: "Polygon", flow: "wallet_transfer", addr_source: "history" }, { txr: { transaction: tx({ to: fake, value: "0x1", input: "0x" }), receipt: receipt() } });
  assert.equal(r.verdict.code, "LOOKALIKE_ADDRESS");
  assert.ok(r.alerts.some((x) => x.id === "address_poisoning" && x.severity === "critical"));
});
test("WRONG_RECIPIENT: receptor distinto y sin parecido", async () => {
  assert.equal(await code({ dst_network: "Polygon", flow: "wallet_transfer" }, { txr: { transaction: tx({ to: OTHER, value: "0x1", input: "0x" }), receipt: receipt() } }), "WRONG_RECIPIENT");
});
test("WRONG_NETWORK_ON_SOURCE: el envío fue a la wallet, pero en la red de origen", async () => {
  const { r } = await run({ flow: "wallet_transfer", dst_network: "Base" }, { txr: { transaction: tx({ to: WALLET, value: "0x1", input: "0x" }), receipt: receipt() } });
  assert.equal(r.verdict.code, "WRONG_NETWORK_ON_SOURCE");
  assert.equal(r.recoverability.level, "accessible");
});
test("SWAP_NOT_BRIDGE: era un swap, no un puente", async () => {
  const t = tx({ to: UNI_BASE, input: "0x04e45aaf" });
  assert.equal(await code({ src_network: "Base", dst_network: "Polygon", flow: "bridge" }, { chain: "Base", txr: { transaction: t, receipt: receipt([tlog(USDC_BASE, UNI_BASE, SENDER, 1)]) } }), "SWAP_NOT_BRIDGE");
});
test("APPROVAL_ONLY: solo se otorgó permiso", async () => {
  const t = tx({ to: USDC_POLY, input: "0x095ea7b3" + w(OTHER) + w("ff") });
  assert.equal(await code({}, { txr: { transaction: t, receipt: receipt() } }), "APPROVAL_ONLY");
});
test("FUNDS_DELIVERED: puente exitoso con entrada verificada en destino", async () => {
  const { r } = await run({}, { txr: bridgeTxr(), transfers: { Base: [incoming(USDC_BASE, 4_980_000, NOW - 250)] } });
  assert.equal(r.verdict.code, "FUNDS_DELIVERED");
  assert.equal(r.verdict.level, "ok");
  assert.equal(r.confidence.level, "high");
  assert.equal(r.clientOperation.rating, "correct");
  assert.ok(r.limits.some((l) => /no es una prueba criptográfica/.test(l)), "no sobreafirma el vínculo");
});
test("DEPOSIT_ARRIVED_PENDING_CREDIT: llegó on-chain pero la plataforma no acredita", async () => {
  const t = tx({ to: USDC_POLY, input: "0xa9059cbb" + w(WALLET) + w("4c4b40") });
  const { r } = await run({ flow: "exchange_deposit", dst_network: "Polygon", src_network: "Polygon", symptom: "not_visible", viewing_network: undefined }, { txr: { transaction: t, receipt: receipt([tlog(USDC_POLY, SENDER, WALLET, 5_000_000)]) }, transfers: { Polygon: [incoming(USDC_POLY, 5_000_000, NOW - 250)] } });
  assert.equal(r.verdict.code, "DEPOSIT_ARRIVED_PENDING_CREDIT");
  assert.ok(r.nextSteps.length > 0);
});
test("DELIVERED_OTHER_NETWORK: los fondos aparecieron en otra red", async () => {
  const { r } = await run({ dst_network: "Optimism" }, { txr: bridgeTxr(), transfers: { Base: [incoming(USDC_BASE, 4_980_000, NOW - 250)] } });
  assert.equal(r.verdict.code, "DELIVERED_OTHER_NETWORK");
  assert.equal(r.context.deliveryChain, "Base");
});
test("IN_TRANSIT: sin entrada aún pero dentro del tiempo normal", async () => {
  const { r } = await run({}, { txr: bridgeTxr(), ageSeconds: 300 });
  assert.equal(r.verdict.code, "IN_TRANSIT");
  assert.equal(r.context.timingStatus, "within");
  assert.equal(r.confidence.level, "medium");
});
test("DELAYED_BEYOND_NORMAL: sin entrada y pasado el umbral", async () => {
  const { r } = await run({ elapsed: "1_7d" }, { txr: bridgeTxr(), ageSeconds: 3 * 86400 });
  assert.equal(r.verdict.code, "DELAYED_BEYOND_NORMAL");
  assert.equal(r.context.timingStatus, "beyond");
});
test("ARRIVAL_UNCONFIRMED: si falla la búsqueda NO se concluye que no llegó", async () => {
  const { r, E } = await run({}, { txr: bridgeTxr(), failChains: ["Base", "Polygon", "Ethereum", "Optimism", "Arbitrum"] });
  assert.equal(r.verdict.code, "ARRIVAL_UNCONFIRMED");
  assert.equal(r.context.delivery, "search_incomplete");
  assert.ok(r.confidence.level !== "high");
  const text = JSON.stringify(r.explanation).toLowerCase();
  assert.ok(!/no llegó|se perdieron|perdidos/.test(text), text);
});

// ───────────── Sin transacción verificada ─────────────
const NOHASH = { tx_hash: null, tx_chain_hint: undefined };
test("INPUT_ADDRESS_ERROR: dirección de otra cadena", async () => {
  const { r } = await run({ ...NOHASH, dst_address: "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm", dst_network: "Polygon", flow: "wallet_transfer" });
  assert.equal(r.verdict.code, "INPUT_ADDRESS_ERROR");
});
test("WRONG_NETWORK_DECLARED: retiro por una red y destino en otra", async () => {
  const { r } = await run({ ...NOHASH, flow: "exchange_withdrawal", src_network: "Ethereum", dst_network: "Polygon", provider: "Binance" });
  assert.equal(r.verdict.code, "WRONG_NETWORK_DECLARED");
  for (const id of ["network_choice", "provider_status", "timing"]) {
    assert.equal(r.checks.find((c) => c.id === id).basis, "declared", `${id}: lo declarado no se presenta como verificado`);
  }
  assert.equal(r.confidence.level, "low");
  assert.equal(r.clientOperation.rating, "partially");
});
test("MEMO_MISSING: faltó el memo obligatorio (misma red no EVM)", async () => {
  const { r } = await run({ ...NOHASH, flow: "exchange_deposit", src_network: "XRP Ledger", dst_network: "XRP Ledger", dst_address: null, memo: "required_missing", viewing_network: undefined });
  assert.equal(r.verdict.code, "MEMO_MISSING");
});
test("depósito por una red EVM hacia una red no EVM: prima la red equivocada, no el memo", async () => {
  assert.equal(await code({ ...NOHASH, flow: "exchange_deposit", src_network: "Polygon", dst_network: "XRP Ledger", dst_address: null, memo: "required_missing", viewing_network: undefined }), "WRONG_NETWORK_DECLARED");
});
test("FOUND_BY_SEARCH: sin hash, entrada encontrada por wallet/activo/monto", async () => {
  const { r } = await run({ ...NOHASH, flow: "exchange_withdrawal", elapsed: "lt1h", src_network: "Polygon", dst_network: "Polygon" }, { transfers: { Polygon: [incoming(USDC_POLY, 4_980_000, NOW - 1200)] } });
  assert.equal(r.verdict.code, "FOUND_BY_SEARCH");
  assert.equal(r.confidence.level, "medium");
  assert.ok(r.limits.some((l) => /no es una prueba criptográfica|no se dispuso del hash/i.test(l)));
});
test("PROVIDER_PROCESSING / PROVIDER_REJECTED / NEED_HASH / INSUFFICIENT_DATA", async () => {
  const same = { ...NOHASH, flow: "exchange_withdrawal", src_network: "Polygon", dst_network: "Polygon", dst_address: null };
  assert.equal(await code({ ...same, provider_status: "review" }), "PROVIDER_PROCESSING");
  assert.equal(await code({ ...same, provider_status: "rejected" }), "PROVIDER_REJECTED");
  assert.equal(await code({ ...same, provider_status: "completed_sent" }), "NEED_HASH");
  assert.equal(await code({ ...same, provider_status: "no_info" }), "INSUFFICIENT_DATA");
});
test("NETWORK_NOT_VERIFIABLE: red que la herramienta no consulta", async () => {
  const { r } = await run({ ...NOHASH, flow: "bridge", src_network: "BNB Chain", dst_network: "BNB Chain", dst_address: null, provider_status: "no_info" });
  assert.equal(r.verdict.code, "NETWORK_NOT_VERIFIABLE");
});
test("HASH_NOT_FOUND: el hash no existe en ninguna red soportada", async () => {
  const { r } = await run({}, { detect: { state: "not_found", networks: [], errors: [] }, provider_status: "no_info" });
  assert.ok(["HASH_NOT_FOUND", "NEED_HASH", "INSUFFICIENT_DATA"].includes(r.verdict.code));
  const fixed = await run({ provider_status: "no_info", src_network: "Polygon" }, { detect: { state: "not_found", networks: [], errors: [] } });
  assert.equal(fixed.r.verdict.code, "HASH_NOT_FOUND");
});

// ───────────── Propiedades transversales ─────────────
test("sin API key: se evalúa solo con lo declarado y se avisa", async () => {
  const a = { ...BASE_ANSWERS, flow: "exchange_withdrawal", src_network: "Ethereum", dst_network: "Polygon" };
  const E = await K.gatherEvidence(api({ hasKey: false }), a, { nowSeconds: NOW });
  const r = K.evaluate(a, E);
  assert.equal(r.verdict.code, "WRONG_NETWORK_DECLARED");
  assert.equal(r.confidence.level, "low");
  assert.ok(r.limits.some((l) => /API key/.test(l)));
});
test("un error de consulta degrada la confianza de «alta» a «media»", async () => {
  const E1 = await K.gatherEvidence(api({ txr: { transaction: tx(), receipt: receipt([], { status: "0x0" }) } }), BASE_ANSWERS, { nowSeconds: NOW });
  assert.equal(K.evaluate(BASE_ANSWERS, E1).confidence.level, "high");
  E1.errors.push({ step: "lifi", code: "network", message: "sin conexión" });
  const r = K.evaluate(BASE_ANSWERS, E1);
  assert.equal(r.confidence.level, "medium");
  assert.ok(r.limits.some((l) => /lifi/.test(l)));
});
test("third_party=yes agrega alerta de posible estafa sin cambiar el veredicto técnico", async () => {
  const withScam = await run({ third_party: "yes" }, { txr: bridgeTxr(), transfers: { Base: [incoming(USDC_BASE, 4_980_000, NOW - 250)] } });
  assert.equal(withScam.r.verdict.code, "FUNDS_DELIVERED");
  assert.ok(withScam.r.alerts.some((x) => x.id === "possible_scam"));
});
test("invariantes de forma: todo resultado es completo y está explicado", async () => {
  const scenarios = [
    [{}, { txr: bridgeTxr(), transfers: { Base: [incoming(USDC_BASE, 4_980_000, NOW - 250)] } }],
    [{}, { txr: bridgeTxr(), ageSeconds: 300 }],
    [{}, { txr: { transaction: tx(), receipt: receipt([], { status: "0x0" }) } }],
    [{ ...NOHASH, flow: "exchange_withdrawal", src_network: "Ethereum", dst_network: "Polygon" }, {}],
    [{ ...NOHASH, flow: "other", provider_status: undefined, dst_address: null, dst_network: undefined, src_network: undefined, asset: undefined, amount: undefined }, {}],
  ];
  for (const [ans, o] of scenarios) {
    const { r } = await run(ans, o);
    assert.ok(K.EVALUATOR_VERDICTS.includes(r.verdict.code));
    assert.ok(r.verdict.headline && r.explanation.length >= 1 && r.nextSteps.length >= 1, r.verdict.code);
    assert.ok(["ok", "attention", "problem", "info", "warning"].includes(r.verdict.level) || typeof r.verdict.level === "string");
    assert.ok(["high", "medium", "low"].includes(r.confidence.level));
    assert.ok(r.limits.length >= 1 && r.checks.length >= 1);
    for (const c of r.checks) assert.ok(["declared", "chain", "inferred"].includes(c.basis), `basis inválida en ${c.id}: ${c.basis}`);
    for (const id of r.concepts) assert.ok(K.CONCEPTS[id], `concepto inexistente: ${id}`);
  }
});
test("cobertura: cada veredicto del evaluador tiene al menos un escenario", () => {
  const src = require("node:fs").readFileSync(__filename, "utf8");
  for (const v of K.EVALUATOR_VERDICTS) assert.ok(src.includes(v), `sin escenario: ${v}`);
});
