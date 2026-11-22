/* 4kiscan · rpc.js
 * Cliente de red: Alchemy JSON-RPC, precios históricos de DefiLlama y estado de
 * LI.FI. Todo pasa por createApi({apiKey, fetchFn}) para poder simularlo en tests.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const { RpcError, PriceError } = K;
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const t = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

  const DEFILLAMA_URL = "https://coins.llama.fi/prices/historical";
  const LIFI_STATUS_URL = "https://li.quest/v1/status";
  const AUTH_RE = /\b(401|403|unauthori[sz]ed|invalid api.?key|api key)\b/i;
  const NOT_FOUND_RE = /\b(404|not found|unknown chain|unsupported network)\b/i;

  function createApi(options) {
    const opts = options || {};
    const apiKey = String(opts.apiKey || "").trim();
    const fetchFn =
      opts.fetchFn ||
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    const timeoutMs = opts.timeoutMs == null ? 12000 : opts.timeoutMs;
    const retries = opts.retries == null ? 2 : opts.retries;
    const retryDelayMs = opts.retryDelayMs == null ? 500 : opts.retryDelayMs;
    const priceCache = new Map();
    let requestId = 1;

    const maskKey = (text) =>
      apiKey ? String(text).split(apiKey).join("[API Key]") : String(text);

    async function fetchWithTimeout(url, init, label) {
      if (!fetchFn) throw new RpcError(t("Este navegador no soporta fetch().", "This browser does not support fetch().", "Este navegador não oferece suporte a fetch()."), "network");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetchFn(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new RpcError(
            t(`${label} no respondió en ${timeoutMs / 1000} segundos. Inténtalo de nuevo más tarde.`, `${label} did not respond within ${timeoutMs / 1000} seconds. Try again later.`, `${label} não respondeu em ${timeoutMs / 1000} segundos. Tente novamente mais tarde.`),
            "timeout"
          );
        }
        throw new RpcError(
          t(`No se pudo conectar con ${label}. Revisa tu conexión (o si un bloqueador/extensión impide la petición).`, `Could not connect to ${label}. Check your connection (or whether an ad blocker/extension is blocking the request).`, `Não foi possível conectar-se a ${label}. Verifique sua conexão (ou se um bloqueador/extensão está impedindo a solicitação).`),
          "network"
        );
      } finally {
        clearTimeout(timer);
      }
    }

    // ───────────── JSON-RPC ─────────────
    async function call(chainName, method, params) {
      if (!apiKey) {
        throw new RpcError(t("Falta la API key de Alchemy. Ingrésala en «Configuración».", "The Alchemy API key is missing. Enter it in Settings.", "Falta a chave de API da Alchemy. Informe-a em Configurações."), "no_key");
      }
      if (/\s/.test(apiKey)) {
        throw new RpcError(t("La API key contiene espacios internos. Cópiala de nuevo desde Alchemy.", "The API key contains internal spaces. Copy it again from Alchemy.", "A chave de API contém espaços internos. Copie-a novamente da Alchemy."), "no_key");
      }
      const chain = K.CHAINS[chainName];
      if (!chain) throw new RpcError(t("La red seleccionada no está configurada.", "The selected network is not configured.", "A rede selecionada não está configurada."), "config");

      const url = `https://${chain.alchemySlug}.g.alchemy.com/v2/${encodeURIComponent(apiKey)}`;
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId++,
        method,
        params: params || [],
      });

      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetchWithTimeout(
            url,
            { method: "POST", headers: { "Content-Type": "application/json" }, body },
            "Alchemy"
          );
        } catch (error) {
          if (error.code === "network" && attempt < retries) {
            await K.sleep(retryDelayMs * 2 ** attempt);
            continue;
          }
          throw error;
        }
        if (response.status === 429 && attempt < retries) {
          await K.sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        break;
      }

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          throw new RpcError(
            t(`Error de autenticación con Alchemy (HTTP ${status}). Verifica que la API key sea válida, que la red esté habilitada y que el dominio esté permitido.`, `Alchemy authentication error (HTTP ${status}). Check that the API key is valid, the network is enabled and the domain is allowed.`, `Erro de autenticação da Alchemy (HTTP ${status}). Verifique se a chave de API é válida, se a rede está habilitada e se o domínio é permitido.`),
            "auth"
          );
        }
        if (status === 404) {
          throw new RpcError(
            t("Alchemy no encontró el endpoint solicitado (HTTP 404). Revisa la red y vuelve a copiar la API key.", "Alchemy could not find the requested endpoint (HTTP 404). Check the network and copy the API key again.", "A Alchemy não encontrou o endpoint solicitado (HTTP 404). Verifique a rede e copie novamente a chave de API."),
            "endpoint"
          );
        }
        if (status === 429) {
          throw new RpcError(
            t("Alchemy limitó la tasa de peticiones (HTTP 429). Espera unos segundos e inténtalo de nuevo.", "Alchemy rate-limited the requests (HTTP 429). Wait a few seconds and try again.", "A Alchemy limitou a taxa de solicitações (HTTP 429). Aguarde alguns segundos e tente novamente."),
            "rate_limited"
          );
        }
        throw new RpcError(t(`Alchemy respondió HTTP ${status}. Inténtalo de nuevo más tarde.`, `Alchemy returned HTTP ${status}. Try again later.`, `A Alchemy respondeu HTTP ${status}. Tente novamente mais tarde.`), "http");
      }

      let data;
      try {
        data = await response.json();
      } catch (error) {
        throw new RpcError(t("Alchemy devolvió una respuesta que no es JSON válido.", "Alchemy returned a response that is not valid JSON.", "A Alchemy retornou uma resposta que não é um JSON válido."), "invalid");
      }
      if (!data || typeof data !== "object") {
        throw new RpcError(t("Alchemy devolvió una respuesta inesperada.", "Alchemy returned an unexpected response.", "A Alchemy retornou uma resposta inesperada."), "invalid");
      }
      if (data.error) {
        const rpcError = data.error;
        const message = typeof rpcError === "object" ? String(rpcError.message || JSON.stringify(rpcError)) : String(rpcError);
        if (/execution reverted/i.test(message) || rpcError.code === 3) {
          throw new RpcError(maskKey(message).slice(0, 240), "revert", { data: rpcError.data });
        }
        if (AUTH_RE.test(message)) {
          throw new RpcError(
            t("Error de autenticación con Alchemy. Verifica que la API key sea válida y que la red esté habilitada.", "Alchemy authentication error. Check that the API key is valid and the network is enabled.", "Erro de autenticação da Alchemy. Verifique se a chave de API é válida e se a rede está habilitada."),
            "auth"
          );
        }
        if (NOT_FOUND_RE.test(message)) {
          throw new RpcError(
            t(`Alchemy no pudo completar ${method} en ${chainName}. Revisa que la red y el acceso de tu API key sean compatibles.`, `Alchemy could not complete ${method} on ${chainName}. Check that the network and your API key access are compatible.`, `A Alchemy não conseguiu concluir ${method} em ${chainName}. Verifique se a rede e o acesso da sua chave de API são compatíveis.`),
            "endpoint"
          );
        }
        throw new RpcError(t(`Error JSON-RPC de Alchemy: ${maskKey(message).slice(0, 240)}`, `Alchemy JSON-RPC error: ${maskKey(message).slice(0, 240)}`, `Erro JSON-RPC da Alchemy: ${maskKey(message).slice(0, 240)}`), "rpc");
      }
      if (!("result" in data)) {
        throw new RpcError(t("La respuesta de Alchemy no contiene el campo result.", "Alchemy's response does not contain the result field.", "A resposta da Alchemy não contém o campo result."), "invalid");
      }
      return data.result;
    }

    // ───────────── Transacciones ─────────────
    async function getTransaction(chain, hash) {
      const tx = await call(chain, "eth_getTransactionByHash", [hash]);
      if (tx !== null && (typeof tx !== "object" || Array.isArray(tx))) {
        throw new RpcError(t("Alchemy devolvió datos de transacción inválidos.", "Alchemy returned invalid transaction data.", "A Alchemy retornou dados de transação inválidos."), "invalid");
      }
      return tx;
    }
    async function getReceipt(chain, hash) {
      const receipt = await call(chain, "eth_getTransactionReceipt", [hash]);
      if (receipt !== null && (typeof receipt !== "object" || Array.isArray(receipt))) {
        throw new RpcError(t("Alchemy devolvió un recibo inválido.", "Alchemy returned an invalid receipt.", "A Alchemy retornou um recibo inválido."), "invalid");
      }
      return receipt;
    }
    async function getTxAndReceipt(chain, hash) {
      const transaction = await getTransaction(chain, hash);
      if (transaction === null) {
        throw new RpcError(
          t(`No se encontró la transacción en ${chain}. Verifica el hash y la red; si es muy reciente, espera un momento.`, `The transaction was not found on ${chain}. Check the hash and network; if it is very recent, wait a moment.`, `A transação não foi encontrada em ${chain}. Verifique o hash e a rede; se for muito recente, aguarde um pouco.`),
          "tx_not_found"
        );
      }
      const receipt = await getReceipt(chain, hash);
      return { transaction, receipt };
    }

    /** Consulta el hash en todas las redes en paralelo. */
    async function detectNetwork(hash) {
      const names = Object.keys(K.CHAINS);
      const settled = await Promise.allSettled(names.map((name) => getTransaction(name, hash)));
      const networks = [];
      const errors = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") {
          const tx = outcome.value;
          if (tx && String(tx.hash || "").toLowerCase() === hash.toLowerCase()) {
            networks.push(names[index]);
          }
        } else {
          errors.push({ chain: names[index], message: outcome.reason.message, code: outcome.reason.code });
        }
      });
      if (networks.length === 1) return { state: "detected", networks, errors };
      if (networks.length > 1) return { state: "ambiguous", networks, errors };
      if (errors.length) return { state: "incomplete", networks: [], errors };
      return { state: "not_found", networks: [], errors: [] };
    }

    // ───────────── Bloques y estado ─────────────
    async function getBlock(chain, tag) {
      const block = await call(chain, "eth_getBlockByNumber", [tag, false]);
      if (!block || typeof block !== "object") {
        throw new RpcError(t(`Alchemy no devolvió el bloque ${tag} en ${chain}.`, `Alchemy did not return block ${tag} on ${chain}.`, `A Alchemy não retornou o bloco ${tag} em ${chain}.`), "invalid");
      }
      return block;
    }
    async function latestBlock(chain) {
      const block = await getBlock(chain, "latest");
      return {
        number: K.hexToInt(block.number, "number"),
        timestamp: K.hexToInt(block.timestamp, "timestamp"),
      };
    }
    async function blockTimestamp(chain, blockNumber) {
      const n = typeof blockNumber === "number" ? blockNumber : K.hexToInt(blockNumber, "blockNumber");
      const block = await getBlock(chain, "0x" + n.toString(16));
      return K.hexToInt(block.timestamp, "timestamp");
    }
    async function getCode(chain, address) {
      const code = await call(chain, "eth_getCode", [address, "latest"]);
      return typeof code === "string" ? code : "0x";
    }
    async function getNonce(chain, address) {
      const nonce = await call(chain, "eth_getTransactionCount", [address, "latest"]);
      return K.hexToInt(nonce, "nonce");
    }
    async function ethCall(chain, tx, blockTag) {
      return call(chain, "eth_call", [tx, blockTag || "latest"]);
    }

    // ───────────── Tokens ─────────────
    async function tokenDecimals(chain, token) {
      try {
        const decimals = K.hexToInt(await ethCall(chain, { to: token, data: "0x313ce567" }), "decimals");
        return decimals >= 0 && decimals <= 255 ? decimals : null;
      } catch (error) {
        return null;
      }
    }
    async function tokenText(chain, token, selector) {
      try {
        return K.decodeAbiText(await ethCall(chain, { to: token, data: selector }));
      } catch (error) {
        return null;
      }
    }
    async function tokenLabels(chain, token) {
      const [symbol, name] = await Promise.all([
        tokenText(chain, token, "0x95d89b41"),
        tokenText(chain, token, "0x06fdde03"),
      ]);
      return { symbol, name };
    }
    async function assetTransfers(chain, filter) {
      const response = await call(chain, "alchemy_getAssetTransfers", [filter]);
      if (!response || typeof response !== "object") {
        throw new RpcError(t(`Alchemy devolvió una respuesta inválida al buscar transferencias en ${chain}.`, `Alchemy returned an invalid response while searching for transfers on ${chain}.`, `A Alchemy retornou uma resposta inválida ao buscar transferências em ${chain}.`), "invalid");
      }
      if (!Array.isArray(response.transfers || [])) {
        throw new RpcError(t("Alchemy devolvió una lista de transferencias inválida.", "Alchemy returned an invalid transfer list.", "A Alchemy retornou uma lista de transferências inválida."), "invalid");
      }
      return response;
    }

    // ───────────── Servicios externos (best-effort) ─────────────
    /** Precio USD histórico (DefiLlama); null si no hay dato. Lanza PriceError ante fallos. */
    async function historicalPrice(timestamp, coinId) {
      const key = `${timestamp}|${coinId}`;
      if (priceCache.has(key)) return priceCache.get(key);
      const url = `${DEFILLAMA_URL}/${timestamp}/${encodeURIComponent(coinId).replace(/%3A/gi, ":")}`;
      let response;
      try {
        response = await fetchWithTimeout(url, { method: "GET" }, "DefiLlama");
      } catch (error) {
        throw new PriceError(error.message);
      }
      if (!response.ok) {
        throw new PriceError(t(`DefiLlama respondió HTTP ${response.status} al buscar un precio histórico.`, `DefiLlama returned HTTP ${response.status} while looking up a historical price.`, `A DefiLlama respondeu HTTP ${response.status} ao buscar um preço histórico.`));
      }
      let data;
      try {
        data = await response.json();
      } catch (error) {
        throw new PriceError(t("DefiLlama devolvió una respuesta que no es JSON válido.", "DefiLlama returned a response that is not valid JSON.", "A DefiLlama retornou uma resposta que não é um JSON válido."));
      }
      const entry = data && data.coins ? data.coins[coinId] : null;
      const price = entry && typeof entry.price === "number" ? entry.price : null;
      const result = price !== null && Number.isFinite(price) && price > 0 ? price : null;
      priceCache.set(key, result);
      return result;
    }

    /** Estado de la operación según LI.FI (cubre sus bridges subyacentes). null si no aplica. */
    async function lifiStatus(txHash, fromChainName) {
      const params = new URLSearchParams({ txHash });
      if (fromChainName && K.CHAINS[fromChainName]) params.set("fromChain", String(K.CHAINS[fromChainName].chainId));
      let response;
      try {
        response = await fetchWithTimeout(`${LIFI_STATUS_URL}?${params}`, { method: "GET" }, "LI.FI");
      } catch (error) {
        return { available: false, reason: error.message };
      }
      if (response.status === 404 || response.status === 400) return { available: false, reason: "not_lifi" };
      if (!response.ok) return { available: false, reason: `HTTP ${response.status}` };
      let data;
      try {
        data = await response.json();
      } catch (error) {
        return { available: false, reason: "invalid_json" };
      }
      if (!data || typeof data !== "object" || !data.status) return { available: false, reason: "invalid" };
      const receiving = data.receiving && typeof data.receiving === "object" ? data.receiving : {};
      return {
        available: true,
        status: String(data.status),
        substatus: data.substatus ? String(data.substatus) : null,
        tool: data.tool ? String(data.tool) : data.bridge ? String(data.bridge) : null,
        receivingTxHash: K.TX_HASH_RE.test(String(receiving.txHash || "")) ? String(receiving.txHash).toLowerCase() : null,
        receivingChainId: Number.isInteger(receiving.chainId) ? receiving.chainId : null,
      };
    }

    return {
      hasKey: !!apiKey,
      call,
      getTransaction,
      getReceipt,
      getTxAndReceipt,
      detectNetwork,
      latestBlock,
      blockTimestamp,
      getCode,
      getNonce,
      ethCall,
      tokenDecimals,
      tokenText,
      tokenLabels,
      assetTransfers,
      historicalPrice,
      lifiStatus,
    };
  }

  K.createApi = createApi;
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
