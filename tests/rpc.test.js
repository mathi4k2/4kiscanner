const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");
const { makeFetch, rpcOk, rpcErr } = require("./mock.js");

const KEY = "SECRETKEY123";
const HASH = "0x" + "ab".repeat(32);
const make = (handler, extra = {}, log) =>
  K.createApi({ apiKey: KEY, fetchFn: makeFetch(handler, log), retryDelayMs: 0, timeoutMs: 80, ...extra });

test("call: éxito, URL por red y cuerpo JSON-RPC", async () => {
  const log = [];
  const api = make(() => rpcOk("0x10"), {}, log);
  assert.equal(await api.call("Polygon", "eth_blockNumber", []), "0x10");
  assert.equal(log[0].url, `https://polygon-mainnet.g.alchemy.com/v2/${KEY}`);
  assert.equal(log[0].body.method, "eth_blockNumber");
});

test("call: validaciones locales sin tocar la red", async () => {
  const log = [];
  await assert.rejects(K.createApi({ apiKey: "", fetchFn: makeFetch(() => rpcOk(1), log) }).call("Base", "x", []), (e) => e.code === "no_key");
  await assert.rejects(K.createApi({ apiKey: "a b", fetchFn: makeFetch(() => rpcOk(1), log) }).call("Base", "x", []), (e) => e.code === "no_key");
  await assert.rejects(make(() => rpcOk(1)).call("Narnia", "x", []), (e) => e.code === "config");
  assert.equal(log.length, 0);
});

test("call: errores HTTP traducidos", async () => {
  await assert.rejects(make(() => ({ status: 401, json: {} })).call("Base", "x", []), (e) => e.code === "auth");
  await assert.rejects(make(() => ({ status: 403, json: {} })).call("Base", "x", []), (e) => e.code === "auth");
  await assert.rejects(make(() => ({ status: 404, json: {} })).call("Base", "x", []), (e) => e.code === "endpoint");
  await assert.rejects(make(() => ({ status: 500, json: {} })).call("Base", "x", []), (e) => e.code === "http");
  await assert.rejects(make(() => ({ invalidJson: true })).call("Base", "x", []), (e) => e.code === "invalid");
  await assert.rejects(make(() => ({ json: { jsonrpc: "2.0" } })).call("Base", "x", []), (e) => e.code === "invalid");
});

test("call: 429 se reintenta y luego se informa", async () => {
  let calls = 0;
  const api = make(() => (++calls < 3 ? { status: 429, json: {} } : rpcOk("0x1")));
  assert.equal(await api.call("Base", "x", []), "0x1");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(make(() => (calls++, { status: 429, json: {} })).call("Base", "x", []), (e) => e.code === "rate_limited");
  assert.equal(calls, 3); // intento inicial + 2 reintentos
});

test("call: errores de red (con reintento) y timeout", async () => {
  let calls = 0;
  const failing = K.createApi({ apiKey: KEY, retryDelayMs: 0, fetchFn: async () => { calls++; throw new TypeError("Failed to fetch"); } });
  await assert.rejects(failing.call("Base", "x", []), (e) => e.code === "network");
  assert.equal(calls, 3);
  await assert.rejects(make(() => new Promise(() => {})).call("Base", "x", []), (e) => e.code === "timeout");
});

test("call: errores JSON-RPC; la API key nunca se filtra", async () => {
  await assert.rejects(make(() => rpcErr(`invalid API key ${KEY}`)).call("Base", "x", []), (e) => e.code === "auth" && !e.message.includes(KEY));
  await assert.rejects(make(() => rpcErr("unknown chain")).call("Base", "x", []), (e) => e.code === "endpoint");
  await assert.rejects(make(() => rpcErr(`boom ${KEY} boom`)).call("Base", "x", []), (e) => e.code === "rpc" && !e.message.includes(KEY) && e.message.includes("[API Key]"));
  // revert conserva los datos aunque el mensaje contenga "not found"
  await assert.rejects(
    make(() => rpcErr("execution reverted: token not found", 3, "0x08c379a0")).call("Base", "eth_call", []),
    (e) => e.code === "revert" && e.data === "0x08c379a0"
  );
});

test("getTxAndReceipt: no encontrada, pendiente y completa", async () => {
  await assert.rejects(make(() => rpcOk(null)).getTxAndReceipt("Base", HASH), (e) => e.code === "tx_not_found");
  const api = make((_, b) => rpcOk(b.method === "eth_getTransactionByHash" ? { hash: HASH } : null));
  const { transaction, receipt } = await api.getTxAndReceipt("Base", HASH);
  assert.equal(transaction.hash, HASH);
  assert.equal(receipt, null);
  await assert.rejects(make(() => rpcOk([1])).getTransaction("Base", HASH), (e) => e.code === "invalid");
});

test("detectNetwork: detected / ambiguous / not_found / incomplete", async () => {
  const onlyOn = (...chains) => (url, b) => rpcOk(chains.some((c) => url.includes(K.CHAINS[c].alchemySlug)) ? { hash: HASH } : null);
  assert.deepEqual((await make(onlyOn("Optimism")).detectNetwork(HASH)).networks, ["Optimism"]);
  assert.equal((await make(onlyOn("Optimism")).detectNetwork(HASH)).state, "detected");
  const amb = await make(onlyOn("Base", "Arbitrum")).detectNetwork(HASH);
  assert.equal(amb.state, "ambiguous");
  assert.equal((await make(onlyOn()).detectNetwork(HASH)).state, "not_found");
  const inc = await make((url) => (url.includes("base-mainnet") ? { status: 500, json: {} } : rpcOk(null))).detectNetwork(HASH);
  assert.equal(inc.state, "incomplete");
  assert.equal(inc.errors[0].chain, "Base");
  // coincidencia parcial + error en otra red sigue siendo "detected"
  const mixed = await make((url) => (url.includes("base-mainnet") ? { status: 500, json: {} } : rpcOk(url.includes("eth-mainnet") ? { hash: HASH } : null))).detectNetwork(HASH);
  assert.equal(mixed.state, "detected");
  assert.equal(mixed.errors.length, 1);
});

test("bloques, nonce, código y tokens", async () => {
  const api = make((url, b) => {
    switch (b.method) {
      case "eth_getBlockByNumber": return rpcOk({ number: "0x64", timestamp: "0x65a1b2c3" });
      case "eth_getCode": return rpcOk("0x6080");
      case "eth_getTransactionCount": return rpcOk("0x7");
      case "eth_call": return rpcOk(b.params[0].data === "0x313ce567" ? "0x" + "6".padStart(64, "0") : "0x" + Buffer.from("USDC").toString("hex").padEnd(64, "0"));
    }
  });
  assert.deepEqual(await api.latestBlock("Base"), { number: 100, timestamp: 0x65a1b2c3 });
  assert.equal(await api.blockTimestamp("Base", 100), 0x65a1b2c3);
  assert.equal(await api.getCode("Base", "0x" + "1".repeat(40)), "0x6080");
  assert.equal(await api.getNonce("Base", "0x" + "1".repeat(40)), 7);
  assert.equal(await api.tokenDecimals("Base", "0x" + "1".repeat(40)), 6);
  assert.deepEqual(await api.tokenLabels("Base", "0x" + "1".repeat(40)), { symbol: "USDC", name: "USDC" });
  // un token que revierte devuelve null, no lanza
  const broken = make(() => rpcErr("execution reverted", 3));
  assert.equal(await broken.tokenDecimals("Base", "0x" + "1".repeat(40)), null);
  assert.equal(await broken.tokenText("Base", "0x" + "1".repeat(40), "0x95d89b41"), null);
});

test("historicalPrice: URL, caché, datos faltantes y errores", async () => {
  const log = [];
  const api = make((url) => ({ json: { coins: { "ethereum:0xabc": { price: 2500.5 } } } }), {}, log);
  assert.equal(await api.historicalPrice(1700000000, "ethereum:0xabc"), 2500.5);
  assert.equal(await api.historicalPrice(1700000000, "ethereum:0xabc"), 2500.5);
  assert.equal(log.length, 1, "la segunda consulta sale de caché");
  assert.equal(log[0].url, "https://coins.llama.fi/prices/historical/1700000000/ethereum:0xabc");
  assert.equal(await api.historicalPrice(1, "ethereum:0xzzz"), null);
  await assert.rejects(make(() => ({ status: 502, json: {} })).historicalPrice(1, "x:y"), (e) => e.name === "PriceError");
  assert.equal(await make(() => ({ json: { coins: { "a:b": { price: -1 } } } })).historicalPrice(1, "a:b"), null);
});

test("lifiStatus: disponible / no aplica / caído (nunca lanza)", async () => {
  const ok = make(() => ({ json: { status: "DONE", substatus: "COMPLETED", tool: "across", receiving: { txHash: HASH, chainId: 10 } } }));
  assert.deepEqual(await ok.lifiStatus(HASH, "Polygon"), { available: true, status: "DONE", substatus: "COMPLETED", tool: "across", receivingTxHash: HASH, receivingChainId: 10 });
  assert.deepEqual(await make(() => ({ status: 404, json: {} })).lifiStatus(HASH), { available: false, reason: "not_lifi" });
  assert.equal((await make(() => ({ status: 500, json: {} })).lifiStatus(HASH)).available, false);
  assert.equal((await make(() => new Promise(() => {})).lifiStatus(HASH)).available, false);
  const pending = await make(() => ({ json: { status: "PENDING", receiving: {} } })).lifiStatus(HASH);
  assert.equal(pending.receivingTxHash, null);
});
