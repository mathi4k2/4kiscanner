const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

test("catálogo: todas las direcciones son 0x + 40 hex en minúsculas", () => {
  for (const [chain, entries] of Object.entries(K.CATALOG)) {
    assert.ok(K.CHAINS[chain], `red desconocida ${chain}`);
    assert.ok(Object.keys(entries).length > 5, `catálogo vacío en ${chain}`);
    for (const [key, entry] of Object.entries(entries)) {
      assert.match(key, /^0x[0-9a-f]{40}$/, `${chain}: ${key}`);
      assert.equal(entry.address, key);
      assert.ok(entry.name && entry.protocol && entry.type);
      assert.ok(["bridge", "dex"].includes(entry.category));
      assert.equal(typeof entry.verified, "boolean");
    }
  }
});

test("catálogo: lo verificado pisa lo heredado y se conserva el legado", () => {
  const eth = K.CATALOG.Ethereum;
  assert.equal(eth["0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5"].verified, true);   // Across oficial
  assert.equal(eth["0xfbc81a18ecda8e6a91275cfdf5fc6d91a7c5ae80"].verified, false);  // Across legado
  assert.equal(eth["0x8731d54e9d02c286767d56ac03e8037c07e01e98"].verified, true);   // Stargate V1 (estaba en ambos)
  assert.equal(K.CATALOG.Arbitrum["0x0000000000000000000000000000000000000064"].protocol, "Arbitrum Native Bridge");
  // La entrada dudosa de Polygon (misma dirección que RootChainManager de Ethereum) se omitió
  assert.equal(K.CATALOG.Polygon["0xa0c68c638235ee32657e8f720a23cec1bfc77c77"], undefined);
  // cada red tiene su SpokePool de Across verificado
  for (const chain of Object.keys(K.CHAINS)) {
    const across = Object.values(K.CATALOG[chain]).filter((e) => e.protocol === "Across" && e.verified);
    assert.equal(across.length, 1, chain);
  }
});

test("isSwapRouter distingue routers de DEX de factories y bridges", () => {
  assert.equal(K.isSwapRouter(K.CATALOG.Base["0x2626664c2603336e57b271c5c0b26f421741e481"]), true);
  assert.equal(K.isSwapRouter(K.CATALOG.Base["0x33128a8fc17869897dce68ed026d694621f6fdfd"]), false);
  assert.equal(K.isSwapRouter(K.CATALOG.Base["0x09aea4b2242abc8bb4bb78d537a67a245a7bec64"]), false);
  assert.equal(K.isSwapRouter(undefined), false);
});

test("tokens: direcciones válidas y decimales coherentes", () => {
  for (const [asset, byChain] of Object.entries(K.TOKEN_GROUPS)) {
    for (const [chain, tokens] of Object.entries(byChain)) {
      assert.ok(K.CHAINS[chain], `${asset}: red ${chain}`);
      for (const [addr, decimals] of Object.entries(tokens)) {
        assert.match(addr, /^0x[0-9a-f]{40}$/);
        assert.equal(decimals, asset.endsWith("ETH") || asset === "WETH" ? 18 : 6);
      }
    }
  }
  for (const key of Object.keys(K.TOKEN_VARIANTS)) {
    const [chain, addr] = key.split(":");
    const found = Object.values(K.TOKEN_GROUPS).some((g) => g[chain] && g[chain][addr] !== undefined);
    assert.ok(found, `variante sin grupo: ${key}`);
  }
});

test("redes: cada red tiene id, explorador y moneda nativa", () => {
  const ids = new Set();
  for (const chain of Object.values(K.CHAINS)) {
    assert.ok(chain.chainId && !ids.has(chain.chainId));
    ids.add(chain.chainId);
    assert.match(chain.explorer, /^https:\/\//);
    assert.ok(chain.nativeSymbol && chain.alchemySlug && chain.averageBlockTime > 0);
  }
  for (const n of K.UNSUPPORTED_NETWORKS) assert.ok(!ids.has(n.chainId));
});
