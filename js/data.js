/* 4kiscan · data.js
 * Redes, equivalencias de tokens y catálogo de contratos (bridges / routers / DEX).
 * Las entradas "verified" provienen de catalog.json (fuentes oficiales de cada
 * protocolo). Las "legacy" vienen del catálogo original de app.py: sirven como
 * pista de ruta pero NO están verificadas contra fuentes oficiales.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";
  const t = (es, en, pt) => locale() === "en" ? en : locale() === "pt" ? pt : es;

  // ───────────── Redes soportadas ─────────────
  const CHAINS = {
    Polygon: {
      chainId: 137,
      alchemySlug: "polygon-mainnet",
      nativeSymbol: "POL",
      averageBlockTime: 2.0,
      explorer: "https://polygonscan.com",
      internalTransfers: true,
      defillamaId: "polygon",
      nativeCoin: "coingecko:polygon-ecosystem-token",
    },
    Ethereum: {
      chainId: 1,
      alchemySlug: "eth-mainnet",
      nativeSymbol: "ETH",
      averageBlockTime: 12.0,
      explorer: "https://etherscan.io",
      internalTransfers: true,
      defillamaId: "ethereum",
      nativeCoin: "coingecko:ethereum",
    },
    Optimism: {
      chainId: 10,
      alchemySlug: "opt-mainnet",
      nativeSymbol: "ETH",
      averageBlockTime: 2.0,
      explorer: "https://optimistic.etherscan.io",
      internalTransfers: false,
      defillamaId: "optimism",
      nativeCoin: "coingecko:ethereum",
    },
    Arbitrum: {
      chainId: 42161,
      alchemySlug: "arb-mainnet",
      nativeSymbol: "ETH",
      averageBlockTime: 0.25,
      explorer: "https://arbiscan.io",
      internalTransfers: false,
      defillamaId: "arbitrum",
      nativeCoin: "coingecko:ethereum",
    },
    Base: {
      chainId: 8453,
      alchemySlug: "base-mainnet",
      nativeSymbol: "ETH",
      averageBlockTime: 2.0,
      explorer: "https://basescan.org",
      internalTransfers: true,
      defillamaId: "base",
      nativeCoin: "coingecko:ethereum",
    },
  };

  /** Redes populares que 4kiscan NO puede consultar (para orientar al usuario). */
  const UNSUPPORTED_NETWORKS = [
    { name: "BNB Chain", chainId: 56, explorerTx: "https://bscscan.com/tx/" },
    { name: "Avalanche C-Chain", chainId: 43114, explorerTx: "https://snowtrace.io/tx/" },
    { name: "Linea", chainId: 59144, explorerTx: "https://lineascan.build/tx/" },
    { name: "Scroll", chainId: 534352, explorerTx: "https://scrollscan.com/tx/" },
    { name: "Gnosis", chainId: 100, explorerTx: "https://gnosisscan.io/tx/" },
    { name: "zkSync Era", chainId: 324, explorerTx: "https://era.zksync.network/tx/" },
  ];

  // ───────────── Tokens equivalentes por red ─────────────
  // asset → red → { dirección: decimales }
  const TOKEN_GROUPS = {
    USDC: {
      Ethereum: { "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6 },
      Polygon: {
        "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6,
        "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 6,
      },
      Optimism: {
        "0x0b2c639c533813f4aa9d7837caf62653d097ff85": 6,
        "0x7f5c764cbc14f9669b88837ca1490cca17c31607": 6,
      },
      Arbitrum: {
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 6,
        "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 6,
      },
      Base: { "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6 },
    },
    USDT: {
      Ethereum: { "0xdac17f958d2ee523a2206206994597c13d831ec7": 6 },
      Polygon: {
        "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": 6,
        "0x9417669fbf23357d2774e9d421307bd5ea1006d2": 6,
      },
      Optimism: {
        "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": 6,
        "0x01bff41798a0bcf287b996046ca68b395dbc1071": 6,
      },
      Arbitrum: { "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 6 },
      Base: { "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": 6 },
    },
    WETH: {
      Ethereum: { "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18 },
      Polygon: { "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 18 },
      Optimism: { "0x4200000000000000000000000000000000000006": 18 },
      Arbitrum: { "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 18 },
      Base: { "0x4200000000000000000000000000000000000006": 18 },
    },
    eETH: {
      Ethereum: { "0x35fa164735182de50811e8e2e824cfb9b6118ac2": 18 },
    },
    weETH: {
      Ethereum: { "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": 18 },
      Optimism: { "0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff": 18 },
      Arbitrum: { "0x35751007a407ca6feffe80b3cb397736d2cf4dbe": 18 },
      Base: { "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": 18 },
    },
  };

  /** Variantes de token que suelen confundir a los usuarios (misma red + dirección). */
  const TOKEN_VARIANTS = {
    "Polygon:0x2791bca1f2de4661ed88a30c99a7a9449aa84174": "USDC.e (bridged)",
    "Optimism:0x7f5c764cbc14f9669b88837ca1490cca17c31607": "USDC.e (bridged)",
    "Arbitrum:0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": "USDC.e (bridged)",
    get "Optimism:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58"() { return t("USDT (bridged, legado)", "USDT (bridged, legacy)", "USDT (bridged, legado)"); },
    "Optimism:0x01bff41798a0bcf287b996046ca68b395dbc1071": "USDT0",
  };

  // ───────────── Catálogo VERIFICADO (catalog.json) ─────────────
  // [dirección, nombre, protocolo, rol, categoría, extra?]
  const SOCKET = [
    ["0x50cfe7c1938db66a1a6d2e86d36f39fbef3d5c4a", "Socket Open Router", "Socket", "Open Router", "bridge"],
    ["0x50c4e75a512f2a14a7b304787adf79c4531a5909", "Socket Allowance Holder", "Socket", "Allowance Holder", "bridge"],
  ];
  const CURVE_PROVIDER = [
    "0x5ffe7fb82894076ecb99a30d6a32e969e6e35e98",
    "Curve Address Provider",
    "Curve",
    "Address Provider",
    "dex",
    { caveat: t("El directorio de Curve advierte que puede contener datos desactualizados.", "Curve's directory warns that it may contain outdated data.", "O diretório da Curve alerta que pode conter dados desatualizados.") },
  ];
  const CURVE_CAVEAT = { caveat: t("El directorio de Curve advierte que puede contener datos desactualizados.", "Curve's directory warns that it may contain outdated data.", "O diretório da Curve alerta que pode conter dados desatualizados.") };
  const UNI_V3 = (factory, router) => [
    [factory, "Uniswap V3 Factory", "Uniswap", "Factory", "dex"],
    [router, "Uniswap V3 SwapRouter02", "Uniswap", "SwapRouter02", "dex"],
  ];
  const POS_SYSTEM = {
    caveat: t("Contrato de sistema listado en el génesis de Polygon; no es el punto de entrada de usuario del bridge.", "System contract listed in Polygon's genesis; it is not the bridge's user entry point.", "Contrato de sistema listado no genesis da Polygon; não é o ponto de entrada do usuário na ponte."),
  };

  const VERIFIED = {
    Ethereum: [
      ["0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5", "Across SpokePool", "Across", "SpokePool", "bridge"],
      ["0x8731d54e9d02c286767d56ac03e8037c07e01e98", "Stargate V1 Router", "Stargate", "Router", "bridge"],
      ["0x8898b472c54c31894e3b9bb83cea802a5d0e63c6", "Connext Amarok Core", "Connext", "Core", "bridge"],
      ["0x5427fefa711eff984124bfbb1ab6fbf5e3da1820", "Celer cBridge Pool Bridge", "Celer cBridge", "Bridge", "bridge"],
      ...SOCKET,
      ["0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a", "Arbitrum One L1 Bridge", "Arbitrum Native Bridge", "L1 Bridge", "bridge"],
      ["0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f", "Arbitrum One Delayed Inbox", "Arbitrum Native Bridge", "Delayed Inbox", "bridge"],
      ["0x401f6c983ea34274ec46f84d70b31c151321188b", "Polygon PoS Deposit Manager Proxy", "Polygon PoS Native Bridge", t("Contrato de sistema", "System contract", "Contrato de sistema"), "bridge", POS_SYSTEM],
      ["0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f", "Uniswap V2 Factory", "Uniswap", "Factory", "dex"],
      ["0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "Uniswap V2 Router02", "Uniswap", "Router", "dex"],
      ...UNI_V3("0x1f98431c8ad98523631ae4a59f267346ea31f984", "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"),
      ["0x16c6521dff6bab339122a0fe25a9116693265353", "Curve Router V1", "Curve", "Router", "dex", CURVE_CAVEAT],
      ["0x45312ea0eff7e09c83cbe249fa1d7598c4c8cd4e", "Curve Router V2", "Curve", "Router", "dex", CURVE_CAVEAT],
      CURVE_PROVIDER,
    ],
    Polygon: [
      ["0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096", "Across SpokePool", "Across", "SpokePool", "bridge"],
      ["0x45a01e4e04f14f7a4a6702c74187c5f6222033cd", "Stargate V1 Router", "Stargate", "Router", "bridge"],
      ["0x11984dc4465481512eb5b777e44061c158cf2259", "Connext Amarok Core", "Connext", "Core", "bridge"],
      ["0x88dcdc47d2f83a99cf0000fdf667a468bb958a78", "Celer cBridge Pool Bridge", "Celer cBridge", "Bridge", "bridge"],
      ...SOCKET,
      ["0xd9c7c4ed4b66858301d0cb28cc88bf655fe34861", "Polygon PoS Child Chain", "Polygon PoS Native Bridge", t("Contrato de sistema", "System contract", "Contrato de sistema"), "bridge", POS_SYSTEM],
      ["0x9e5a52f57b3038f1b8eee45f28b3c1967e22799c", "Uniswap V2 Factory", "Uniswap", "Factory", "dex"],
      ["0xedf6066a2b290c185783862c7f4776a2c8077ad1", "Uniswap V2 Router02", "Uniswap", "Router", "dex"],
      ...UNI_V3("0x1f98431c8ad98523631ae4a59f267346ea31f984", "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"),
      ["0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff", "QuickSwap V2 Router", "QuickSwap", "Router", "dex"],
      ["0x5757371414417b8c6caad45baef941abc7d3ab32", "QuickSwap V2 Factory", "QuickSwap", "Factory", "dex"],
      ["0x411b0facc3489691f28ad58c47006af5e3ab3a28", "QuickSwap V3 Algebra Factory", "QuickSwap", "Factory", "dex"],
      ["0xf5b509bb0909a69b1c207e495f687a596c168e12", "QuickSwap V3 Algebra Swap Router", "QuickSwap", "Router", "dex"],
      ["0x0dcded3545d565ba3b19e683431381007245d983", "Curve Router", "Curve", "Router", "dex", CURVE_CAVEAT],
      CURVE_PROVIDER,
    ],
    Arbitrum: [
      ["0xe35e9842fceaca96570b734083f4a58e8f7c5f2a", "Across SpokePool", "Across", "SpokePool", "bridge"],
      ["0x53bf833a5d6c4dda888f69c22c88c9f356a41614", "Stargate V1 Router", "Stargate", "Router", "bridge"],
      ["0xee9dec2712cce65174b561151701bf54b99c24c8", "Connext Amarok Core", "Connext", "Core", "bridge"],
      ["0x1619de6b6b20ed217a58d00f37b9d47c7663feca", "Celer cBridge Pool Bridge", "Celer cBridge", "Bridge", "bridge"],
      ...SOCKET,
      ["0xf1d7cc64fb4452f05c498126312ebe29f30fbcf9", "Uniswap V2 Factory", "Uniswap", "Factory", "dex"],
      ["0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", "Uniswap V2 Router02", "Uniswap", "Router", "dex"],
      ...UNI_V3("0x1f98431c8ad98523631ae4a59f267346ea31f984", "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"),
      ["0x2191718cd32d02b8e60badffea33e4b5dd9a0a0d", "Curve Router", "Curve", "Router", "dex", CURVE_CAVEAT],
      CURVE_PROVIDER,
    ],
    Optimism: [
      ["0x6f26bf09b1c792e3228e5467807a900a503c0281", "Across SpokePool", "Across", "SpokePool", "bridge"],
      ["0xb0d502e938ed5f4df2e681fe6e419ff29631d62b", "Stargate V1 Router", "Stargate", "Router", "bridge"],
      ["0x8f7492de823025b4cfaab1d34c58963f2af5deda", "Connext Amarok Core", "Connext", "Core", "bridge"],
      ["0x9d39fc627a6d9d9f8c831c16995b209548cc3401", "Celer cBridge Pool Bridge", "Celer cBridge", "Bridge", "bridge"],
      ...SOCKET,
      ["0x0c3c1c532f1e39edf36be9fe0be1410313e074bf", "Uniswap V2 Factory", "Uniswap", "Factory", "dex"],
      ["0x4a7b5da61326a6379179b40d00f57e5bbdc962c2", "Uniswap V2 Router02", "Uniswap", "Router", "dex"],
      ...UNI_V3("0x1f98431c8ad98523631ae4a59f267346ea31f984", "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"),
      ["0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858", "Velodrome Router", "Velodrome", "Router", "dex"],
      ["0xf1046053aa5682b4f9a81b5481394da16be5ff5a", "Velodrome PoolFactory", "Velodrome", "PoolFactory", "dex"],
      ["0xf4c67cdeaab8360370f41514d06e32ccd8aa1d7b", "Velodrome FactoryRegistry", "Velodrome", "FactoryRegistry", "dex"],
      ["0x0dcded3545d565ba3b19e683431381007245d983", "Curve Router", "Curve", "Router", "dex", CURVE_CAVEAT],
      CURVE_PROVIDER,
    ],
    Base: [
      ["0x09aea4b2242abc8bb4bb78d537a67a245a7bec64", "Across SpokePool", "Across", "SpokePool", "bridge"],
      ["0x45f1a95a4d3f3836523f5c83673c797f4d4d263b", "Stargate V1 Router", "Stargate", "Router", "bridge"],
      ["0xb8448c6f7f7887d36dca487370778e419e9ebe3f", "Connext Amarok Core", "Connext", "Core", "bridge"],
      ["0x7d43aabc515c356145049227cee54b608342c0ad", "Celer cBridge Pool Bridge", "Celer cBridge", "Bridge", "bridge"],
      ...SOCKET,
      ["0x8909dc15e40173ff4699343b6eb8132c65e18ec6", "Uniswap V2 Factory", "Uniswap", "Factory", "dex"],
      ["0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", "Uniswap V2 Router02", "Uniswap", "Router", "dex"],
      ...UNI_V3("0x33128a8fc17869897dce68ed026d694621f6fdfd", "0x2626664c2603336e57b271c5c0b26f421741e481"),
      ["0x4a012af2b05616fb390ed32452641c3f04633bb5", "QuickSwap V2 Router", "QuickSwap", "Router", "dex"],
      ["0xec6540261aaae13f236a032d454dc9287e52e56a", "QuickSwap V2 Factory", "QuickSwap", "Factory", "dex"],
      ["0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43", "Aerodrome Router", "Aerodrome", "Router", "dex"],
      ["0x420dd381b31aef6683db6b902084cb0ffece40da", "Aerodrome PoolFactory", "Aerodrome", "PoolFactory", "dex"],
      ["0x5c3f18f06cc09ca1910767a34a20f771039e37c0", "Aerodrome FactoryRegistry", "Aerodrome", "FactoryRegistry", "dex"],
      ["0x4f37a9d177470499a2dd084621020b023fcffc1f", "Curve Router", "Curve", "Router", "dex", CURVE_CAVEAT],
      CURVE_PROVIDER,
    ],
  };

  // ───────────── Catálogo LEGACY (app.py original, sin verificar) ─────────────
  // [dirección, nombre, protocolo, tipo]
  const LIFI = ["0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "LI.FI Diamond", "LI.FI", "Cross-chain Aggregator"];
  const SOCKET_GW = ["0x3a23f943181408eac424116af7b7790c94cb97a5", "Socket Gateway", "Socket", "Cross-chain Router"];
  const LZ = ["0x1a44076050125825900e736c501f859c50fe728c", "LayerZero V2 Endpoint", "LayerZero", "Messaging Endpoint"];
  const CELER_OLD = ["0x841ce48f9446c8e281d3f1444cb859b4a6d0738c", "Celer cBridge (legado)", "Celer cBridge", "Liquidity Bridge"];
  const LEGACY = {
    Ethereum: [
      ["0x5d22045daceab03b158031ecb7d9d06fad24609b", "Rhino.fi StarkEx Proxy (candidato)", "Rhino.fi", "StarkEx Proxy"],
      LIFI,
      SOCKET_GW,
      ["0xfbc81a18ecda8e6a91275cfdf5fc6d91a7c5ae80", "Across SpokePool (legado)", "Across", "SpokePool"],
      ["0x150f94b44927f078737562f0fcf3c95c01cc2376", "Stargate V1 RouterETH", "Stargate", "Native-asset Router"],
      ["0xb1b2eef380f21747944f46d28f683cd1fbb4d03c", "Stargate V1 RouterETH with Payload", "Stargate", "Payload Router"],
      ["0x296f55f8fb28e498b858d0bcda06d955b2cb3f97", "Stargate V1 Bridge", "Stargate", "Bridge"],
      ["0x77b2043768d28e9c9ab44e1abfc95944bce57931", "Stargate V2 Native Pool", "Stargate", "Native Pool / LayerZero V2"],
      ["0xc026395860db2d07ee33e05fe50ed7bd583189c7", "Stargate V2 USDC Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0x933597a323eb81cae705c5bc29985172fd5a3973", "Stargate V2 USDT Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0x3666f603cc164936c1b87e207f36beba4ac5f18a", "Hop USDC L1 Bridge", "Hop Protocol", "Bridge"],
      ["0x3e4a3a4796d16c0cd582c382691998f7c06420b6", "Hop USDT L1 Bridge", "Hop Protocol", "Bridge"],
      CELER_OLD,
      ["0x7e77461ca2a9d82d26fd5e0da2243bf72ea45747", "Hop USDC CCTP Bridge", "Hop Protocol", "CCTP Bridge"],
      LZ,
      ["0xbeb5fc579115071764c7423a4f12edde41f106ed", "Optimism Portal", "Optimism Native Bridge", "L1 Portal"],
      ["0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", "Optimism L1 Standard Bridge", "Optimism Native Bridge", "L1 Standard Bridge"],
      ["0x49048044d57e1c92a77f79988d21fa8faf74e97e", "Base L1 Portal", "Base Native Bridge", "L1 Portal"],
      ["0x3154cf16ccdb4c6d922629664174b904d80f2c35", "Base L1 Standard Bridge", "Base Native Bridge", "L1 Standard Bridge"],
      ["0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef", "Arbitrum One L1 Gateway Router", "Arbitrum Native Bridge", "L1 Gateway Router"],
      ["0xa3a7b6f88361f48403514059f1f16c8e78d60eec", "Arbitrum One L1 ERC-20 Gateway", "Arbitrum Native Bridge", "L1 Token Gateway"],
      ["0xcee284f754e854890e311e3280b767f80797180d", "Arbitrum One L1 Custom Gateway", "Arbitrum Native Bridge", "L1 Custom Token Gateway"],
      ["0xa0c68c638235ee32657e8f720a23cec1bfc77c77", "Polygon PoS RootChainManager", "Polygon Native Bridge", "RootChainManager"],
      ["0x2a88696e0ffa76baa1338f2c74497cc013495922", "Polygon PoS WithdrawManager", "Polygon Native Bridge", "L1 Withdraw Manager"],
    ],
    // Nota: se omitió la entrada heredada "0xa0c68c63… Polygon PoS ChildChainManager
    // (candidate)" de Polygon: esa dirección es la RootChainManager de Ethereum y no
    // hay evidencia de que sea un contrato en Polygon.
    Polygon: [
      LIFI,
      SOCKET_GW,
      ["0x68ec189ca4d950d960bb59b56742ec292e7d2c17", "Across SpokePool (legado)", "Across", "SpokePool"],
      ["0x9d1b1669c73b033dfe47ae5a0164ab96df25b944", "Stargate V1 Bridge", "Stargate", "Bridge"],
      ["0x1205f31718499dbf1fca446663b532ef87481fe1", "Stargate V1 USDC Pool", "Stargate", "Liquidity Pool"],
      ["0x29e38769f23701a2e4a8ef0492e19da4604be62c", "Stargate V1 USDT Pool", "Stargate", "Liquidity Pool"],
      CELER_OLD,
      LZ,
      ["0x9aa02d4fae7f58b8e8f34c66e756cc734dac7fe4", "Stargate V2 USDC Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0x25d8039bb044dc227f741a9e381ca4ceae2e6ae8", "Hop USDC L2 Bridge", "Hop Protocol", "Bridge"],
      ["0x5c32143c8b198f392d01f8446b754c181224ac26", "Hop USDC Saddle Swap", "Hop Protocol", "AMM Swap"],
      ["0x76b22b8c1079a44f1211d867d68b1eda76a635a7", "Hop USDC AMM Wrapper", "Hop Protocol", "AMM Wrapper"],
    ],
    Optimism: [
      LIFI,
      SOCKET_GW,
      ["0xd51099ac551350bf3198c69104b5dc4694b3a536", "Across SpokePool (legado)", "Across", "SpokePool"],
      ["0xce8cca271ebc0533920c83d39f417ed6a0abb7d0", "Stargate V2 USDC Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0xa81d244a1814468c734e5b4101f7b9c0c577a8fc", "Hop USDC L2 Bridge", "Hop Protocol", "Bridge"],
      ["0x3c0ffaca566fccfd9cc95139fef6cba143795963", "Hop USDC Saddle Swap", "Hop Protocol", "AMM Swap"],
      ["0x2ad09850b0ca4c7c1b33f5acd6cbabcab5d6e796", "Hop USDC AMM Wrapper", "Hop Protocol", "AMM Wrapper"],
      LZ,
      ["0x4200000000000000000000000000000000000010", "Optimism L2 Standard Bridge", "Optimism Native Bridge", "L2 Standard Bridge"],
    ],
    Arbitrum: [
      LIFI,
      SOCKET_GW,
      ["0x2a5a4ed1220f64714d4a7c3b3bd6188957764c9a", "Across SpokePool (legado)", "Across", "SpokePool"],
      ["0xbf22f0f184bccbea268df387a49ff5238dd23e40", "Stargate V1 RouterETH", "Stargate", "Native-asset Router"],
      ["0x352d8275aae3e0c2404d9f68f6cee084b5beb3dd", "Stargate V1 Bridge", "Stargate", "Bridge"],
      ["0x892785f33cdee22a30aef750f285e18c18040c3e", "Stargate V1 USDC Pool", "Stargate", "Liquidity Pool"],
      ["0xb6cfcf89a7b22988bfc96632ac2a9d6dab60d641", "Stargate V1 USDT Pool", "Stargate", "Liquidity Pool"],
      ["0xe8cdf27acd73a434d661c84887215f7598e7d0d3", "Stargate V2 USDC Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0x0e0e3d2c5c292161999474247956ef542cabf8dd", "Hop USDC L2 Bridge", "Hop Protocol", "Bridge"],
      ["0xe22d2bedb3eca35e6397e0c6d62857094aa26f52", "Hop USDC AMM Wrapper", "Hop Protocol", "AMM Wrapper"],
      ["0x10541b07d8ad2647dc6cd67abd4c03575dade261", "Hop USDC Saddle Swap", "Hop Protocol", "AMM Swap"],
      CELER_OLD,
      LZ,
      ["0x0000000000000000000000000000000000000064", "Arbitrum ArbSys", "Arbitrum Native Bridge", "L2 System Precompile"],
      ["0x5288c571fd7ad117bea99bf60fe0846c4e84f933", "Arbitrum L2 Gateway Router", "Arbitrum Native Bridge", "L2 Gateway Router"],
      ["0x09e9222e96e7b4ae2a407b98d48e330053351eee", "Arbitrum L2 ERC-20 Gateway", "Arbitrum Native Bridge", "L2 Token Gateway"],
      ["0x096760f208390250649e3e8763348e783aef5562", "Arbitrum L2 Custom Gateway", "Arbitrum Native Bridge", "L2 Custom Token Gateway"],
    ],
    Base: [
      LIFI,
      SOCKET_GW,
      ["0x6c99671b249af73b2847d92123d823cb3875e399", "Across SpokePool (legado)", "Across", "SpokePool"],
      ["0x27a16dc786820b16e5c9028b75b99f6f604b5d26", "Stargate V2 USDC Pool", "Stargate", "Liquidity Pool / LayerZero V2"],
      ["0x46ae9bab8cea96610807a275ebd36f8e916b5c61", "Hop USDC L2 Bridge", "Hop Protocol", "Bridge"],
      ["0x7d269d3e0d61a05a0ba976b7dbf8805bf844af3f", "Hop USDC AMM Wrapper", "Hop Protocol", "AMM Wrapper"],
      ["0x022c5ce6f1add7423268d41e08df521d5527c2a0", "Hop USDC Saddle Swap", "Hop Protocol", "AMM Swap"],
      LZ,
      ["0x4200000000000000000000000000000000000010", "Base L2 Standard Bridge", "Base Native Bridge", "L2 Standard Bridge"],
    ],
  };

  // ───────────── Construcción del catálogo ─────────────
  function buildCatalog() {
    const catalog = {};
    for (const chain of Object.keys(CHAINS)) catalog[chain] = {};
    for (const [chain, rows] of Object.entries(LEGACY)) {
      for (const [address, name, protocol, type] of rows) {
        catalog[chain][address] = { address, name, protocol, type, category: "bridge", verified: false };
      }
    }
    // Las entradas verificadas pisan a las heredadas con la misma dirección.
    for (const [chain, rows] of Object.entries(VERIFIED)) {
      for (const [address, name, protocol, type, category, extra] of rows) {
        catalog[chain][address] = {
          address,
          name,
          protocol,
          type,
          category,
          verified: true,
          ...(extra || {}),
        };
      }
    }
    return catalog;
  }

  /** Router de DEX (un swap en una sola red, no un puente). */
  function isSwapRouter(entry) {
    return !!entry && entry.category === "dex" && /router/i.test(entry.type);
  }

  Object.assign(K, {
    CHAINS,
    UNSUPPORTED_NETWORKS,
    TOKEN_GROUPS,
    TOKEN_VARIANTS,
    CATALOG: buildCatalog(),
    isSwapRouter,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
