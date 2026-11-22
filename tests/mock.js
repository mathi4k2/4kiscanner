// fetch simulado: handler(url, body, init) -> {status?, json?} | Promise
function makeFetch(handler, log) {
  return async function fakeFetch(url, init = {}) {
    const body = init.body ? JSON.parse(init.body) : null;
    if (log) log.push({ url: String(url), body });
    if (init.signal && init.signal.aborted) {
      const e = new Error("aborted"); e.name = "AbortError"; throw e;
    }
    const outcome = await new Promise((resolve, reject) => {
      if (init.signal) init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
      Promise.resolve(handler(String(url), body, init)).then(resolve, reject);
    });
    const status = outcome.status || 200;
    return { status, ok: status >= 200 && status < 300, json: async () => {
      if (outcome.invalidJson) throw new SyntaxError("bad json");
      return outcome.json;
    } };
  };
}
const rpcOk = (result) => ({ json: { jsonrpc: "2.0", id: 1, result } });
const rpcErr = (message, code = -32000, data) => ({ json: { jsonrpc: "2.0", id: 1, error: { code, message, data } } });
module.exports = { makeFetch, rpcOk, rpcErr };
