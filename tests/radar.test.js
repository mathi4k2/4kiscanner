const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const WALLET = "0x" + "ab".repeat(20);
const T = 1_800_000_000;          // "ahora" en la red destino
const LATEST = 1_000_000;
const ORIGIN_TS = T - 600;
const USDC_POLY = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const USDC_OP = "0x0b2c639c533813f4aa9d7837caf62653d097ff85";
const USDT_OP = "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58";
const HASH_D = "0x" + "dd".repeat(32);
const HASH_O = "0x" + "11".repeat(32);

const originUsdc = (raw = 5000000n) => ({ assetId: "USDC", symbol: "USDC", name: null, tokenAddress: USDC_POLY, amountRaw: raw, decimals: 6, amount: K.formatUnits(raw, 6) });
const blockAt = (chain, ts) => LATEST - Math.round((T - ts) / K.CHAINS[chain].averageBlockTime);
const alchemyTransfer = (chain, { ts, token = USDC_OP, raw = 4900000n, hash = HASH_D, asset = "USDC", decimals = "0x6", category = "erc20", to = WALLET }) => ({
  hash, from: "0x" + "ee".repeat(20), to, category, asset,
  blockNum: "0x" + blockAt(chain, ts).toString(16),
  rawContract: token ? { address: token, value: "0x" + raw.toString(16), decimal: decimals } : { address: null, value: "0x" + raw.toString(16), decimal: "0x12" },
  metadata: { blockTimestamp: new Date(ts * 1000).toISOString() },
});

function fakeApi({ transfers = {}, latestTs = T, errors = {}, prices = {}, pageSize = 1000, labels = {}, txs = {} } = {}) {
  const calls = { transfers: 0, prices: [] };
  return {
    calls,
    latestBlock: async (chain) => { if (errors[chain]) throw new K.RpcError(errors[chain], "http"); return { number: LATEST, timestamp: latestTs }; },
    blockTimestamp: async (chain, n) => latestTs - (LATEST - Number(typeof n === "string" ? parseInt(n, 16) : n)) * K.CHAINS[chain].averageBlockTime,
    assetTransfers: async (chain, f) => {
      calls.transfers++;
      const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      const all = (transfers[chain] || []).filter((t) => parseInt(t.blockNum, 16) >= from && parseInt(t.blockNum, 16) <= to);
      const start = f.pageKey ? Number(f.pageKey) : 0;
      const page = all.slice(start, start + pageSize);
      return { transfers: page, pageKey: start + pageSize < all.length ? String(start + pageSize) : undefined };
    },
    tokenLabels: async (chain, addr) => labels[addr] || { symbol: null, name: null },
    historicalPrice: async (ts, coin) => {
      calls.prices.push(coin);
      if (prices[coin] === "throw") throw new K.PriceError("DefiLlama caído");
      return prices[coin] === undefined ? null : prices[coin];
    },
    getTxAndReceipt: async (chain, hash) => {
      const t = txs[hash];
      if (!t) throw new K.RpcError("No se encontró la transacción", "tx_not_found");
      return t;
    },
  };
}
const scan = (api, over = {}) => K.scanDestinationRadar(api, { destChain: "Optimism", wallet: WALLET, originTimestamp: ORIGIN_TS, originAssets: [originUsdc()], originChain: "Polygon", ...over });

test("normalizeAssetLabel y alias", () => {
  assert.equal(K.normalizeAssetLabel("USD₮0"), "USDT");
  assert.equal(K.normalizeAssetLabel("USDT0"), "USDT");
  assert.equal(K.normalizeAssetLabel("Bridged USDC"), "USDC");
  assert.equal(K.normalizeAssetLabel("USD Coin"), "USDC");
  assert.equal(K.normalizeAssetLabel(""), null);
  assert.equal(K.normalizeAssetLabel(7), null);
});

test("findFeeTolerantAssetMatch: límites 97–100 %", () => {
  const dest = (raw, dec = 6, id = "USDC") => ({ assetId: id, symbol: "USDC", tokenAddress: USDC_OP, amountRaw: raw, decimals: dec });
  const m = K.findFeeTolerantAssetMatch([originUsdc()], dest(4900000n));
  assert.equal(m.feePercent, "2");
  assert.equal(m.originAmount, "5");
  assert.equal(m.destinationAmount, "4.9");
  assert.ok(K.findFeeTolerantAssetMatch([originUsdc()], dest(5000000n)));       // 100 % exacto
  assert.ok(K.findFeeTolerantAssetMatch([originUsdc()], dest(4850000n)));       // 97 % exacto
  assert.equal(K.findFeeTolerantAssetMatch([originUsdc()], dest(4849999n)), null); // < 97 %
  assert.equal(K.findFeeTolerantAssetMatch([originUsdc()], dest(5000001n)), null); // > 100 %
  assert.equal(K.findFeeTolerantAssetMatch([originUsdc()], dest(1n)), null);
  // decimales distintos (18 vs 6) se comparan a escala común
  const weth = { assetId: "WETH", symbol: "WETH", tokenAddress: "0x1", amountRaw: 10n ** 18n, decimals: 18 };
  assert.ok(K.findFeeTolerantAssetMatch([weth], { ...weth, amountRaw: 99n * 10n ** 16n }));
  // sin decimales conocidos no se compara
  assert.equal(K.findFeeTolerantAssetMatch([originUsdc()], dest(4900000n, null)), null);
  // activos distintos
  assert.equal(K.findFeeTolerantAssetMatch([originUsdc()], dest(4900000n, 6, "USDT") && { ...dest(4900000n), assetId: "USDT", symbol: "USDT" }), null);
  // coincidencia por etiqueta (USDT0 ≈ USDT)
  const o = { assetId: "0xabc", symbol: "USDT0", tokenAddress: "0xabc", amountRaw: 1000000n, decimals: 6 };
  assert.equal(K.findFeeTolerantAssetMatch([o], { assetId: "USDT", symbol: "USDT", tokenAddress: "0xdef", amountRaw: 990000n, decimals: 6 }).symbol, "USDT");
});

test("categorías según la red y bloque aproximado", () => {
  assert.deepEqual(K.transferCategories("Polygon"), ["external", "internal", "erc20", "erc721", "erc1155", "specialnft"]);
  assert.deepEqual(K.transferCategories("Optimism"), ["external", "erc20", "erc721", "erc1155", "specialnft"]);
  assert.equal(K.approximateBlockForTimestamp(T, LATEST, T, 2), LATEST);
  assert.equal(K.approximateBlockForTimestamp(T - 20, LATEST, T, 2), LATEST - 10);
  assert.equal(K.approximateBlockForTimestamp(T + 5, LATEST, T, 2), LATEST + 1);
  assert.equal(K.approximateBlockForTimestamp(0, LATEST, T, 2), 0);
});

test("radar: encuentra el mismo token en la ventana de 5 min", async () => {
  const api = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 120 })] } });
  const r = await scan(api);
  assert.equal(r.state, "found");
  assert.equal(r.transfer.matchType, "same_token");
  assert.equal(r.transfer.destinationAmount, "4.9");
  assert.equal(r.transfer.feePercent, "2");
  assert.equal(r.windows.find((w) => w.name === "5 min").state, "found");
  assert.equal(r.windows[0].state, "searched");
});

test("radar: ignora transferencias fuera de la ventana horaria y de otra wallet", async () => {
  const api = fakeApi({ transfers: { Optimism: [
    alchemyTransfer("Optimism", { ts: ORIGIN_TS - 500 }),                       // antes del origen
    alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, to: "0x" + "cd".repeat(20) }), // otro receptor
  ] } });
  const r = await scan(api);
  assert.equal(r.state, "not_found");
  assert.equal(r.candidates.length, 0);
});

test("radar: red destino aún sin llegar al momento del origen", async () => {
  const r = await scan(fakeApi({ latestTs: ORIGIN_TS - 30 }));
  assert.equal(r.state, "waiting_for_destination_chain");
});

test("radar: not_found cuando no hay nada y 48 h todavía no transcurren", async () => {
  const r = await scan(fakeApi());
  assert.equal(r.state, "not_found");
  assert.equal(r.full48hAvailable, false);
  assert.equal(r.searchedThrough, T);
  assert.ok(r.windows.some((w) => w.state === "not_reached"));
});

test("radar: monto fuera de rango queda como candidato", async () => {
  const api = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 3000000n })] } });
  const r = await scan(api);
  assert.equal(r.state, "candidates");
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].destinationAsset.amount, "3");
});

test("radar: swap por valor USD (ETH → USDC, 92 %)", async () => {
  const ethOrigin = { assetId: "native:ETH", symbol: "ETH", tokenAddress: null, amountRaw: 10n ** 18n, decimals: 18 };
  const api = fakeApi({
    transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 2300000000n })] },
    prices: { "coingecko:ethereum": 2500, [`optimism:${USDC_OP}`]: 1 },
  });
  const r = await scan(api, { originAssets: [ethOrigin], originChain: "Arbitrum" });
  assert.equal(r.state, "found");
  assert.equal(r.matchType, "swap");
  assert.equal(r.transfer.efficiencyPercent, "92.00");
  assert.equal(r.transfer.matchedAsset, "ETH → USDC");
  assert.equal(r.transfer.originValueUsd, "2500.00");
  // fuera de 85–98 % no es swap
  const low = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 1000000000n })] }, prices: { "coingecko:ethereum": 2500, [`optimism:${USDC_OP}`]: 1 } });
  assert.equal((await scan(low, { originAssets: [ethOrigin], originChain: "Arbitrum" })).state, "candidates");
  const high = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 2500000000n })] }, prices: { "coingecko:ethereum": 2500, [`optimism:${USDC_OP}`]: 1 } });
  assert.equal((await scan(high, { originAssets: [ethOrigin], originChain: "Arbitrum" })).state, "candidates");
});

test("radar: sin precio o precio caído → no se confirma y se informa", async () => {
  const ethOrigin = { assetId: "native:ETH", symbol: "ETH", tokenAddress: null, amountRaw: 10n ** 18n, decimals: 18 };
  const mk = (prices) => fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 2300000000n })] }, prices });
  const missing = await scan(mk({}), { originAssets: [ethOrigin], originChain: "Arbitrum" });
  assert.equal(missing.state, "candidates");
  assert.match(missing.swapError, /precio histórico/);
  const down = await scan(mk({ "coingecko:ethereum": "throw" }), { originAssets: [ethOrigin], originChain: "Arbitrum" });
  assert.equal(down.state, "candidates");
  assert.match(down.swapError, /caído/);
});

test("radar: token desconocido toma símbolo del log de Alchemy", async () => {
  const unknown = "0x" + "77".repeat(20);
  const api = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, token: unknown, asset: "XYZ", decimals: "0x12", raw: 10n ** 18n })] }, labels: { [unknown]: { symbol: "XYZ", name: "Xyz" } } });
  const origin = { assetId: unknown, symbol: "XYZ", name: "Xyz", tokenAddress: "0x" + "88".repeat(20), amountRaw: 10n ** 18n, decimals: 18 };
  const r = await scan(api, { originAssets: [origin] });
  assert.equal(r.state, "found"); // coincide por etiqueta XYZ
  assert.equal(r.transfer.matchedAsset, "XYZ");
});

test("radar: paginación y búsqueda parcial (5 páginas)", async () => {
  const many = Array.from({ length: 12 }, (_, i) => alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 1000000n + BigInt(i), hash: "0x" + i.toString(16).padStart(64, "0") }));
  const partial = await scan(fakeApi({ transfers: { Optimism: many }, pageSize: 1 }));
  assert.equal(partial.state, "incomplete");
  assert.equal(partial.partial, true);
  // con páginas más grandes se agota y no es parcial
  const complete = await scan(fakeApi({ transfers: { Optimism: many }, pageSize: 5 }));
  assert.equal(complete.state, "candidates");
  assert.equal(complete.partial, false);
  assert.equal(complete.candidates.length, 12);
  // el match aparece en la 3.ª página
  const withMatch = [...many.slice(0, 2), alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 4900000n })];
  assert.equal((await scan(fakeApi({ transfers: { Optimism: withMatch }, pageSize: 1 }))).state, "found");
});

test("fallback: encuentra en otra red cuando la elegida no tiene nada", async () => {
  const api = fakeApi({ transfers: { Base: [alchemyTransfer("Base", { ts: ORIGIN_TS + 100, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" })] } });
  const r = await K.scanWithFallback(api, { primaryChain: "Optimism", originChain: "Polygon", wallet: WALLET, originTimestamp: ORIGIN_TS, originAssets: [originUsdc()] });
  assert.equal(r.state, "found");
  assert.equal(r.fallbackMatch, true);
  assert.equal(r.matchedChain, "Base");
  assert.equal(r.primaryState, "not_found");
  assert.ok(!r.fallbackSearches.some((s) => s.chain === "Polygon"), "no busca en la red de origen");
});

test("fallback: la red elegida gana y no consulta las demás", async () => {
  const api = fakeApi({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100 })] } });
  const r = await K.scanWithFallback(api, { primaryChain: "Optimism", originChain: "Polygon", wallet: WALLET, originTimestamp: ORIGIN_TS, originAssets: [originUsdc()] });
  assert.equal(r.fallbackMatch, false);
  assert.equal(r.matchedChain, "Optimism");
  assert.equal(r.fallbackSearches.length, 1);
});

test("fallback: negativo global solo si todas las búsquedas fueron completas", async () => {
  const opts = { primaryChain: "Optimism", originChain: "Polygon", wallet: WALLET, originTimestamp: ORIGIN_TS, originAssets: [originUsdc()] };
  const none = await K.scanWithFallback(fakeApi(), opts);
  assert.equal(none.state, "no_match_global");
  assert.deepEqual(none.searchedNetworks.sort(), ["Arbitrum", "Base", "Ethereum", "Optimism"]);
  const withError = await K.scanWithFallback(fakeApi({ errors: { Base: "HTTP 500" } }), opts);
  assert.equal(withError.state, "fallback_incomplete");
  assert.equal(withError.fallbackSearches.find((s) => s.chain === "Base").state, "error");
  const primaryError = await K.scanWithFallback(fakeApi({ errors: { Optimism: "HTTP 500" } }), opts);
  assert.equal(primaryError.state, "fallback_incomplete");
  // candidatos de otras redes se acumulan con su red
  const cand = await K.scanWithFallback(fakeApi({ transfers: { Arbitrum: [alchemyTransfer("Arbitrum", { ts: ORIGIN_TS + 100, raw: 100n })] } }), opts);
  assert.equal(cand.state, "no_match_global");
  assert.equal(cand.candidates[0].candidateChain, "Arbitrum");
});

const w = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
test("verifyDestinationBridgeReference: niveles de evidencia", async () => {
  const SPOKE_OP = "0x6f26bf09b1c792e3228e5467807a900a503c0281";
  const base = { destChain: "Optimism", destinationTxHash: HASH_D, originTxHash: HASH_O, originSender: "0x" + "55".repeat(20) };
  const run = (tx, receipt) => K.verifyDestinationBridgeReference(fakeApi({ txs: { [HASH_D]: { transaction: tx, receipt } } }), base);

  assert.equal((await K.verifyDestinationBridgeReference(fakeApi(), { ...base, destinationTxHash: "0x12" })).status, "Not checked");
  assert.equal((await K.verifyDestinationBridgeReference(fakeApi(), base)).status, "Lookup failed");
  assert.equal((await run({ to: SPOKE_OP, input: "0x" }, null)).status, "Receipt unavailable");

  const verified = await run({ to: SPOKE_OP, input: "0xabcdef01" + w(HASH_O) }, { logs: [] });
  assert.equal(verified.status, "Verified Bridge Reference");
  assert.deepEqual(verified.bridgeNames, ["Across SpokePool"]);

  const logVerified = await run({ to: "0x" + "99".repeat(20), input: "0x" }, { logs: [{ address: SPOKE_OP, topics: [], data: "0x" + w(HASH_O) }] });
  assert.equal(logVerified.status, "Verified Bridge Reference");

  const hashOnly = await run({ to: "0x" + "99".repeat(20), input: "0xabcdef01" + w(HASH_O) }, { logs: [] });
  assert.equal(hashOnly.status, "Origin transaction hash referenced");

  const senderOnly = await run({ to: "0x" + "99".repeat(20), input: "0xabcdef01" + w("0x" + "55".repeat(20)) }, { logs: [] });
  assert.equal(senderOnly.status, "Sender wallet referenced (unverified)");

  const none = await run({ to: "0x" + "99".repeat(20), input: "0x" }, { logs: [] });
  assert.equal(none.status, "No explicit origin reference found");

  // un router de DEX NO vincula origen y destino
  const UNI = "0x4a7b5da61326a6379179b40d00f57e5bbdc962c2";
  const dex = await run({ to: UNI, input: "0xabcdef01" + w(HASH_O) }, { logs: [] });
  assert.equal(dex.status, "Origin transaction hash referenced");
});

test("classifyOperation", () => {
  const same = { state: "found", matchType: "same_token", matchedChain: "Optimism", transfer: { matchType: "same_token", originAmount: "5", destinationAmount: "4.9", matchedAsset: "USDC", matchedOriginAsset: { symbol: "USDC" }, destinationAsset: { symbol: "USDC" } } };
  const c = K.classifyOperation({ chain: "Polygon", destinationChain: "Optimism", radar: same, originAssets: [] });
  assert.equal(c.category, "Puente entre redes");
  assert.equal(c.operationType, "Bridge");
  assert.equal(c.networkRoute, "Polygon → Optimism");
  assert.equal(c.assetFlow, "5 USDC → 4.9 USDC");
  assert.match(c.verificationMethod, /Coincidencia directa/);
  const verified = K.classifyOperation({ chain: "Polygon", destinationChain: "Optimism", radar: { ...same, referenceCheck: { status: "Verified Bridge Reference" } } });
  assert.equal(verified.verificationMethod, "Firma de router de puente");
  assert.equal(K.classifyOperation({ chain: "Polygon", destinationChain: "Polygon", radar: { ...same, matchedChain: "Polygon" } }).category, "Transferencia en la misma red");
  const swap = { state: "found", matchType: "swap", matchedChain: "Polygon", transfer: { originAmount: "1", destinationAmount: "2300", originSymbol: "ETH", destinationSymbol: "USDC" } };
  assert.equal(K.classifyOperation({ chain: "Polygon", destinationChain: "Polygon", radar: swap }).category, "Swap en la misma red");
  assert.equal(K.classifyOperation({ chain: "Base", destinationChain: "Polygon", radar: { ...swap, matchedChain: "Polygon" } }).operationType, "Cross-Chain Swap");
  const none = K.classifyOperation({ chain: "Polygon", destinationChain: "Base", radar: { state: "not_found" }, originAssets: [{ symbol: "USDC" }] });
  assert.equal(none.category, "Operación no confirmada");
  assert.match(none.assetFlow, /USDC/);
});

// ───────────── analyzeDestination: semáforo según el desenlace del radar ─────────────
const diag = (o = {}) => ({
  status: "0x1", chain: "Polygon", destinationChain: "Optimism", destinationWallet: WALLET, txHash: HASH_O, blockNumber: 16,
  from: "0x" + "55".repeat(20), transaction: { from: "0x" + "55".repeat(20) }, originAssets: [originUsdc()],
  color: "yellow", indicator: "🟡", title: "previo", statusCode: "ORIGIN_CONFIRMED_DESTINATION_UNVERIFIED", notes: "previo", issues: [], ...o,
});
const apiFor = (over) => {
  const a = fakeApi(over);
  const base = a.blockTimestamp;
  a.blockTimestamp = async (chain, n) => (chain === "Polygon" && Number(n) === 16 ? ORIGIN_TS : base(chain, n)); // solo el bloque de origen
  return a;
};

test("analyzeDestination: origen fallido o sin bloque → no corre", async () => {
  assert.equal((await K.analyzeDestination(fakeApi(), diag({ status: "0x0" }))).skipped, "origin_failed");
  assert.equal((await K.analyzeDestination(fakeApi(), diag({ blockNumber: null }))).skipped, "no_block");
});

test("analyzeDestination: encontrado en la red esperada → verde y clasificado", async () => {
  // blockTimestamp fijo en el origen; el reloj de la red destino es T
  const api = apiFor({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100 })] } });
  const { diagnosis, radar, skipped } = await K.analyzeDestination(api, diag());
  assert.equal(skipped, null);
  assert.equal(radar.state, "found");
  assert.equal(diagnosis.color, "green");
  assert.equal(diagnosis.statusCode, "CROSS_CHAIN_BRIDGE_CONFIRMED");
  assert.equal(diagnosis.operationClassification.operationType, "Bridge");
  assert.equal(diagnosis.originTimestamp, ORIGIN_TS);
  assert.match(diagnosis.notes, /4\.9 USDC/);
  assert.equal(radar.referenceCheck.status, "Lookup failed"); // la tx de destino no existe en el simulador
  assert.match(radar.priceError, /precio histórico/);
});

test("analyzeDestination: llegó a otra red → amarillo con aviso de respaldo", async () => {
  const api = apiFor({ transfers: { Base: [alchemyTransfer("Base", { ts: ORIGIN_TS + 100, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" })] } });
  const { diagnosis, radar } = await K.analyzeDestination(api, diag());
  assert.equal(radar.fallbackMatch, true);
  assert.equal(diagnosis.color, "yellow");
  assert.equal(diagnosis.statusCode, "CROSS_NETWORK_FALLBACK_MATCH");
  assert.match(diagnosis.notes, /Optimism.*Base/);
});

test("analyzeDestination: nada en ninguna red → rojo; error en una red → amarillo", async () => {
  const none = await K.analyzeDestination(apiFor(), diag());
  assert.equal(none.diagnosis.color, "red");
  assert.equal(none.diagnosis.statusCode, "NO_MATCH_GLOBAL");
  const partial = await K.analyzeDestination(apiFor({ errors: { Base: "HTTP 500" } }), diag());
  assert.equal(partial.diagnosis.color, "yellow");
  assert.equal(partial.diagnosis.statusCode, "GLOBAL_SEARCH_INCOMPLETE");
  assert.match(partial.diagnosis.notes, /no pudo completarse/);
});

test("analyzeDestination: entradas que no coinciden y nada más → sin coincidencia, con candidatos informados", async () => {
  const api = apiFor({ transfers: { Optimism: [alchemyTransfer("Optimism", { ts: ORIGIN_TS + 100, raw: 3000000n })] } });
  const { diagnosis, radar } = await K.analyzeDestination(api, diag());
  assert.equal(diagnosis.statusCode, "NO_MATCH_GLOBAL");
  assert.equal(radar.candidates.length, 1);
  assert.match(diagnosis.notes, /1 transferencia\(s\) entrante\(s\) que no cumplen/);
  assert.equal(radar.referenceCheck.status, "Lookup failed"); // se inspecciona el candidato principal
});

test("analyzeDestination: no muta el diagnóstico recibido", async () => {
  const d = diag();
  await K.analyzeDestination(apiFor(), d);
  assert.equal(d.color, "yellow");
  assert.equal(d.statusCode, "ORIGIN_CONFIRMED_DESTINATION_UNVERIFIED");
});

test("scanDestinationRadarWithFallback: sin red de origen busca en las 5 redes sin cortar", async () => {
  const api = fakeApi({ transfers: {
    Ethereum: [alchemyTransfer("Ethereum", { ts: ORIGIN_TS + 100, token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" })],
    Base: [alchemyTransfer("Base", { ts: ORIGIN_TS + 100, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" })],
  } });
  const r = await K.scanDestinationRadarWithFallback(api, "Polygon", "", WALLET, ORIGIN_TS, [originUsdc()]);
  assert.equal(r.fallbackSearches.length, 5);
  assert.equal(r.matchedChain, "Ethereum");
  assert.deepEqual(r.allMatches.map((m) => m.chain).sort(), ["Base", "Ethereum"]);
});
