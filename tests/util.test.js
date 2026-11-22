const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

test("keccak256: vectores conocidos", () => {
  assert.equal(K.keccak256(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(K.keccak256("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // más de un bloque de 136 bytes
  assert.equal(K.keccak256("a".repeat(200)).length, 64);
  assert.equal(K.keccak256("transfer(address,uint256)").slice(0, 8), "a9059cbb");
});

test("EIP-55: vectores oficiales", () => {
  for (const a of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ]) {
    assert.equal(K.toChecksumAddress(a.toLowerCase()), a);
    assert.equal(K.isValidChecksum(a), true);
  }
  // un solo carácter cambiado de mayúscula a minúscula invalida el checksum
  assert.equal(K.isValidChecksum("0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), false);
});

test("formatUnits / hex", () => {
  assert.equal(K.formatUnits(1234567n, 6), "1.234567");
  assert.equal(K.formatUnits(1000000n, 6), "1");
  assert.equal(K.formatUnits(5n, 6), "0.000005");
  assert.equal(K.formatUnits(10n ** 18n, 18), "1");
  assert.equal(K.formatUnits(7n, null), "7 unidades base");
  assert.equal(K.hexToInt("0x10", "x"), 16);
  assert.throws(() => K.hexToBigInt("0xzz", "campo"), /campo/);
  assert.throws(() => K.hexToBigInt("0x", "campo"));
  assert.throws(() => K.hexToBigInt(5, "campo"));
});

test("formatUtc", () => {
  assert.equal(K.formatUtc(0), "1970-01-01 00:00:00 UTC");
  assert.equal(K.formatUtc(1700000000), "2023-11-14 22:13:20 UTC");
});

test("decodeAbiText: string dinámico y bytes32", () => {
  const dyn = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("USDC").toString("hex").padEnd(64, "0");
  assert.equal(K.decodeAbiText(dyn), "USDC");
  const b32 = "0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0");
  assert.equal(K.decodeAbiText(b32), "MKR");
  assert.equal(K.decodeAbiText("0x"), null);
  assert.equal(K.decodeAbiText("0x" + "00".repeat(32)), null);
  assert.equal(K.decodeAbiText(null), null);
});

test("decodeRevertData", () => {
  const msg = Buffer.from("ERC20: transfer amount exceeds balance");
  const data = "0x08c379a0" + "20".padStart(64, "0") + msg.length.toString(16).padStart(64, "0") + msg.toString("hex").padEnd(Math.ceil(msg.length / 32) * 64, "0");
  assert.deepEqual(K.decodeRevertData(data), { kind: "error", message: "ERC20: transfer amount exceeds balance" });
  const panic = K.decodeRevertData("0x4e487b71" + "11".padStart(64, "0"));
  assert.equal(panic.kind, "panic");
  assert.match(panic.message, /desbordamiento/);
  assert.deepEqual(K.decodeRevertData("0xdeadbeef"), { kind: "custom", selector: "0xdeadbeef" });
  assert.equal(K.decodeRevertData("0x"), null);
});

test("addressesInHexPayload: extrae direcciones y descarta números", () => {
  const addr = "ab".repeat(20);
  const word = (hex) => hex.padStart(64, "0");
  const payload = "0x" + word(addr) + word("64") + word("f4240") + word(addr.replace(/ab/g, "cd"));
  const found = K.addressesInHexPayload(payload);
  assert.deepEqual(found, ["0x" + addr, "0x" + "cd".repeat(20)]);
  // selector de 4 bytes delante (calldata): alineación +8
  const calldata = "0xa9059cbb" + word(addr) + word("64");
  assert.deepEqual(K.addressesInHexPayload(calldata), ["0x" + addr]);
  assert.deepEqual(K.addressesInHexPayload("0x"), []);
  assert.deepEqual(K.addressesInHexPayload("0xzz"), []);
  assert.deepEqual(K.addressesInHexPayload(undefined), []);
});

test("addressFromTopic y similitud", () => {
  const topic = "0x" + "0".repeat(24) + "ab".repeat(20);
  assert.equal(K.addressFromTopic(topic), "0x" + "ab".repeat(20));
  assert.equal(K.addressFromTopic("0x" + "1".repeat(64)), null);
  const a = "0x1234" + "a".repeat(32) + "5678";
  const b = "0x1234" + "b".repeat(32) + "5678";
  const sim = K.addressSimilarity(a, b);
  assert.equal(sim.sameEnds, true);
  assert.equal(sim.differing, 32);
  assert.equal(K.addressSimilarity(a, a).identical, true);
});

test("mapLimit respeta orden y concurrencia", async () => {
  let active = 0, peak = 0;
  const out = await K.mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++; peak = Math.max(peak, active);
    await K.sleep(5); active--; return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2);
});
