/* 4kiscan · diagnose.js
 * Diagnóstico de la transacción de ORIGEN: estado, activos movidos, puentes/DEX
 * detectados y un detector de errores comunes de usuario (red equivocada, envío
 * al contrato del token, address poisoning, wallet de contrato inexistente en la
 * red destino, solo approve, etc.). Depende de util.js y data.js.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const { RpcError } = K;
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const TEXT_TRANSLATIONS = new Map();
  const t = (es, en, pt) => {
    TEXT_TRANSLATIONS.set(es, { en, pt });
    return locale() === "en" ? en : locale() === "pt" ? pt : es;
  };
  function localizeDiagnosisText(value) {
    if (typeof value !== "string" || locale() === "es") return value;
    const translations = TEXT_TRANSLATIONS.get(value);
    return translations ? translations[locale()] : value;
  }
  const ISSUE_TITLES = {
    origin_replaced: ["The transaction was replaced or dropped", "A transação foi substituída ou descartada"],
    origin_pending: ["The transaction is still pending", "A transação ainda está pendente"],
    origin_failed: ["The transaction failed on ${chain}", "A transação falhou em ${chain}"],
    burn_target: ["The transaction was sent to a burn address", "A transação foi enviada para um endereço de queima"],
    approval_only: ["This transaction only granted permission (approve); it did not move funds", "Esta transação apenas concedeu uma permissão (approve); não transferiu fundos"],
    burn_recipient: ["Funds were sent to a burn address", "Os fundos foram enviados para um endereço de queima"],
    wrong_network_delivery: ["Funds reached your wallet on ${chain}, not ${destChain}", "Os fundos chegaram à sua carteira em ${chain}, não em ${destChain}"],
    direct_credit: ["Direct transfer to the expected destination", "Transferência direta para o destino esperado"],
    address_poisoning: ["The recipient looks like your wallet but is NOT the same address", "O destinatário parece sua carteira, mas NÃO é o mesmo endereço"],
    address_typo: ["The recipient is almost identical to your wallet (possible typing error)", "O destinatário é quase igual à sua carteira (possível erro de digitação)"],
    recipient_mismatch: ["The transfer recipient is not the expected wallet", "O destinatário da transferência não é a carteira esperada"],
    sent_to_token_contract: ["Tokens were sent to a token contract address", "Os tokens foram enviados para o endereço de um contrato de token"],
    recipient_is_contract: ["The recipient is a smart contract, not a regular wallet", "O destinatário é um contrato inteligente, não uma carteira comum"],
    sender_is_wallet: ["The sender is the same as the destination wallet", "O remetente é a própria carteira de destino"],
    wallet_encoded: ["The expected wallet appears encoded in the transaction", "A carteira esperada aparece codificada na transação"],
    wallet_not_referenced: ["The expected wallet does not appear in the source transaction", "A carteira esperada não aparece na transação de origem"],
    contract_wallet_missing_on_destination: ["The wallet is a contract on ${chain} but does not exist on ${destChain}", "A carteira é um contrato em ${chain}, mas não existe em ${destChain}"],
    destination_is_contract: ["The wallet is a smart contract on ${destChain}", "A carteira é um contrato inteligente em ${destChain}"],
    dex_not_bridge: ["This was a swap on ${chain}, not a transfer between networks", "Isto foi um swap em ${chain}, não uma transferência entre redes"],
    dex_swap: ["The transaction is a DEX swap", "A transação é um swap em uma DEX"],
    l2_withdrawal_delay: ["Withdrawing from an L2 network to Ethereum is not immediate", "Sacar de uma rede L2 para Ethereum não é imediato"],
    unverified_catalog_match: ["The bridge match comes from an unverified entry", "A correspondência de ponte vem de uma entrada não verificada"],
    unknown_token: ["Unrecognized token: ${address}", "Token não reconhecido: ${address}"],
    token_variant: ["Token variant: ${variant}", "Variante de token: ${variant}"],
    nft_transfer: ["The transaction transferred an NFT (ERC-721)", "A transação transferiu um NFT (ERC-721)"],
    no_assets_moved: ["The transaction was confirmed but moved no visible value", "A transação foi confirmada, mas não transferiu valor visível"],
  };
  function localizedTitle(id, title) {
    const pair = ISSUE_TITLES[id];
    if (pair && !pair.some((value) => value.includes("${"))) {
      TEXT_TRANSLATIONS.set(title, { en: pair[0], pt: pair[1] });
    } else if (id === "wrong_network_delivery") {
      const match = title.match(/^Los fondos llegaron a tu wallet en (.+), no en (.+)$/);
      if (match) TEXT_TRANSLATIONS.set(title, {
        en: `Funds reached your wallet on ${match[1]}, not on ${match[2]}`,
        pt: `Os fundos chegaram à sua carteira em ${match[1]}, não em ${match[2]}`,
      });
    } else if (id === "origin_failed") {
      const chain = title.slice("La transacción falló en ".length);
      TEXT_TRANSLATIONS.set(title, { en: `The transaction failed on ${chain}`, pt: `A transação falhou em ${chain}` });
    } else if (id === "unknown_token") {
      const address = title.slice("Token no reconocido:".length);
      TEXT_TRANSLATIONS.set(title, { en: `Unrecognized token:${address}`, pt: `Token não reconhecido:${address}` });
    } else if (id === "token_variant") {
      const variant = title.slice("Variante de token:".length);
      TEXT_TRANSLATIONS.set(title, { en: `Token variant:${variant}`, pt: `Variante de token:${variant}` });
    } else if (id === "contract_wallet_missing_on_destination") {
      const match = title.match(/^La wallet es un contrato en (.+) pero no existe en (.+)$/);
      if (match) TEXT_TRANSLATIONS.set(title, {
        en: `The wallet is a contract on ${match[1]} but does not exist on ${match[2]}`,
        pt: `A carteira é um contrato em ${match[1]} mas não existe em ${match[2]}`,
      });
    } else if (id === "destination_is_contract") {
      const match = title.match(/^La wallet es un contrato inteligente en (.+)$/);
      if (match) TEXT_TRANSLATIONS.set(title, {
        en: `The wallet is a smart contract on ${match[1]}`,
        pt: `A carteira é um contrato inteligente em ${match[1]}`,
      });
    } else if (id === "dex_not_bridge") {
      const match = title.match(/^Esto fue un swap en (.+), no un envío entre redes$/);
      if (match) TEXT_TRANSLATIONS.set(title, {
        en: `This was a swap on ${match[1]}, not a transfer between networks`,
        pt: `Isto foi um swap em ${match[1]}, não uma transferência entre redes`,
      });
    }
    if (!pair || locale() === "es") return title;
    if (id === "wrong_network_delivery") {
      return locale() === "en"
        ? title.replace("Los fondos llegaron a tu wallet en ", "Funds reached your wallet on ").replace(", no en ", ", not on ")
        : title.replace("Los fondos llegaron a tu wallet en ", "Os fundos chegaram à sua carteira em ").replace(", no en ", ", não em ");
    }
    if (id === "contract_wallet_missing_on_destination") {
      return locale() === "en"
        ? title.replace("La wallet es un contrato en ", "The wallet is a contract on ").replace(" pero no existe en ", " but does not exist on ")
        : title.replace("La wallet es un contrato en ", "A carteira é um contrato em ").replace(" pero no existe en ", " mas não existe em ");
    }
    if (id === "destination_is_contract") {
      return locale() === "en"
        ? title.replace("La wallet es un contrato inteligente en ", "The wallet is a smart contract on ")
        : title.replace("La wallet es un contrato inteligente en ", "A carteira é um contrato inteligente em ");
    }
    if (id === "unknown_token") {
      return locale() === "en" ? title.replace("Token no reconocido:", "Unrecognized token:") : title.replace("Token no reconocido:", "Token não reconhecido:");
    }
    if (id === "token_variant") {
      return locale() === "en" ? title.replace("Variante de token:", "Token variant:") : title.replace("Variante de token:", "Variante de token:");
    }
    if (id === "origin_failed") {
      const chain = title.slice("La transacción falló en ".length);
      return locale() === "en" ? `The transaction failed on ${chain}` : `A transação falhou em ${chain}`;
    }
    const result = locale() === "en" ? pair[0] : pair[1];
    return result.includes("${") ? title : result;
  }

  const SEVERITY_RANK = { critical: 0, error: 1, warn: 2, info: 3, ok: 4 };
  const lower = (v) => String(v == null ? "" : v).toLowerCase();

  // ───────────── Tokens ─────────────
  function tokenIdentity(chain, tokenAddress, nativeSymbol) {
    if (tokenAddress == null) {
      const symbol = String(nativeSymbol).toUpperCase();
      return { assetId: `native:${symbol}`, symbol, decimals: 18, variant: null, known: true };
    }
    const address = lower(tokenAddress);
    for (const [assetId, deployments] of Object.entries(K.TOKEN_GROUPS)) {
      const tokens = deployments[chain] || {};
      if (Object.prototype.hasOwnProperty.call(tokens, address)) {
        return {
          assetId,
          symbol: assetId,
          decimals: tokens[address],
          variant: K.TOKEN_VARIANTS[`${chain}:${address}`] || null,
          known: true,
        };
      }
    }
    return { assetId: address, symbol: address, decimals: null, variant: null, known: false };
  }

  function isKnownTokenAddress(address) {
    const a = lower(address);
    return Object.values(K.TOKEN_GROUPS).some((byChain) =>
      Object.values(byChain).some((tokens) => Object.prototype.hasOwnProperty.call(tokens, a))
    );
  }

  // ───────────── Logs ─────────────
  function analyzeTransferLogs(logs, wallet) {
    const transfers = [];
    const matching = [];
    const expected = wallet ? lower(wallet) : null;
    for (const log of logs) {
      if (!log || typeof log !== "object") continue;
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (topics.length < 3 || lower(topics[0]) !== K.TRANSFER_TOPIC) continue;
      const from = K.addressFromTopic(topics[1]);
      const to = K.addressFromTopic(topics[2]);
      const isNft = topics.length >= 4; // ERC-721: tokenId indexado
      let amountRaw = null;
      if (!isNft) {
        try {
          amountRaw = K.hexToBigInt(typeof log.data === "string" ? log.data : "0x0", "data");
        } catch (error) {
          amountRaw = null;
        }
      }
      const transfer = {
        tokenContract: lower(log.address),
        from,
        to,
        amountRaw,
        isNft,
        tokenId: isNft ? topics[3] : null,
        transactionHash: log.transactionHash || null,
      };
      transfers.push(transfer);
      if (!isNft && from !== null && expected && to === expected && amountRaw !== null && amountRaw > 0n) {
        matching.push(transfer);
      }
    }
    return { transfers, matching };
  }

  // ───────────── Puentes / DEX ─────────────
  function identifyBridges(chain, transactionTo, logs, transactionInput) {
    const catalog = K.CATALOG[chain] || {};
    const evidence = new Map();
    const add = (address, source) => {
      const a = lower(address);
      if (!Object.prototype.hasOwnProperty.call(catalog, a)) return;
      if (!evidence.has(a)) evidence.set(a, []);
      if (!evidence.get(a).includes(source)) evidence.get(a).push(source);
    };
    if (transactionTo) add(transactionTo, "tx.to");
    for (const address of K.addressesInHexPayload(transactionInput)) add(address, "tx.input");
    for (const log of logs) {
      if (!log || typeof log !== "object") continue;
      const emitter = lower(log.address);
      if (K.ADDRESS_RE.test(emitter)) add(emitter, "log.address");
      if (Array.isArray(log.topics)) {
        for (const topic of log.topics) for (const a of K.addressesInHexPayload(topic)) add(a, "log.topic");
      }
      for (const a of K.addressesInHexPayload(log.data)) add(a, "log.data");
    }
    return [...evidence.entries()].map(([address, sources]) => ({
      ...catalog[address],
      address,
      evidence: sources,
    }));
  }

  // ───────────── Llamada de la transacción ─────────────
  const KNOWN_SELECTORS = {
    "0xa9059cbb": "transfer(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0xd0e30db0": "deposit()",
    "0x2e1a7d4d": "withdraw(uint256)",
  };
  function describeCall(tx) {
    if (!tx.to) return { kind: "deploy", selector: null, name: t("Creación de contrato", "Contract creation", "Criação de contrato") };
    const input = lower(typeof tx.input === "string" ? tx.input : "0x");
    if (input === "0x" || input === "") return { kind: "native", selector: null, name: t("Transferencia nativa", "Native transfer", "Transferência nativa") };
    const selector = input.slice(0, 10);
    const name = KNOWN_SELECTORS[selector] || null;
    const word = (i) => (input.length >= 10 + 64 * (i + 1) ? input.slice(10 + 64 * i, 10 + 64 * (i + 1)) : null);
    const address = (i) => {
      const w = word(i);
      return w && /^0{24}[0-9a-f]{40}$/.test(w) ? "0x" + w.slice(24) : null;
    };
    const amount = (i) => {
      const w = word(i);
      return w ? BigInt("0x" + w) : null;
    };
    if (selector === "0xa9059cbb") return { kind: "erc20_transfer", selector, name, recipient: address(0), amountRaw: amount(1) };
    if (selector === "0x23b872dd") {
      return { kind: "erc20_transfer_from", selector, name, sender: address(0), recipient: address(1), amountRaw: amount(2) };
    }
    if (selector === "0x095ea7b3") return { kind: "approve", selector, name, spender: address(0), amountRaw: amount(1) };
    return { kind: "contract_call", selector, name };
  }

  // ───────────── Activos de origen ─────────────
  async function extractOriginAssets(api, chain, tx, logs, bridgeMatches) {
    const assets = [];
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const nativeValue = K.hexToBigInt(tx.value || "0x0", "value");
    if (nativeValue > 0n) {
      const id = tokenIdentity(chain, null, nativeSymbol);
      assets.push({
        assetId: id.assetId,
        symbol: id.symbol,
        name: null,
        tokenAddress: null,
        amountRaw: nativeValue,
        decimals: 18,
        amount: K.formatUnits(nativeValue, 18),
        known: true,
        variant: null,
        evidence: "transaction.value",
      });
    }

    const { transfers } = analyzeTransferLogs(logs, null);
    const from = lower(tx.from);
    const to = lower(tx.to);
    const bridgeAddresses = new Set(bridgeMatches.map((m) => m.address));
    const usable = transfers.filter((t) => !t.isNft && t.amountRaw !== null && t.amountRaw > 0n && K.ADDRESS_RE.test(t.tokenContract));
    let relevant = usable.filter((t) => t.from === from || (to && t.to === to) || bridgeAddresses.has(t.to));
    if (!relevant.length) relevant = usable;

    // Metadatos (decimales / símbolo) una sola vez por token
    const metadata = new Map();
    await Promise.all(
      [...new Set(relevant.map((t) => t.tokenContract))].map(async (token) => {
        const id = tokenIdentity(chain, token, nativeSymbol);
        let decimals = id.decimals;
        let symbol = id.symbol;
        let name = null;
        if (decimals === null) decimals = await api.tokenDecimals(chain, token);
        if (!id.known) {
          const labels = await api.tokenLabels(chain, token);
          if (labels.symbol) symbol = labels.symbol;
          name = labels.name;
        }
        metadata.set(token, { id, decimals, symbol, name });
      })
    );

    const seen = new Set();
    for (const t of relevant) {
      const key = `${t.tokenContract}|${t.amountRaw}|${t.from}|${t.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = metadata.get(t.tokenContract);
      assets.push({
        assetId: meta.id.assetId,
        symbol: meta.symbol,
        name: meta.name,
        tokenAddress: t.tokenContract,
        amountRaw: t.amountRaw,
        decimals: meta.decimals,
        amount: K.formatUnits(t.amountRaw, meta.decimals),
        known: meta.id.known,
        variant: meta.id.variant,
        from: t.from,
        to: t.to,
        evidence: "evento Transfer del recibo",
      });
    }
    return assets;
  }

  // ───────────── Detector de problemas ─────────────
  async function safe(promise) {
    try {
      return await promise;
    } catch (error) {
      return null;
    }
  }
  const hasCode = (code) => typeof code === "string" && code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code); // EIP-7702 = cuenta normal
  const isDelegated = (code) => typeof code === "string" && /^0xef0100[0-9a-f]{40}$/i.test(code);

  /** Intenta reproducir la transacción fallida un bloque antes para obtener el motivo. */
  async function replayRevertReason(api, chain, tx, blockNumber) {
    if (!tx.to || blockNumber == null || blockNumber < 1) return null;
    const call = { from: tx.from, to: tx.to, data: tx.input || "0x" };
    if (tx.value && tx.value !== "0x0") call.value = tx.value;
    try {
      await api.ethCall(chain, call, "0x" + (blockNumber - 1).toString(16));
      return null; // el estado cambió; no se reproduce el fallo
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== "revert") return null;
      const decoded = K.decodeRevertData(error.data);
      if (decoded && decoded.kind === "error" && decoded.message) return decoded.message;
      if (decoded && decoded.kind === "panic") return `${t("pánico", "panic", "pânico")}: ${decoded.message}`;
      if (decoded && decoded.kind === "custom") return t(`error personalizado del contrato (${decoded.selector})`, `custom contract error (${decoded.selector})`, `erro personalizado do contrato (${decoded.selector})`);
      const m = String(error.message).match(/execution reverted:?\s*(.*)$/i);
      return m && m[1] ? m[1] : null;
    }
  }

  async function findIssues(api, c) {
    const issues = [];
    const add = (severity, id, title, detail, action) =>
      issues.push({ id, severity, title: localizedTitle(id, title), detail, action: action || null });
    const { chain, destChain, wallet, tx, to, from, call, status, logs, transfers, assets, bridgeMatches } = c;
    const crossChain = destChain !== chain;
    const catalogTarget = to ? K.CATALOG[chain][to] || null : null;
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const hasWallet = K.ADDRESS_RE.test(wallet); // sin wallet esperada no se puede comparar el receptor

    // 1) Estado de la transacción
    if (status === "pending") {
      const txNonce = K.hexToInt(tx.nonce || "0x0", "nonce");
      const currentNonce = await safe(api.getNonce(chain, from));
      if (currentNonce !== null && currentNonce > txNonce) {
        add(
          "error",
          "origin_replaced",
          "La transacción fue reemplazada o descartada",
          t(`La cuenta ${K.shortAddress(from)} ya usó el nonce ${txNonce} en otra transacción, así que esta nunca se confirmará. Por esta transacción no salió ningún fondo.`, `Account ${K.shortAddress(from)} already used nonce ${txNonce} in another transaction, so this one will never be confirmed. No funds were sent by this transaction.`, `A conta ${K.shortAddress(from)} já usou o nonce ${txNonce} em outra transação, então esta nunca será confirmada. Nenhum fundo foi enviado por esta transação.`),
          t("Busca en el explorador la transacción con ese nonce (puede ser una cancelación o una aceleración con otro hash).", "Look up the transaction with that nonce in the block explorer; it may be a cancellation or a speed-up with a different hash.", "Procure no explorador a transação com esse nonce; pode ser um cancelamento ou uma aceleração com outro hash.")
        );
      } else {
        add(
          "warn",
          "origin_pending",
          "La transacción sigue pendiente",
          t("Todavía no está incluida en un bloque. Suele deberse a un gas demasiado bajo o a congestión de la red.", "It has not been included in a block yet. This is often caused by a gas fee that is too low or network congestion.", "Ela ainda não foi incluída em um bloco. Isso costuma ocorrer quando o gas está baixo ou a rede está congestionada."),
          t("Espera unos minutos; si no avanza, acelérala o cancélala desde la wallet usando el mismo nonce.", "Wait a few minutes. If it does not progress, speed it up or cancel it from your wallet using the same nonce.", "Aguarde alguns minutos; se não avançar, acelere ou cancele pela carteira usando o mesmo nonce.")
        );
      }
      return finish(issues);
    }

    if (status === "0x0") {
      const gasUsed = K.hexToBigInt(c.receipt.gasUsed || "0x0", "gasUsed");
      const gasLimit = K.hexToBigInt(tx.gas || "0x0", "gas");
      const outOfGas = gasLimit > 0n && gasUsed === gasLimit;
      const reason = outOfGas ? null : await replayRevertReason(api, chain, tx, c.blockNumber);
      const fee = c.feePaid
        ? t(` El gas ya consumido (≈ ${c.feePaid}) no se reembolsa, pero los fondos principales no se movieron.`, ` The gas already spent (≈ ${c.feePaid}) is not refunded, but the principal funds did not move.`, ` O gas já gasto (≈ ${c.feePaid}) não é reembolsado, mas os fundos principais não foram transferidos.`)
        : t(" Los fondos principales no se movieron.", " The principal funds did not move.", " Os fundos principais não foram transferidos.");
      add(
        "error",
        "origin_failed",
        `La transacción falló en ${chain}`,
        outOfGas
          ? t(`Se agotó el gas (usó el 100% del límite).${fee}`, `The transaction ran out of gas (it used 100% of the limit).${fee}`, `O gas acabou (a transação usou 100% do limite).${fee}`)
          : reason
            ? t(`El contrato revirtió con el motivo: «${reason}».${fee}`, `The contract reverted with reason: “${reason}”.${fee}`, `O contrato reverteu com o motivo: “${reason}”.${fee}`)
            : t(`La ejecución revirtió; no se pudo determinar el motivo exacto.${fee}`, `Execution reverted; the exact reason could not be determined.${fee}`, `A execução foi revertida; não foi possível determinar o motivo exato.${fee}`),
        outOfGas
            ? t("Reintenta con un límite de gas mayor.", "Try again with a higher gas limit.", "Tente novamente com um limite de gas maior.")
            : t("Revisa saldo suficiente, permisos (approve) y parámetros como slippage o fecha límite antes de reintentar. Los fondos siguen en la wallet de origen.", "Before retrying, check that you have enough balance and permissions (approve), and review settings such as slippage or deadline. The funds remain in the source wallet.", "Antes de tentar novamente, confira se há saldo e permissões (approve) suficientes e revise parâmetros como slippage ou prazo. Os fundos continuam na carteira de origem.")
      );
      return finish(issues);
    }

    // 2) Destinos peligrosos
    if (to === K.ZERO_ADDRESS || to === K.DEAD_ADDRESS) {
      add("critical", "burn_target", "La transacción se envió a una dirección de quema", t(`El destino directo es ${to}. Los fondos enviados ahí quedan inaccesibles.`, `The direct destination is ${to}. Funds sent there are inaccessible.`, `O destino direto é ${to}. Os fundos enviados para lá ficam inacessíveis.`), t("Contacta cuanto antes al soporte del servicio con el hash; normalmente no es recuperable.", "Contact the service's support as soon as possible with the hash; recovery is usually not possible.", "Entre em contato com o suporte do serviço o quanto antes e informe o hash; normalmente não é possível recuperar os fundos."));
    }

    // 3) Aprobación sin envío
    if (call.kind === "approve") {
      add(
        "warn",
        "approval_only",
        "Esta transacción solo otorgó un permiso (approve); no movió fondos",
        t(`Autorizó a ${call.spender ? K.shortAddress(call.spender) : "un contrato"} a gastar el token ${K.shortAddress(to)}, pero ese gasto se hace en una segunda transacción.`, `It authorized ${call.spender ? K.shortAddress(call.spender) : "a contract"} to spend the token ${K.shortAddress(to)}, but that spend requires a second transaction.`, `Autorizou ${call.spender ? K.shortAddress(call.spender) : "um contrato"} a gastar o token ${K.shortAddress(to)}, mas esse gasto exige uma segunda transação.`),
        t("Completa el paso siguiente (swap, depósito o bridge) en la aplicación. Si no reconoces el permiso, revócalo.", "Complete the next step (swap, deposit or bridge) in the app. If you do not recognize this permission, revoke it.", "Conclua a próxima etapa (swap, depósito ou ponte) no aplicativo. Se não reconhecer essa permissão, revogue-a.")
      );
    }

    // 4) Transferencias simples: ¿a quién se envió realmente?
    let recipient = null;
    if (call.kind === "native") recipient = to;
    else if (call.kind === "erc20_transfer" || call.kind === "erc20_transfer_from") recipient = call.recipient;

    if (recipient === K.ZERO_ADDRESS || recipient === K.DEAD_ADDRESS) {
      if (recipient !== to) add("critical", "burn_recipient", "Se envió a una dirección de quema", t(`El receptor de la transferencia es ${recipient}; los fondos quedaron inaccesibles.`, `The transfer recipient is ${recipient}; the funds are inaccessible.`, `O destinatário da transferência é ${recipient}; os fundos ficaram inacessíveis.`), t("Contacta cuanto antes al soporte del servicio con el hash; normalmente no es recuperable.", "Contact the service's support as soon as possible with the hash; recovery is usually not possible.", "Entre em contato com o suporte do serviço o quanto antes e informe o hash; normalmente não é possível recuperar os fundos."));
    } else if (recipient) {
      const isBridgeTarget = !!K.CATALOG[chain][recipient];
      if (!hasWallet) {
        // sin wallet esperada no se puede juzgar si el receptor es el correcto
      } else if (recipient === wallet) {
        if (crossChain) {
          add(
            "warn",
            "wrong_network_delivery",
            `Los fondos llegaron a tu wallet en ${chain}, no en ${destChain}`,
            t(`Fue una transferencia directa dentro de ${chain}: no cruzó a ${destChain}. Si buscas el saldo en ${destChain}, no lo vas a encontrar ahí.`, `This was a direct transfer on ${chain}; it did not move to ${destChain}. If you are looking for the balance on ${destChain}, it will not be there.`, `Foi uma transferência direta na ${chain}; ela não foi para ${destChain}. Se estiver procurando o saldo na ${destChain}, não o encontrará lá.`),
            t(`Revisa el saldo de esa wallet seleccionando la red ${chain}. Para llevarlo a ${destChain} necesitas un puente.`, `Check that wallet's balance on the ${chain} network. To move it to ${destChain}, you need a bridge.`, `Confira o saldo dessa carteira na rede ${chain}. Para transferi-lo para ${destChain}, você precisa de uma ponte.`)
          );
        } else {
          add("ok", "direct_credit", "Transferencia directa al destino esperado", t(`La transacción envió fondos directamente a la wallet esperada en ${chain}.`, `The transaction sent funds directly to the expected wallet on ${chain}.`, `A transação enviou fundos diretamente para a carteira esperada na ${chain}.`));
        }
      } else if (!isBridgeTarget) {
        const sim = K.addressSimilarity(recipient, wallet);
        if (sim.sameEnds) {
          add(
            "critical",
            "address_poisoning",
            "El receptor se parece a tu wallet pero NO es la misma dirección",
            t(`Se envió a ${recipient}, mientras que la esperada es ${wallet}. Coinciden el inicio y el final pero no el medio: es el patrón típico de «address poisoning» (dirección falsa en el historial) o de un error al copiar.`, `Funds were sent to ${recipient}, but the expected address is ${wallet}. The beginning and end match, but the middle does not. This is typical of address poisoning (a fake address in transaction history) or a copying mistake.`, `Os fundos foram enviados para ${recipient}, mas o endereço esperado é ${wallet}. O início e o fim coincidem, mas o meio não. Esse é o padrão típico de address poisoning (endereço falso no histórico) ou de erro ao copiar.`),
            t("No envíes más fondos. Verifica la dirección completa y reporta el caso; los fondos enviados a una dirección ajena normalmente no son recuperables.", "Do not send more funds. Verify the full address and report this; funds sent to someone else's address usually cannot be recovered.", "Não envie mais fundos. Confira o endereço completo e denuncie o caso; normalmente não é possível recuperar fundos enviados para o endereço de outra pessoa.")
          );
        } else if (sim.differing !== undefined && sim.differing <= 6) {
          add(
            "critical",
            "address_typo",
            "El receptor es casi idéntico a tu wallet (posible error de tipeo)",
            t(`Se envió a ${recipient}; la esperada es ${wallet}. Difieren en solo ${sim.differing} caracteres.`, `Funds were sent to ${recipient}; the expected address is ${wallet}. They differ by only ${sim.differing} characters.`, `Os fundos foram enviados para ${recipient}; o endereço esperado é ${wallet}. Eles diferem em apenas ${sim.differing} caracteres.`),
            t("Compara ambas direcciones carácter por carácter. Si no controlas el receptor, los fondos probablemente no son recuperables.", "Compare both addresses character by character. If you do not control the recipient, the funds are probably unrecoverable.", "Compare os dois endereços caractere por caractere. Se não controla o destinatário, provavelmente não será possível recuperar os fundos.")
          );
        } else {
          add(
            "error",
            "recipient_mismatch",
            "El receptor de la transferencia no es la wallet esperada",
            t(`La transacción envió a ${recipient}, distinta de la wallet esperada (${wallet}). Si el receptor es un exchange o servicio, la acreditación puede depender de ellos.`, `The transaction sent funds to ${recipient}, not the expected wallet (${wallet}). If the recipient is an exchange or service, crediting the funds may depend on them.`, `A transação enviou fundos para ${recipient}, e não para a carteira esperada (${wallet}). Se o destinatário for uma exchange ou serviço, o crédito pode depender deles.`),
            t("Confirma qué dirección se pretendía usar. Si fue un exchange, pide al soporte que busque el depósito con este hash.", "Confirm which address was intended. If it was an exchange, ask its support team to look for the deposit using this hash.", "Confirme qual endereço deveria ter sido usado. Se foi uma exchange, peça ao suporte para localizar o depósito usando este hash.")
          );
        }
      }

      // ¿El receptor es un contrato (p. ej. el propio token)?
      if (recipient !== wallet && !isBridgeTarget) {
        const tokenContract = call.kind === "native" ? null : to;
        if (recipient === tokenContract || isKnownTokenAddress(recipient)) {
          add(
            "critical",
            "sent_to_token_contract",
            "Los tokens se enviaron a la dirección de un contrato de token",
            t(`El receptor ${K.shortAddress(recipient)} es el contrato de un token, no una wallet. Los contratos de token normalmente no pueden devolver tokens recibidos por error.`, `Recipient ${K.shortAddress(recipient)} is a token contract, not a wallet. Token contracts usually cannot return tokens sent to them by mistake.`, `O destinatário ${K.shortAddress(recipient)} é um contrato de token, não uma carteira. Normalmente, contratos de token não podem devolver tokens recebidos por engano.`),
            t("Contacta al equipo del token con el hash; la recuperación solo es posible si el contrato tiene una función de rescate.", "Contact the token team with the hash. Recovery is possible only if the contract has a rescue function.", "Entre em contato com a equipe do token e informe o hash. A recuperação só será possível se o contrato tiver uma função de resgate.")
          );
        } else {
          const code = await safe(api.getCode(chain, recipient));
          if (hasCode(code)) {
            add(
              "warn",
              "recipient_is_contract",
              "El receptor es un contrato inteligente, no una wallet común",
              t(`${K.shortAddress(recipient)} tiene código desplegado en ${chain}. Si no es un contrato diseñado para recibir estos fondos (p. ej. una wallet Safe propia), pueden quedar atrapados.`, `${K.shortAddress(recipient)} has code deployed on ${chain}. Unless it is a contract designed to receive these funds (for example, your own Safe wallet), they may be stuck.`, `${K.shortAddress(recipient)} tem código implantado na ${chain}. Se não for um contrato projetado para receber esses fundos (por exemplo, uma carteira Safe própria), eles podem ficar presos.`),
              t("Revisa en el explorador qué contrato es y si tiene función de retiro.", "Check the block explorer to identify the contract and see whether it has a withdrawal function.", "Consulte o explorador para identificar o contrato e verificar se ele tem uma função de saque.")
            );
          }
        }
      }
    }

    // 5) La wallet esperada ¿aparece en la transacción?
    const calldataAddresses = K.addressesInHexPayload(tx.input);
    const logAddresses = new Set();
    for (const log of logs) {
      if (Array.isArray(log.topics)) for (const t of log.topics) K.addressesInHexPayload(t).forEach((a) => logAddresses.add(a));
      K.addressesInHexPayload(log.data).forEach((a) => logAddresses.add(a));
    }
    const walletReferenced = to === wallet || calldataAddresses.includes(wallet) || logAddresses.has(wallet);
    if (hasWallet && from === wallet) {
      add("info", "sender_is_wallet", "El remitente es la misma wallet de destino", t("La transacción salió de la propia wallet esperada; revisa que realmente se quisiera enviar a otra red o dirección.", "The transaction was sent from the expected wallet itself; check whether it was meant to go to a different network or address.", "A transação saiu da própria carteira esperada; confira se a intenção era enviá-la para outra rede ou endereço."));
    }
    if (!recipient) {
      if (hasWallet && walletReferenced && bridgeMatches.length) {
        add("ok", "wallet_encoded", "La wallet esperada aparece codificada en la transacción", t("Está en la llamada o en los eventos junto con un contrato de puente/router conocido, lo que respalda que es el destinatario.", "It appears in the call or events alongside a known bridge/router contract, supporting that it is the recipient.", "Ela aparece na chamada ou nos eventos junto com um contrato conhecido de ponte/roteador, o que reforça que é o destinatário."));
      } else if (hasWallet && !walletReferenced && from !== wallet) {
        add(
          "info",
          "wallet_not_referenced",
          "La wallet esperada no aparece en la transacción de origen",
          t("Es normal si el envío salió de un exchange o de un contrato intermediario; si no, verifica que la dirección sea la correcta.", "This is normal if the transfer came from an exchange or intermediary contract; otherwise, verify that the address is correct.", "Isso é normal se a transferência saiu de uma exchange ou de um contrato intermediário; caso contrário, confira se o endereço está correto."),
          t("Si hay un exchange de por medio, pide su comprobante de retiro y busca el destino en la red indicada.", "If an exchange was involved, ask for its withdrawal receipt and check the destination on the specified network.", "Se uma exchange estiver envolvida, peça o comprovante de saque e confira o destino na rede indicada.")
        );
      }
    }

    // 6) Wallet de contrato: ¿existe en la red destino?
    if (crossChain && K.ADDRESS_RE.test(wallet)) {
      const [codeSource, codeDest] = await Promise.all([safe(api.getCode(chain, wallet)), safe(api.getCode(destChain, wallet))]);
      if (hasCode(codeSource) && codeDest !== null && !hasCode(codeDest) && !isDelegated(codeDest)) {
        add(
          "warn",
          "contract_wallet_missing_on_destination",
          `La wallet es un contrato en ${chain} pero no existe en ${destChain}`,
          t(`Las wallets de contrato (Safe, cuentas inteligentes) tienen una dirección distinta o no desplegada en cada red; quien controla esa dirección en ${chain} puede no controlarla en ${destChain}.`, `Contract wallets (Safes, smart accounts) may have a different address or may not be deployed on every network. Whoever controls that address on ${chain} may not control it on ${destChain}.`, `Carteiras de contrato (Safes, contas inteligentes) podem ter endereços diferentes ou não estar implantadas em todas as redes. Quem controla esse endereço na ${chain} pode não controlá-lo na ${destChain}.`),
          t("Antes de enviar a otra red, confirma que la misma dirección esté desplegada y controlada por ti en la red destino.", "Before sending to another network, confirm that the same address is deployed there and that you control it.", "Antes de enviar para outra rede, confirme se o mesmo endereço está implantado nela e se você o controla.")
        );
      } else if (hasCode(codeDest)) {
        add("info", "destination_is_contract", `La wallet es un contrato inteligente en ${destChain}`, t("Un contrato puede rechazar ETH o tokens si no está preparado para recibirlos.", "A contract may reject ETH or tokens if it is not designed to receive them.", "Um contrato pode rejeitar ETH ou tokens se não estiver preparado para recebê-los."));
      }
    }

    // 7) Puentes y DEX
    if (catalogTarget && K.isSwapRouter(catalogTarget)) {
      if (crossChain) {
        add(
          "warn",
          "dex_not_bridge",
          `Esto fue un swap en ${chain}, no un envío entre redes`,
          t(`La transacción llamó a ${catalogTarget.name}, un router de intercambio. Un swap cambia un token por otro dentro de ${chain}; no mueve fondos a ${destChain}.`, `The transaction called ${catalogTarget.name}, a swap router. A swap exchanges one token for another on ${chain}; it does not move funds to ${destChain}.`, `A transação chamou ${catalogTarget.name}, um roteador de swap. Um swap troca um token por outro na ${chain}; ele não transfere fundos para ${destChain}.`),
          t(`Revisa el saldo del nuevo token en la wallet seleccionando la red ${chain}. Para enviarlo a ${destChain} necesitas un puente.`, `Check your wallet's balance of the new token on ${chain}. To move it to ${destChain}, you need a bridge.`, `Confira o saldo do novo token na carteira selecionando a rede ${chain}. Para transferi-lo para ${destChain}, você precisa de uma ponte.`)
        );
      } else {
        add("info", "dex_swap", "La transacción es un swap en un DEX", t(`Llamó a ${catalogTarget.name} en ${chain}.`, `It called ${catalogTarget.name} on ${chain}.`, `Ela chamou ${catalogTarget.name} na ${chain}.`));
      }
    }
    if (catalogTarget && /L2 (Standard Bridge|System Precompile)/i.test(catalogTarget.type)) {
      add(
        "info",
        "l2_withdrawal_delay",
        "Retirar desde una red L2 a Ethereum no es inmediato",
        t("En los puentes nativos de Optimism, Base y Arbitrum los retiros pasan por un periodo de disputa (alrededor de 7 días) y luego requieren una transacción final de reclamación en Ethereum.", "Withdrawals through the native Optimism, Base and Arbitrum bridges have a challenge period (about 7 days), followed by a final claim transaction on Ethereum.", "Nos protocolos nativos de Optimism, Base e Arbitrum, os saques passam por um período de contestação (cerca de 7 dias) e depois exigem uma transação final de resgate na Ethereum."),
        t("Revisa el estado del retiro en el puente oficial; los fondos no se pierden, solo tardan.", "Check the withdrawal status on the official bridge; the funds are not lost, the process just takes time.", "Confira o status do saque na ponte oficial; os fundos não foram perdidos, o processo apenas leva tempo.")
      );
    }
    if (bridgeMatches.length && bridgeMatches.every((m) => !m.verified)) {
      add("info", "unverified_catalog_match", "La coincidencia de puente proviene de una entrada sin verificar", t("El contrato detectado está en el catálogo heredado, que no fue validado contra fuentes oficiales; es solo una pista de ruta.", "The detected contract is in the legacy catalog, which has not been verified against official sources; treat this only as a routing clue.", "O contrato detectado está no catálogo legado, que não foi verificado em fontes oficiais; considere isso apenas uma pista sobre a rota."));
    }

    // 8) Tokens
    for (const asset of assets) {
      if (!asset.known) {
        add(
          "info",
          "unknown_token",
          `Token no reconocido: ${K.shortAddress(asset.tokenAddress)}${asset.symbol && asset.symbol !== asset.tokenAddress ? ` (${asset.symbol})` : ""}`,
          t("No está en la lista de tokens equivalentes de 4kiscan, así que no se puede verificar su equivalente en otras redes. Un puente puede no soportarlo o entregarlo como otro contrato.", "It is not in 4kiscan's list of equivalent tokens, so its counterpart on other networks cannot be verified. A bridge may not support it or may deliver it as a different contract.", "Ele não está na lista de tokens equivalentes do 4kiscan, então não é possível verificar sua equivalência em outras redes. Uma ponte pode não aceitá-lo ou entregá-lo como outro contrato."),
          t("Confirma en el explorador que sea el token oficial y que el puente de destino lo admita.", "Check the block explorer to confirm that it is the official token and that the destination bridge supports it.", "Confira no explorador se esse é o token oficial e se a ponte de destino o aceita.")
        );
      } else if (asset.variant) {
        add("info", "token_variant", `Variante de token: ${asset.variant}`, t("Esta red tiene más de una versión del token (nativo y «bridged»). Son contratos distintos y algunas apps solo aceptan una de ellas.", "This network has more than one version of the token (native and bridged). They are different contracts, and some apps accept only one of them.", "Esta rede tem mais de uma versão do token (nativa e bridged). São contratos diferentes, e alguns aplicativos aceitam apenas uma delas."));
      }
    }
    if (transfers.some((t) => t.isNft)) {
      add("info", "nft_transfer", "La transacción movió un NFT (ERC-721)", t("El monto de tokens fungibles no aplica a este movimiento; revisa el NFT en el explorador.", "Fungible-token amounts do not apply to this transfer; check the NFT in the block explorer.", "A quantidade de tokens fungíveis não se aplica a essa transferência; confira o NFT no explorador."));
    }

    // 9) ¿Se movió algo?
    if (!assets.length && !transfers.length && call.kind !== "approve" && call.kind !== "deploy") {
      add(
        "warn",
        "no_assets_moved",
        "La transacción se confirmó pero no movió valor visible",
        t("No hay ETH enviado ni eventos Transfer de tokens. Puede ser una instrucción a un contrato, o un envío interno que no queda en el recibo.", "There is no ETH transfer or token Transfer event. This may be a contract instruction or an internal transfer that is not shown in the receipt.", "Não há transferência de ETH nem eventos Transfer de tokens. Pode ser uma instrução para um contrato ou uma transferência interna que não aparece no recibo."),
        t("Mira las «transacciones internas» y los eventos en el explorador antes de concluir que no hubo envío.", "Check the block explorer's internal transactions and events before concluding that nothing was sent.", "Confira as transações internas e os eventos no explorador antes de concluir que nada foi enviado.")
      );
    }

    return finish(issues);
  }

  function finish(issues) {
    return issues
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.index - b.index)
      .map((entry) => entry.issue);
  }

  // ───────────── Diagnóstico principal ─────────────
  function formatNative(hexValue, symbol) {
    return `${K.formatUnits(K.hexToBigInt(hexValue || "0x0", "value"), 18)} ${symbol}`;
  }

  /**
   * @param api  cliente de rpc.js
   * @param ctx  {chain, txHash, transaction, receipt|null, destinationWallet, destinationChain}
   */
  async function diagnose(api, ctx) {
    const { chain, txHash, transaction: tx, receipt } = ctx;
    const wallet = lower(ctx.destinationWallet);
    const destChain = ctx.destinationChain || chain;
    const nativeSymbol = K.CHAINS[chain].nativeSymbol;
    const pending = receipt === null || receipt === undefined;

    const status = pending ? "pending" : lower(receipt.status);
    if (!pending && status !== "0x0" && status !== "0x1") {
      throw new RpcError(t("El recibo no contiene un estado de transacción válido.", "The receipt does not contain a valid transaction status.", "O recibo não contém um status de transação válido."), "invalid");
    }

    let logs = [];
    let logsWarning = null;
    if (!pending) {
      const raw = receipt.logs;
      if (Array.isArray(raw)) {
        logs = raw.filter((log) => log && typeof log === "object");
        if (logs.length !== raw.length) logsWarning = t("El recibo contiene logs malformados; se omitieron para poder continuar.", "The receipt contains malformed logs; they were skipped so analysis could continue.", "O recibo contém logs malformados; eles foram ignorados para permitir a continuidade da análise.");
      } else if (raw != null) {
        logsWarning = t("El campo logs del recibo tiene un formato inesperado; no se pudieron analizar los eventos.", "The receipt's logs field has an unexpected format; events could not be analyzed.", "O campo de logs do recibo tem um formato inesperado; não foi possível analisar os eventos.");
      }
    }

    const to = lower(tx.to);
    const from = lower(tx.from);
    const nativeValue = K.hexToBigInt(tx.value || "0x0", "value");
    const { transfers, matching } = analyzeTransferLogs(logs, wallet);
    const routeMatches = identifyBridges(chain, to, logs, tx.input || "");
    // Solo los puentes cuentan como ruta cross-chain; los routers de DEX se informan aparte.
    const bridgeMatches = routeMatches.filter((m) => m.category === "bridge");
    const call = describeCall(tx);
    const succeeded = status === "0x1";
    const directNativeCredit = succeeded && wallet !== "" && to === wallet && nativeValue > 0n;
    const assets = succeeded ? await extractOriginAssets(api, chain, tx, logs, routeMatches) : [];
    const sourceChainCredit = destChain === chain && (directNativeCredit || matching.length > 0);

    let blockNumber = null;
    if (!pending && receipt.blockNumber != null) blockNumber = K.hexToInt(receipt.blockNumber, "blockNumber");
    let feePaid = null;
    if (!pending && receipt.gasUsed && receipt.effectiveGasPrice) {
      try {
        const wei = K.hexToBigInt(receipt.gasUsed, "gasUsed") * K.hexToBigInt(receipt.effectiveGasPrice, "effectiveGasPrice");
        feePaid = `${K.formatUnits(wei, 18)} ${nativeSymbol}`;
      } catch (error) {
        feePaid = null;
      }
    }

    // Semáforo preliminar (el radar lo puede refinar)
    let color, indicator, title, statusCode, notes;
    if (pending) {
      color = "yellow";
      indicator = "🟡";
      title = t("Transacción pendiente o aún sin recibo", "Transaction pending or receipt not yet available", "Transação pendente ou ainda sem recibo");
      statusCode = "ORIGIN_PENDING";
      notes = t("La transacción existe pero todavía no tiene recibo: puede estar esperando inclusión, haber sido reemplazada o descartada.", "The transaction exists but does not have a receipt yet: it may be waiting for inclusion, or may have been replaced or dropped.", "A transação existe, mas ainda não tem recibo: pode estar aguardando inclusão, ter sido substituída ou descartada.");
    } else if (!succeeded) {
      color = "red";
      indicator = "🔴";
      title = t("La transacción falló en la red de origen", "The transaction failed on the source network", "A transação falhou na rede de origem");
      statusCode = "ORIGIN_FAILED";
      notes = t("El recibo indica estado 0x0: la ejecución no fue exitosa y los fondos principales no se movieron.", "The receipt shows status 0x0: execution was unsuccessful and the principal funds did not move.", "O recibo indica o status 0x0: a execução falhou e os fundos principais não foram transferidos.");
    } else if (sourceChainCredit) {
      color = "green";
      indicator = "🟢";
      title = t("Crédito explícito observado en la wallet de destino", "Explicit credit observed in the destination wallet", "Crédito explícito observado na carteira de destino");
      statusCode = "DESTINATION_CREDIT_FOUND";
      const detail = directNativeCredit
        ? `una transferencia nativa de ${formatNative(tx.value, nativeSymbol)}`
        : `${matching.length} evento(s) Transfer de token`;
      notes = t(`La transacción fue exitosa y el recibo muestra ${detail} hacia la wallet indicada en la red consultada.`, `The transaction succeeded and the receipt shows ${detail} sent to the specified wallet on the queried network.`, `A transação foi concluída e o recibo mostra ${detail} enviados para a carteira indicada na rede consultada.`);
    } else if (bridgeMatches.length) {
      color = "bridge";
      indicator = "🟡";
      const protocols = [...new Set(bridgeMatches.map((m) => m.protocol))].join(", ");
      const contracts = [...new Set(bridgeMatches.map((m) => m.name))].join(", ");
      title = t(`Pasó por un puente/router conocido (${contracts}). Origen OK; falta confirmar el crédito en destino`, `It passed through a known bridge/router (${contracts}). Source succeeded; destination credit still needs confirmation`, `Passou por uma ponte/roteador conhecido (${contracts}). Origem concluída; falta confirmar o crédito no destino`);
      statusCode = "ORIGIN_ROUTED_TO_BRIDGE";
      notes = t(`Origen exitoso. Coincidencia de catálogo: ${protocols}. La evidencia puede venir del destinatario, la llamada o referencias en los logs; por sí sola no confirma el uso real del protocolo ni la entrega. Verifica el crédito en la red destino.`, `Source succeeded. Catalog match: ${protocols}. The evidence may come from the recipient, call or log references; by itself, it does not confirm actual protocol use or delivery. Verify the credit on the destination network.`, `A origem foi concluída. Correspondência no catálogo: ${protocols}. A evidência pode vir do destinatário, da chamada ou de referências nos logs; por si só, não confirma o uso real do protocolo nem a entrega. Verifique o crédito na rede de destino.`);
    } else {
      color = "yellow";
      indicator = "🟡";
      title = t("Origen exitoso; el crédito en destino no aparece en este recibo", "Source succeeded; destination credit does not appear in this receipt", "Origem concluída; o crédito no destino não aparece neste recibo");
      statusCode = "ORIGIN_CONFIRMED_DESTINATION_UNVERIFIED";
      notes =
        destChain !== chain && (directNativeCredit || matching.length)
          ? t(`El recibo muestra un crédito a la wallet en ${chain}, pero la red destino elegida es ${destChain}. Eso no es evidencia de crédito en destino.`, `The receipt shows a credit to the wallet on ${chain}, but the selected destination network is ${destChain}. This is not evidence of destination credit.`, `O recibo mostra um crédito na carteira em ${chain}, mas a rede de destino selecionada é ${destChain}. Isso não é evidência de crédito no destino.`)
          : t("La transacción de origen fue exitosa, pero este recibo no muestra una transferencia nativa ni un evento Transfer hacia la wallet indicada. Si se usó un puente, la entrega debe confirmarse en la red destino.", "The source transaction succeeded, but this receipt shows no native transfer or Transfer event to the specified wallet. If a bridge was used, delivery must be confirmed on the destination network.", "A transação de origem foi concluída, mas este recibo não mostra uma transferência nativa nem um evento Transfer para a carteira indicada. Se uma ponte foi usada, a entrega deve ser confirmada na rede de destino.");
    }

    const issues = await findIssues(api, {
      chain, destChain, wallet, tx, to, from, call, status, receipt, logs, transfers, assets,
      bridgeMatches, blockNumber, feePaid,
    });

    return {
      color, indicator, title, statusCode, notes,
      chain, txHash, status, from, to: to || t("Creación de contrato", "Contract creation", "Criação de contrato"),
      destinationWallet: wallet, destinationChain: destChain,
      originAssets: assets,
      bridgeMatches,
      routeMatches,
      bridgeProtocols: [...new Set(bridgeMatches.map((m) => m.protocol))],
      nativeValue: formatNative(tx.value, nativeSymbol),
      blockNumber, logCount: logs.length, logsWarning,
      transfers, matchingTransfers: matching,
      directNativeCredit,
      senderMatchesDestination: from === wallet,
      call: { kind: call.kind, selector: call.selector, name: call.name },
      feePaid,
      issues,
      receipt: receipt || null,
      transaction: tx,
    };
  }

  Object.assign(K, {
    SEVERITY_RANK,
    tokenIdentity,
    isKnownTokenAddress,
    analyzeTransferLogs,
    identifyBridges,
    describeCall,
    extractOriginAssets,
    localizeDiagnosisText,
    findIssues,
    diagnose,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
