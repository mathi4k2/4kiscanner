const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const NOW = 1_800_000_000;
const WALLET = "0x" + "ab".repeat(20);
const SENDER = "0x" + "cd".repeat(20);
const HASH = "0x" + "11".repeat(32);
const USDC_POLY = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SPOKE_POLY = "0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096";
const w = (h) => h.replace(/^0x/, "").padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);

function api(o = {}) {
  const calls = [];
  const a = {
    hasKey: o.hasKey !== false,
    calls,
    detectNetwork: async () => { calls.push("detect"); return o.detect || { state: "not_found", networks: [], errors: [] }; },
    getTxAndReceipt: async (c) => { calls.push("tx:" + c); if (o.txError) throw new K.RpcError("falló", "rpc"); return o.txr || { transaction: null, receipt: null }; },
    latestBlock: async () => ({ number: 1_000_000, timestamp: o.latest || NOW }),
    blockTimestamp: async (c, n) => { if (o.blockTs) return o.blockTs(c, n); return NOW - 600; },
    assetTransfers: async (c) => { calls.push("transfers:" + c); return { transfers: (o.transfers && o.transfers[c]) || [] }; },
    tokenLabels: async () => ({ symbol: null, name: null }),
    tokenDecimals: async () => 18,
    historicalPrice: async () => null,
    lifiStatus: async () => { calls.push("lifi"); return o.lifi || { available: false, reason: "not_lifi" }; },
    getCode: async () => "0x", getNonce: async () => 0, ethCall: async () => { throw new K.RpcError("x", "revert"); },
  };
  return a;
}
const bridgeTx = () => {
  const tx = { hash: HASH, from: SENDER, to: SPOKE_POLY, value: "0x0", input: "0x12345678" + w(WALLET), nonce: "0x1", gas: "0x30d40" };
  const log = { address: USDC_POLY, topics: [K.TRANSFER_TOPIC, "0x" + w(SENDER), "0x" + w(SPOKE_POLY)], data: hex(5_000_000) };
  return { transaction: tx, receipt: { status: "0x1", logs: [log], blockNumber: "0x10", gasUsed: "0x5208", effectiveGasPrice: "0x1" } };
};
const transferTo = (token, raw, ts) => ({ hash: "0x" + "22".repeat(32), from: SENDER, to: WALLET, category: "erc20", blockNum: "0x10", asset: "USDC", rawContract: { address: token, value: hex(raw), decimal: "0x6" }, metadata: { blockTimestamp: new Date(ts * 1000).toISOString() } });

test("declaredAssets: convierte lo declarado a un activo comparable", () => {
  const [a] = K.declaredAssets({ asset: "USDC", amount: "12.5" });
  assert.equal(a.amountRaw, 12_500_000n);
  assert.equal(a.assetId, "USDC");
  assert.equal(K.declaredAssets({ asset: "ETH", amount: "0.25" })[0].assetId, "native:ETH");
  assert.equal(K.declaredAssets({ asset: "ETH", amount: "0.25" })[0].amountRaw, 250000000000000000n);
  assert.deepEqual(K.declaredAssets({ asset: "OTHER", amount: "5" }), []);
  assert.deepEqual(K.declaredAssets({ asset: "USDC" }), []);
  assert.deepEqual(K.declaredAssets({ asset: "USDC", amount: "1.1234567" }), []); // más decimales de los posibles
});

test("sin API key: no se consulta nada y se informa", async () => {
  const a = api({ hasKey: false });
  const E = await K.gatherEvidence(a, { flow: "bridge", tx_hash: HASH }, { nowSeconds: NOW });
  assert.equal(E.skipped, "no_key");
  assert.deepEqual(a.calls, []);
});

test("con hash: detecta la red, diagnostica y corre el radar", async () => {
  const a = api({
    detect: { state: "detected", networks: ["Polygon"], errors: [] },
    txr: bridgeTx(),
    blockTs: async () => NOW - 600,
    transfers: { Base: [transferTo(USDC_BASE, 4_980_000, NOW - 500)] },
  });
  const steps = [];
  const E = await K.gatherEvidence(a, { flow: "bridge", src_network: "Polygon", dst_network: "Base", dst_address: WALLET, tx_hash: HASH, asset: "USDC", amount: "5" }, { nowSeconds: NOW, onStep: (s) => steps.push(s) });
  assert.equal(E.txChain, "Polygon");
  assert.equal(E.diagnosis.statusCode, "CROSS_CHAIN_BRIDGE_CONFIRMED");
  assert.equal(E.radar.matchedChain, "Base");
  assert.deepEqual(steps, ["detect", "transaction", "diagnose", "radar", "lifi"]);
  assert.ok(a.calls.includes("lifi"));
  assert.equal(E.errors.length, 0);
});

test("elección de red: ambigua → pista del enlace → red declarada", async () => {
  const detect = { state: "ambiguous", networks: ["Base", "Optimism"], errors: [] };
  assert.equal((await K.gatherEvidence(api({ detect, txr: bridgeTx() }), { flow: "bridge", tx_hash: HASH, tx_chain_hint: "Optimism" }, { nowSeconds: NOW })).txChain, "Optimism");
  assert.equal((await K.gatherEvidence(api({ detect, txr: bridgeTx() }), { flow: "bridge", tx_hash: HASH, src_network: "Optimism" }, { nowSeconds: NOW })).txChainHow, "declared");
  assert.equal((await K.gatherEvidence(api({ detect, txr: bridgeTx() }), { flow: "bridge", tx_hash: HASH }, { nowSeconds: NOW })).txChainHow, "ambiguous_first");
});

test("hash no encontrado: se registra sin inventar un diagnóstico", async () => {
  const E = await K.gatherEvidence(api({ detect: { state: "not_found", networks: [], errors: [] } }), { flow: "wallet_transfer", tx_hash: HASH, src_network: "BNB Chain" }, { nowSeconds: NOW });
  assert.equal(E.detect.state, "not_found");
  assert.equal(E.diagnosis, undefined);
  const inc = await K.gatherEvidence(api({ detect: { state: "incomplete", networks: [], errors: [{ chain: "Base", message: "HTTP 500", code: "http" }] } }), { flow: "wallet_transfer", tx_hash: HASH }, { nowSeconds: NOW });
  assert.match(inc.errors[0].message, /Base/);
});

test("un error de red en un paso se aísla y se registra", async () => {
  const E = await K.gatherEvidence(api({ detect: { state: "detected", networks: ["Polygon"], errors: [] }, txError: true }), { flow: "bridge", tx_hash: HASH, dst_network: "Base", dst_address: WALLET }, { nowSeconds: NOW });
  assert.equal(E.diagnosis, undefined);
  assert.equal(E.errors[0].step, "transaction");
});

test("red de destino no verificable: no se corre el radar", async () => {
  const E = await K.gatherEvidence(api({ detect: { state: "detected", networks: ["Polygon"], errors: [] }, txr: bridgeTx() }), { flow: "exchange_deposit", tx_hash: HASH, dst_network: "Tron", dst_address: WALLET }, { nowSeconds: NOW });
  assert.equal(E.radarSkipped, "dst_network_unsupported");
  assert.ok(E.diagnosis);
  const noWallet = await K.gatherEvidence(api({ detect: { state: "detected", networks: ["Polygon"], errors: [] }, txr: bridgeTx() }), { flow: "bridge", tx_hash: HASH, dst_network: "Base" }, { nowSeconds: NOW });
  assert.equal(noWallet.radarSkipped, "no_wallet");
});

test("swap: destino = red de origen", async () => {
  const E = await K.gatherEvidence(api({ detect: { state: "detected", networks: ["Polygon"], errors: [] }, txr: bridgeTx() }), { flow: "swap", tx_hash: HASH, src_network: "Polygon", dst_address: WALLET }, { nowSeconds: NOW });
  assert.equal(E.destChain, "Polygon");
  assert.ok(E.radar);
});

test("sin hash: busca entradas recientes en todas las redes", async () => {
  const a = api({ transfers: { Ethereum: [transferTo("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 99_500_000, NOW - 3000)] } });
  const E = await K.gatherEvidence(a, { flow: "exchange_withdrawal", elapsed: "lt1h", asset: "USDC", amount: "100", dst_network: "Polygon", dst_address: WALLET }, { nowSeconds: NOW });
  assert.equal(E.inbound.state, "found");
  assert.equal(E.inbound.matchedChain, "Ethereum");
  assert.equal(E.inbound.fallbackMatch, true);
  assert.equal(E.inboundMatchedByDeclared, true);
  const searched = E.inbound.fallbackSearches.map((s) => s.chain).sort();
  assert.deepEqual(searched, ["Arbitrum", "Base", "Ethereum", "Optimism", "Polygon"]);
});

test("sin hash: demasiado antiguo, sin wallet o depósito a exchange → no se busca", async () => {
  const base = { flow: "exchange_withdrawal", asset: "USDC", amount: "1", dst_network: "Polygon", dst_address: WALLET };
  assert.equal((await K.gatherEvidence(api(), { ...base, elapsed: "gt7d" }, { nowSeconds: NOW })).inboundSkipped, "too_old");
  assert.equal((await K.gatherEvidence(api(), { ...base, dst_address: null, elapsed: "lt1h" }, { nowSeconds: NOW })).inboundSkipped, "no_wallet");
  const dep = api();
  const E = await K.gatherEvidence(dep, { ...base, flow: "exchange_deposit", elapsed: "lt1h" }, { nowSeconds: NOW });
  assert.equal(E.inbound, undefined);
  assert.ok(!dep.calls.some((c) => c.startsWith("transfers:")));
});
