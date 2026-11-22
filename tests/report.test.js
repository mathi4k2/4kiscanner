const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load.js");

const A = { flow: "exchange_withdrawal", provider: "Binance", symptom: "not_arrived", elapsed: "lt1h", asset: "USDC", amount: "100", src_network: "Ethereum", dst_network: "Polygon", dst_address: "0x" + "ab".repeat(20), third_party: "yes", provider_status: "completed_sent", viewing_network: "Polygon", tx_hash: null };
const evalA = () => K.evaluate(A, { errors: [], skipped: "no_key", nowSeconds: 1_800_000_000, addrClass: K.classifyAddress(A.dst_address) });

test("buildReport: incluye todas las secciones y marca el origen de cada dato", () => {
  const r = evalA();
  const text = K.buildReport(A, r, { now: new Date("2026-11-21T12:00:00Z"), links: [{ label: "Explorador", url: "https://polygonscan.com/tx/0x1" }] });
  for (const h of ["EVALUACIÓN DE OPERACIÓN CRIPTO", "Generado: 2026-11-21 12:00:00 UTC", "VEREDICTO", "QUÉ PASÓ", "LA OPERACIÓN DEL CLIENTE", "¿SE PUEDEN RECUPERAR", "ALERTAS", "COMPROBACIONES", "DATOS DE LA OPERACIÓN", "PRÓXIMOS PASOS", "LÍMITES DE ESTA EVALUACIÓN", "ENLACES"]) {
    assert.ok(text.includes(h), `falta ${h}`);
  }
  assert.match(text, /Requiere atención: Enviaste por Ethereum, pero el destino esperaba Polygon/);
  assert.match(text, /\(declarado por el cliente\)/);
  assert.match(text, /Confianza: baja/);
  assert.match(text, /1\. Revisa tu saldo en la red Ethereum\./);
  assert.match(text, /Posible patrón de estafa/);
  assert.match(text, /No es asesoría legal ni financiera/);
});

test("buildReport: el responsable solo se menciona en problemas y advertencias", () => {
  const r = evalA();
  const text = K.buildReport(A, r);
  assert.match(text, /\[Problema\] Enviaste por Ethereum.*de parte del cliente/);
  assert.ok(!/\[Sin datos\].*de parte del/.test(text));
});

test("etiquetas: cubren todos los valores y degradan con gracia", () => {
  for (const l of ["ok", "attention", "problem", "wait", "unknown"]) assert.ok(K.levelLabel(l));
  assert.equal(K.levelLabel("???"), "No determinado");
  assert.equal(K.ratingLabel(undefined), "Todavía no se puede determinar");
  assert.equal(K.recoverLabel("accessible"), "Probablemente accesibles");
  for (const code of K.EVALUATOR_VERDICTS) assert.ok(typeof code === "string");
});
