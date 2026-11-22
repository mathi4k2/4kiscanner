// Carga los scripts clásicos del navegador en orden y devuelve el espacio Kiscan.
const path = require("path");
const ORDER = ["util", "data", "input", "rpc", "concepts", "providers", "diagnose", "radar", "interview", "evidence", "evaluate", "report"];
for (const name of ORDER) {
  try {
    require(path.join(__dirname, "..", "js", `${name}.js`));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND" || !String(error.message).includes(`${name}.js`)) throw error;
  }
}
module.exports = globalThis.Kiscan;
