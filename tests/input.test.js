const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const HASH = "0x" + "ab".repeat(32);

test("classifyTxInput", () => {
  assert.equal(K.classifyTxInput("").kind, "empty");
  assert.deepEqual(K.classifyTxInput(`  ${HASH.toUpperCase().replace("0X", "0x")}  `), { kind: "evm_tx", hash: HASH });
  const url = K.classifyTxInput(`https://polygonscan.com/tx/${HASH}#eventlog`);
  assert.equal(url.kind, "explorer_url");
  assert.equal(url.chain, "Polygon");
  assert.equal(url.hash, HASH);
  assert.equal(K.classifyTxInput(`https://bscscan.com/tx/${HASH}`).chain, null);
  assert.equal(K.classifyTxInput("https://etherscan.io/address/0x1").kind, "url_without_hash");
  assert.equal(K.classifyTxInput("ab".repeat(32)).kind, "hash_without_prefix");
  assert.equal(K.classifyTxInput("0x" + "ab".repeat(20)).kind, "evm_address");
  assert.equal(K.classifyTxInput("0x" + "ab".repeat(31)).kind, "evm_wrong_length");
  assert.equal(K.classifyTxInput("5".repeat(88)).kind, "solana_signature");
  assert.equal(K.classifyTxInput("hola").kind, "unknown");
});

test("explainTxInput: mensajes accionables", () => {
  assert.equal(K.explainTxInput(K.classifyTxInput(HASH)), null);
  assert.match(K.explainTxInput(K.classifyTxInput("0x" + "ab".repeat(20))).title, /dirección de wallet/);
  assert.match(K.explainTxInput(K.classifyTxInput("0x" + "ab".repeat(31))).title, /62 caracteres/);
  assert.match(K.explainTxInput(K.classifyTxInput("5".repeat(88))).title, /Solana/);
});

const GOOD = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

test("classifyAddress: válidas", () => {
  assert.deepEqual(K.classifyAddress(GOOD), { kind: "evm", address: GOOD.toLowerCase() });
  assert.equal(K.classifyAddress(GOOD.toLowerCase()).kind, "evm");
  assert.equal(K.classifyAddress(GOOD.toUpperCase().replace("0X", "0x")).kind, "evm");
  assert.equal(K.classifyAddress("").kind, "empty");
  assert.equal(K.explainAddressInput(K.classifyAddress(GOOD)), null);
});

test("classifyAddress: errores típicos de usuario", () => {
  const bad = K.classifyAddress("0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.equal(bad.kind, "evm_bad_checksum");
  assert.equal(bad.checksum, GOOD);
  assert.equal(K.classifyAddress("0x" + "0".repeat(40)).kind, "evm_zero");
  assert.equal(K.classifyAddress(K.DEAD_ADDRESS).kind, "evm_burn");
  assert.equal(K.classifyAddress("ab".repeat(20)).kind, "evm_missing_prefix");
  assert.equal(K.classifyAddress("0x" + "ab".repeat(19)).kind, "evm_wrong_length");
  assert.equal(K.classifyAddress("0x" + "ab".repeat(19) + "zz").kind, "evm_invalid_chars");
  assert.equal(K.classifyAddress("vitalik.eth").kind, "name_service");
});

test("classifyAddress: otras cadenas", () => {
  assert.equal(K.classifyAddress("TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm").kind, "tron");
  assert.equal(K.classifyAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").kind, "bitcoin");
  assert.equal(K.classifyAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").kind, "bitcoin");
  assert.equal(K.classifyAddress("cosmos1" + "q".repeat(38)).kind, "cosmos");
  assert.equal(K.classifyAddress("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK").kind, "solana");
  const msg = K.explainAddressInput(K.classifyAddress("TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm"));
  assert.match(msg.title, /Tron/);
  assert.equal(msg.severity, "error");
});
