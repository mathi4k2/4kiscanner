const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const WALLET = "0x" + "ab".repeat(20);
const OTHER = "0x" + "cd".repeat(20);
const USDC_POLY = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const SPOKE_POLY = "0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096";
const UNI_ROUTER_BASE = "0x2626664c2603336e57b271c5c0b26f421741e481";
const HASH = "0x" + "11".repeat(32);
const w = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const topic = (addr) => "0x" + w(addr);
const transferLog = (token, from, to, amount) => ({
  address: token,
  topics: [K.TRANSFER_TOPIC, topic(from), topic(to)],
  data: "0x" + w(amount.toString(16)),
});

// API simulada a nivel de método
function fakeApi(over = {}) {
  return {
    getCode: async () => "0x",
    getNonce: async () => 0,
    ethCall: async () => { throw new K.RpcError("execution reverted", "revert"); },
    tokenDecimals: async () => 18,
    tokenLabels: async () => ({ symbol: "XYZ", name: "Xyz Token" }),
    ...over,
  };
}
const baseTx = (o = {}) => ({ hash: HASH, from: WALLET, to: OTHER, value: "0x0", input: "0x", nonce: "0x1", gas: "0x5208", ...o });
const okReceipt = (logs = [], o = {}) => ({ status: "0x1", logs, blockNumber: "0x10", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", ...o });
const run = (api, { chain = "Polygon", dest = "Polygon", wallet = WALLET, tx = baseTx(), receipt = okReceipt() } = {}) =>
  K.diagnose(api, { chain, txHash: HASH, transaction: tx, receipt, destinationWallet: wallet, destinationChain: dest });
const ids = (r) => r.issues.map((i) => i.id);

test("describeCall reconoce transfer, approve y nativo", () => {
  assert.equal(K.describeCall(baseTx()).kind, "native");
  assert.equal(K.describeCall({ to: null }).kind, "deploy");
  const t = K.describeCall(baseTx({ input: "0xa9059cbb" + w(OTHER) + w("3e8") }));
  assert.equal(t.kind, "erc20_transfer");
  assert.equal(t.recipient, OTHER);
  assert.equal(t.amountRaw, 1000n);
  const a = K.describeCall(baseTx({ input: "0x095ea7b3" + w(OTHER) + w("ff") }));
  assert.equal(a.kind, "approve");
  assert.equal(a.spender, OTHER);
});

test("tokenIdentity: nativo, conocido, variante y desconocido", () => {
  assert.equal(K.tokenIdentity("Polygon", null, "POL").assetId, "native:POL");
  const usdc = K.tokenIdentity("Polygon", USDC_POLY, "POL");
  assert.deepEqual([usdc.assetId, usdc.decimals, usdc.variant], ["USDC", 6, null]);
  assert.equal(K.tokenIdentity("Polygon", "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", "POL").variant, "USDC.e (bridged)");
  assert.equal(K.tokenIdentity("Polygon", "0x" + "99".repeat(20), "POL").known, false);
});

test("origen fallido: motivo reproducido del revert", async () => {
  const msg = Buffer.from("ERC20: transfer amount exceeds balance");
  const data = "0x08c379a0" + w("20") + w(msg.length.toString(16)) + msg.toString("hex").padEnd(64, "0");
  const api = fakeApi({ ethCall: async () => { throw new K.RpcError("execution reverted", "revert", { data }); } });
  api.ethCall = async () => { const e = new K.RpcError("execution reverted", "revert"); e.data = data; throw e; };
  const r = await run(api, { receipt: okReceipt([], { status: "0x0", gasUsed: "0x1000" }), tx: baseTx({ gas: "0x2000" }) });
  assert.equal(r.statusCode, "ORIGIN_FAILED");
  assert.equal(r.color, "red");
  assert.equal(ids(r)[0], "origin_failed");
  assert.match(r.issues[0].detail, /exceeds balance/);
});

test("origen fallido: sin gas", async () => {
  const r = await run(fakeApi(), { receipt: okReceipt([], { status: "0x0", gasUsed: "0x5208" }) });
  assert.match(r.issues[0].detail, /agotó el gas/);
});

test("pendiente: reemplazada vs esperando", async () => {
  const replaced = await run(fakeApi({ getNonce: async () => 5 }), { receipt: null });
  assert.equal(replaced.statusCode, "ORIGIN_PENDING");
  assert.equal(ids(replaced)[0], "origin_replaced");
  const waiting = await run(fakeApi({ getNonce: async () => 1 }), { receipt: null });
  assert.equal(ids(waiting)[0], "origin_pending");
});

test("crédito nativo directo a la wallet: verde", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: WALLET, from: OTHER, value: "0xde0b6b3a7640000" }) });
  assert.equal(r.color, "green");
  assert.equal(r.directNativeCredit, true);
  assert.ok(ids(r).includes("direct_credit"));
  assert.equal(r.originAssets[0].amount, "1");
});

test("transfer ERC-20 a la wallet esperada: verde y activo reconocido", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: USDC_POLY, from: OTHER }), receipt: okReceipt([transferLog(USDC_POLY, OTHER, WALLET, 2500000n)]) });
  assert.equal(r.color, "green");
  assert.equal(r.originAssets[0].symbol, "USDC");
  assert.equal(r.originAssets[0].amount, "2.5");
});

test("misma red ≠ red destino: no es crédito", async () => {
  const r = await run(fakeApi(), { dest: "Base", tx: baseTx({ to: WALLET, from: OTHER, value: "0x1" }) });
  assert.notEqual(r.color, "green");
  assert.ok(ids(r).includes("wrong_network_delivery"));
});

test("puente conocido en tx.to: estado bridge", async () => {
  const r = await run(fakeApi(), { dest: "Base", tx: baseTx({ to: SPOKE_POLY, input: "0x12345678" + w(WALLET) }), receipt: okReceipt([transferLog(USDC_POLY, WALLET, SPOKE_POLY, 5000000n)]) });
  assert.equal(r.color, "bridge");
  assert.equal(r.statusCode, "ORIGIN_ROUTED_TO_BRIDGE");
  assert.equal(r.bridgeProtocols[0], "Across");
  assert.ok(ids(r).includes("wallet_encoded"));
  assert.equal(r.bridgeMatches[0].verified, true);
});

test("swap en DEX con destino en otra red", async () => {
  const r = await run(fakeApi(), { chain: "Base", dest: "Polygon", tx: baseTx({ to: UNI_ROUTER_BASE }), receipt: okReceipt([transferLog(USDC_POLY, UNI_ROUTER_BASE, WALLET, 1n)]) });
  assert.ok(ids(r).includes("dex_not_bridge"));
});

test("approve: solo permiso", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: USDC_POLY, input: "0x095ea7b3" + w(OTHER) + w("ff") }) });
  assert.ok(ids(r).includes("approval_only"));
  assert.ok(!ids(r).includes("no_assets_moved"));
});

test("transferencia nativa a la quema: un solo aviso crítico", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: K.DEAD_ADDRESS, value: "0x1" }) });
  assert.equal(ids(r).filter((i) => i === "burn_target").length, 1);
  assert.equal(ids(r).filter((i) => i === "burn_recipient").length, 0);
  assert.equal(r.issues[0].severity, "critical");
});

test("ERC-20 transfer a la dirección cero: crítico", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: USDC_POLY, input: "0xa9059cbb" + w(K.ZERO_ADDRESS) + w("1") }) });
  assert.ok(ids(r).includes("burn_recipient"));
});

test("address poisoning (mismos extremos) y typo", async () => {
  const poisoned = WALLET.slice(0, 6) + "f".repeat(32) + WALLET.slice(-4);
  const r = await run(fakeApi(), { tx: baseTx({ to: poisoned, value: "0x1" }) });
  assert.ok(ids(r).includes("address_poisoning"));
  assert.equal(r.issues[0].severity, "critical");
  const typo = WALLET.slice(0, -2) + "00";
  const r2 = await run(fakeApi(), { tx: baseTx({ to: typo, value: "0x1" }) });
  assert.ok(ids(r2).includes("address_typo"));
});

test("receptor distinto y sin parecido: error de destinatario", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: OTHER, value: "0x1" }) });
  assert.ok(ids(r).includes("recipient_mismatch"));
});

test("tokens enviados al contrato del propio token", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: USDC_POLY, input: "0xa9059cbb" + w(USDC_POLY) + w("f4240") }) });
  assert.ok(ids(r).includes("sent_to_token_contract"));
  assert.equal(r.issues[0].severity, "critical");
});

test("receptor contrato desconocido: advertencia", async () => {
  const r = await run(fakeApi({ getCode: async (c, a) => (a === OTHER ? "0x6080" : "0x") }), { tx: baseTx({ to: OTHER, value: "0x1" }) });
  assert.ok(ids(r).includes("recipient_is_contract"));
});

test("wallet de contrato inexistente en la red destino", async () => {
  const api = fakeApi({ getCode: async (chain) => (chain === "Polygon" ? "0x6080" : "0x") });
  const r = await run(api, { dest: "Base", tx: baseTx({ to: SPOKE_POLY, input: "0x1234" + w(WALLET) }) });
  assert.ok(ids(r).includes("contract_wallet_missing_on_destination"));
  // delegación EIP-7702 cuenta como wallet normal
  const api7702 = fakeApi({ getCode: async (chain) => (chain === "Polygon" ? "0x6080" : "0xef0100" + "11".repeat(20)) });
  const r2 = await run(api7702, { dest: "Base", tx: baseTx({ to: SPOKE_POLY, input: "0x1234" + w(WALLET) }) });
  assert.ok(!ids(r2).includes("contract_wallet_missing_on_destination"));
});

test("token desconocido y variante USDC.e", async () => {
  const unknown = "0x" + "77".repeat(20);
  const r = await run(fakeApi(), { tx: baseTx({ to: SPOKE_POLY }), receipt: okReceipt([transferLog(unknown, WALLET, SPOKE_POLY, 10n ** 18n)]) });
  assert.ok(ids(r).includes("unknown_token"));
  assert.equal(r.originAssets[0].symbol, "XYZ");
  const usdce = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
  const r2 = await run(fakeApi(), { tx: baseTx({ to: SPOKE_POLY }), receipt: okReceipt([transferLog(usdce, WALLET, SPOKE_POLY, 1000000n)]) });
  assert.ok(ids(r2).includes("token_variant"));
});

test("retiro desde L2 nativo: aviso de demora", async () => {
  const r = await run(fakeApi(), { chain: "Optimism", dest: "Ethereum", tx: baseTx({ to: "0x4200000000000000000000000000000000000010", input: "0x1234" }) });
  assert.ok(ids(r).includes("l2_withdrawal_delay"));
});

test("sin valor movido: aviso; NFT: aviso", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: SPOKE_POLY, input: "0x1234" }) });
  assert.ok(ids(r).includes("no_assets_moved"));
  const nft = { address: "0x" + "55".repeat(20), topics: [K.TRANSFER_TOPIC, topic(WALLET), topic(OTHER), "0x" + w("7")], data: "0x" };
  const r2 = await run(fakeApi(), { receipt: okReceipt([nft]), tx: baseTx({ to: SPOKE_POLY }) });
  assert.ok(ids(r2).includes("nft_transfer"));
});

test("robustez: logs malformados y recibo sin estado", async () => {
  const r = await run(fakeApi(), { receipt: okReceipt([null, 5, { topics: "x" }]) });
  assert.match(r.logsWarning, /malformados/);
  await assert.rejects(run(fakeApi(), { receipt: { status: "0x9", logs: [] } }), /estado de transacción/);
  const r3 = await run(fakeApi(), { receipt: okReceipt("raro") });
  assert.match(r3.logsWarning, /formato inesperado/);
});

test("orden de issues: críticos primero", async () => {
  const r = await run(fakeApi(), { tx: baseTx({ to: USDC_POLY, input: "0xa9059cbb" + w(USDC_POLY) + w("1") }) });
  const ranks = r.issues.map((i) => K.SEVERITY_RANK[i.severity]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("sin wallet esperada no se inventan discrepancias de receptor", async () => {
  const r = await run(fakeApi(), { wallet: "", tx: baseTx({ to: OTHER, value: "0x1" }) });
  for (const id of ["recipient_mismatch", "address_poisoning", "address_typo", "wallet_not_referenced", "sender_is_wallet", "wallet_encoded", "wrong_network_delivery"]) {
    assert.ok(!ids(r).includes(id), id);
  }
  assert.equal(r.directNativeCredit, false);
  // pero los riesgos objetivos siguen detectándose
  const burn = await run(fakeApi(), { wallet: "", tx: baseTx({ to: K.DEAD_ADDRESS, value: "0x1" }) });
  assert.ok(ids(burn).includes("burn_target"));
  const tokenSelf = await run(fakeApi(), { wallet: "", tx: baseTx({ to: USDC_POLY, input: "0xa9059cbb" + w(USDC_POLY) + w("1") }) });
  assert.ok(ids(tokenSelf).includes("sent_to_token_contract"));
  // creación de contrato con valor no cuenta como crédito a una wallet vacía
  const deploy = await run(fakeApi(), { wallet: "", tx: baseTx({ to: null, value: "0x1" }) });
  assert.equal(deploy.directNativeCredit, false);
});

test("un swap en DEX no se rotula como puente", async () => {
  const r = await run(fakeApi(), { chain: "Base", dest: "Base", tx: baseTx({ to: UNI_ROUTER_BASE }), receipt: okReceipt([transferLog(USDC_POLY, UNI_ROUTER_BASE, OTHER, 1n)]) });
  assert.notEqual(r.color, "bridge");
  assert.equal(r.bridgeMatches.length, 0);
  assert.equal(r.routeMatches.length, 1);
  assert.ok(ids(r).includes("dex_swap"));
});
