/* 4kiscan · concepts.js
 * Glosario en lenguaje claro. El evaluador devuelve ids de conceptos relevantes y
 * la interfaz los muestra como explicaciones desplegables para el cliente.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});
  const locale = () => typeof K.getLocale === "function" ? K.getLocale() : "es";

  const CONCEPTS = {
    red: {
      term: "Red (blockchain)",
      short: "Cada red es un sistema independiente (Ethereum, Polygon, Base…). Un token enviado por una red solo existe en esa red.",
      long: "Un mismo activo puede existir en varias redes, pero cada copia vive únicamente en la red por la que se envió. Si la plataforma de destino espera recibir por la red A y tú envías por la red B, los fondos no desaparecen: quedan en la red B, a veces en una dirección que la plataforma no vigila. Elegir mal la red es la causa más común de fondos «que no llegaron».",
    },
    direccion_evm: {
      term: "Dirección EVM",
      short: "Ethereum, Polygon, Optimism, Arbitrum, Base y otras comparten el formato 0x + 40 caracteres.",
      long: "Las redes compatibles con EVM usan el mismo tipo de dirección, y una wallet personal normalmente controla la misma dirección en todas ellas. Por eso, si enviaste por la red equivocada a tu propia wallet, los fondos suelen estar a salvo en esa otra red y solo hay que cambiar de red para verlos. No ocurre lo mismo con redes que no son EVM (Tron, Bitcoin, Solana, XRP), que usan formatos distintos.",
    },
    hash: {
      term: "Hash de transacción (TxID)",
      short: "El «comprobante» único de una transacción: 0x + 64 caracteres.",
      long: "Es el identificador público de la transacción. Con él cualquier persona puede ver en un explorador de bloques si ocurrió, cuándo, por qué red, desde y hacia qué direcciones y cuánto se movió. Los exchanges lo llaman «TxID» o «ID de transacción». Es la prueba neutral de lo que pasó en la red.",
    },
    explorador: {
      term: "Explorador de bloques",
      short: "Sitio público (Etherscan, Polygonscan, Basescan…) para consultar transacciones y direcciones.",
      long: "Muestra los datos directamente de la red, sin depender de ninguna empresa. Si el explorador dice que una transacción tuvo éxito y que el token llegó a una dirección, eso es un hecho de la red; lo que muestre después una app o un exchange depende de que esa plataforma lo reconozca y lo acredite.",
    },
    confirmaciones: {
      term: "Confirmaciones",
      short: "Bloques que se acumulan después de tu transacción; muchos servicios esperan varios antes de acreditar.",
      long: "Una transacción incluida en un bloque ya existe en la red, pero los exchanges y puentes suelen esperar un número de bloques adicionales (confirmaciones) antes de considerarla definitiva. Ese número varía según la plataforma y la red, por eso un depósito puede verse en el explorador y aún no en tu saldo.",
    },
    gas: {
      term: "Comisión de red (gas)",
      short: "Se paga en la moneda nativa de la red (ETH, POL…). Si falla, el gas gastado no se devuelve.",
      long: "Toda transacción consume gas, pagado en la moneda nativa de la red (ETH en Ethereum, Optimism, Arbitrum y Base; POL en Polygon). Si el límite de gas es insuficiente o el contrato rechaza la operación, la transacción falla: los fondos principales no se mueven, pero el gas ya consumido no se reembolsa. Con una comisión demasiado baja, la transacción puede quedar pendiente.",
    },
    nonce: {
      term: "Nonce y transacciones pendientes",
      short: "Contador de transacciones de una cuenta; una pendiente bloquea las siguientes.",
      long: "Cada cuenta numera sus transacciones. Si una queda pendiente (por ejemplo, con gas bajo), las posteriores esperan detrás. Se puede acelerar o cancelar enviando una nueva transacción con el mismo nonce y más comisión; la original queda descartada y por ella no sale ningún fondo.",
    },
    token_contrato: {
      term: "Contrato del token",
      short: "Cada token tiene una dirección de contrato propia. Dos tokens con el mismo nombre pueden ser distintos.",
      long: "El nombre o símbolo («USDC», «USDT») no identifica a un token: lo hace su dirección de contrato en cada red. Existen copias falsas o versiones distintas con el mismo nombre. Para confirmar que recibiste el token correcto hay que comparar la dirección de contrato con la publicada por el emisor.",
    },
    usdc_e: {
      term: "USDC.e y otras versiones «bridged»",
      short: "En algunas redes existen dos USDC: el nativo y el «bridged» (USDC.e). Son contratos distintos.",
      long: "En Polygon, Optimism y Arbitrum conviven el USDC nativo (emitido por Circle) y una versión anterior llevada por puentes (USDC.e). Valen lo mismo, pero son tokens diferentes: algunos exchanges, apps o pools aceptan solo una de las dos. Algo similar ocurre con algunas versiones de USDT.",
    },
    memo: {
      term: "Memo / Tag / ID de destino",
      short: "En redes como XRP, Stellar, Cosmos o TON identifica tu cuenta dentro de la dirección compartida del exchange.",
      long: "Algunos exchanges usan una única dirección para muchos clientes y distinguen a cada uno por un memo (también llamado tag o ID de destino). Si falta o está mal, el exchange recibe los fondos pero no sabe a quién acreditarlos; suele requerir soporte. Las redes EVM (Ethereum, Polygon, Base…) no usan memo: ahí cada cliente tiene su propia dirección.",
    },
    no_evm: {
      term: "Redes no compatibles con EVM",
      short: "Tron, Bitcoin, Solana, XRP y Cosmos usan formatos y redes distintas a las EVM.",
      long: "Una dirección EVM (0x…) solo sirve en redes EVM. Si se envía hacia o desde una red no EVM eligiendo mal la red o el formato, normalmente la transacción es rechazada antes de salir; cuando no lo es, el activo puede quedar en un lugar al que nadie tiene acceso. Esta herramienta solo puede verificar en cadena redes EVM soportadas.",
    },
    bridge: {
      term: "Puente (bridge)",
      short: "Mueve valor entre redes. Tiene una transacción en origen y otra en destino, y la segunda puede tardar.",
      long: "Un puente recibe tus fondos en la red de origen y entrega un activo equivalente en la red de destino. Por eso hay dos transacciones distintas con dos hashes. Que la primera tenga éxito no garantiza que la segunda ya haya ocurrido; el tiempo depende del puente y de la congestión.",
    },
    swap: {
      term: "Swap (intercambio)",
      short: "Cambia un token por otro dentro de una misma red. No mueve fondos entre redes.",
      long: "Un swap en un DEX (Uniswap, QuickSwap, Velodrome, Aerodrome…) intercambia un token por otro en la misma red y es atómico: o se completa entero o falla. El resultado queda en tu wallet en esa misma red. Para cambiar de red hace falta además un puente.",
    },
    aprobacion: {
      term: "Aprobación (approve)",
      short: "Permiso para que un contrato gaste tu token; no mueve fondos por sí sola.",
      long: "Antes de usar un swap o un puente con un token, la app pide una aprobación. Esa transacción solo autoriza el gasto; el movimiento real ocurre en una segunda transacción. Si solo se completó la aprobación, no se envió nada.",
    },
    retiro_l2: {
      term: "Retiros nativos de L2 a Ethereum",
      short: "Con el puente oficial de Optimism, Base o Arbitrum, retirar a Ethereum tarda alrededor de 7 días.",
      long: "Los puentes oficiales de Optimism, Base y Arbitrum protegen los retiros con una ventana de disputa de alrededor de 7 días y, después, una transacción final de reclamación en Ethereum. No es un fallo ni una pérdida: es el diseño de seguridad. Los puentes de terceros rápidos evitan la espera usando liquidez propia.",
    },
    slippage: {
      term: "Comisiones y deslizamiento (slippage)",
      short: "En swaps y puentes llega algo menos de lo enviado por comisiones del servicio y variación de precio.",
      long: "Los puentes y swaps cobran comisiones y, en intercambios, el precio puede moverse entre que confirmas y se ejecuta. Una diferencia pequeña entre lo enviado y lo recibido (generalmente unos pocos por ciento o menos) es normal; una diferencia grande merece revisarse.",
    },
    address_poisoning: {
      term: "Envenenamiento de direcciones (address poisoning)",
      short: "Estafa que usa direcciones casi idénticas a la tuya para que copies la equivocada del historial.",
      long: "Un atacante envía importes mínimos desde direcciones que empiezan y terminan igual que las de tus contactos, para que aparezcan en tu historial. Si copias esa dirección sin comprobarla entera, envías los fondos al atacante. Las transacciones son irreversibles. Verifica siempre la dirección completa, no solo el inicio y el final.",
    },
    checksum: {
      term: "Checksum de la dirección",
      short: "Las mayúsculas y minúsculas de una dirección EVM detectan errores de tipeo.",
      long: "El formato EIP-55 usa la combinación de mayúsculas y minúsculas como código de verificación. Si una dirección mezcla ambas y el código no coincide, hay al menos un carácter mal copiado. Las wallets serias avisan antes de enviar; una dirección toda en minúsculas no tiene esa protección.",
    },
    wallet_contrato: {
      term: "Wallet de contrato",
      short: "Cuentas inteligentes (Safe, etc.) cuya dirección puede existir solo en algunas redes.",
      long: "A diferencia de una wallet personal, una wallet de contrato es un programa desplegado en una red concreta. Su dirección puede no existir, o no estar bajo tu control, en otra red. Enviar fondos a esa misma dirección en una red donde no está desplegada puede dejarlos inaccesibles.",
    },
    custodia: {
      term: "Fondos dentro de un exchange",
      short: "En un exchange tu saldo es un registro interno; los retiros y depósitos pasan por sus carteras y revisiones.",
      long: "Mientras los fondos están en un exchange, no están en tu wallet: el exchange lleva un saldo interno. Un retiro pasa por sus sistemas (límites, verificaciones de seguridad, a veces revisión manual) antes de salir a la red. Un depósito se acredita cuando el exchange reconoce la transacción en la red, el activo y el monto correctos.",
    },
    deposito_minimo: {
      term: "Depósito mínimo",
      short: "Los exchanges suelen fijar un monto mínimo por activo y red; por debajo puede no acreditarse.",
      long: "Para cubrir costos operativos, muchas plataformas ignoran depósitos por debajo de un mínimo publicado en su página de depósito. Los fondos están en la red pero el exchange puede no acreditarlos automáticamente; a veces el soporte puede ayudar, a veces no.",
    },
    deposito_contrato: {
      term: "Depósitos hechos desde contratos",
      short: "Algunos exchanges no acreditan automáticamente depósitos enviados desde contratos inteligentes o puentes.",
      long: "Si los fondos llegan al exchange mediante un contrato (un puente, un agregador, una wallet Safe) en lugar de una transferencia directa desde una wallet personal, algunas plataformas no los detectan o no los acreditan sin intervención de soporte. Consulta las condiciones del exchange.",
    },
    tokens_no_visibles: {
      term: "Por qué una wallet no muestra un saldo",
      short: "El saldo se muestra por red; algunos tokens hay que agregarlos a mano o están ocultos.",
      long: "Las wallets muestran los saldos red por red: si estás mirando Ethereum y los fondos llegaron a Polygon, no los verás. Además, los tokens menos conocidos pueden no aparecer hasta que agregas su dirección de contrato, o quedar ocultos como posible spam. Si el explorador muestra el token en tu dirección, los fondos existen.",
    },
    irreversible: {
      term: "Las transacciones son irreversibles",
      short: "Nadie puede revertir una transacción confirmada; solo puede devolverla quien recibió los fondos.",
      long: "No existe una entidad que pueda deshacer una transacción en la blockchain. Si los fondos están en una dirección que controlas (por ejemplo, tu wallet en otra red), puedes moverlos tú. Si están en una dirección ajena, solo su dueño puede devolverlos; un exchange o servicio puede ayudar si la dirección es suya y su política lo permite.",
    },
  };

  const TRANSLATIONS = {
    red: ["Network (blockchain)", "Each network is an independent system (Ethereum, Polygon, Base…). A token sent on one network exists only on that network.", "The same asset can exist on several networks, but each copy exists only on the network where it was sent. If the destination expects network A and you send on network B, the funds remain on B, sometimes at an address the platform does not monitor. Choosing the wrong network is the most common reason funds appear not to arrive.",
      "Rede (blockchain)", "Cada rede é um sistema independente (Ethereum, Polygon, Base…). Um token enviado por uma rede só existe nela.", "O mesmo ativo pode existir em várias redes, mas cada cópia existe apenas na rede pela qual foi enviada. Se o destino espera a rede A e você envia pela rede B, os fundos permanecem na B, às vezes em um endereço que a plataforma não monitora. Escolher a rede errada é a causa mais comum de fundos que parecem não ter chegado."],
    direccion_evm: ["EVM address", "Ethereum, Polygon, Optimism, Arbitrum, Base and others share the 0x + 40-character format.", "EVM-compatible networks use the same address format, and a personal wallet usually controls the same address on all of them. If you sent to your own wallet on the wrong network, the funds are usually safe there; switch networks to see them. Non-EVM networks such as Tron, Bitcoin, Solana and XRP use different formats.", "Endereço EVM", "Ethereum, Polygon, Optimism, Arbitrum, Base e outras usam o formato 0x + 40 caracteres.", "Redes compatíveis com EVM usam o mesmo formato de endereço, e uma carteira pessoal normalmente controla o mesmo endereço em todas elas. Se você enviou para sua própria carteira na rede errada, os fundos geralmente estão seguros nessa outra rede; basta mudar de rede para vê-los. Redes não EVM, como Tron, Bitcoin, Solana e XRP, usam formatos diferentes."],
    hash: ["Transaction hash (TxID)", "The unique “receipt” for a transaction: 0x + 64 characters.", "It is the public transaction identifier. Anyone can use it in a block explorer to see whether it happened, when, on which network, the addresses involved and the amount transferred. Exchanges may call it a TxID or transaction ID. It is neutral evidence of what happened on-chain.", "Hash da transação (TxID)", "O comprovante único de uma transação: 0x + 64 caracteres.", "É o identificador público da transação. Qualquer pessoa pode usá-lo em um explorador de blocos para ver se ela ocorreu, quando, em qual rede, os endereços envolvidos e o valor transferido. Exchanges também podem chamá-lo de TxID ou ID da transação. É uma evidência neutra do que aconteceu na rede."],
    explorador: ["Block explorer", "A public site (Etherscan, Polygonscan, Basescan…) for checking transactions and addresses.", "It reads data directly from the network, independently of any company. If the explorer says a transaction succeeded and a token reached an address, that is an on-chain fact; an app or exchange must still recognize and credit it.", "Explorador de blocos", "Site público (Etherscan, Polygonscan, Basescan…) para consultar transações e endereços.", "Ele mostra dados diretamente da rede, sem depender de uma empresa. Se o explorador indica que uma transação foi concluída e um token chegou a um endereço, isso é um fato da rede; um aplicativo ou exchange ainda precisa reconhecê-lo e creditá-lo."],
    confirmaciones: ["Confirmations", "Blocks added after your transaction; many services wait for several before crediting it.", "A transaction included in a block is on-chain, but exchanges and bridges often wait for additional blocks before treating it as final. Requirements vary by platform and network, so a deposit may appear in the explorer before it appears in your balance.", "Confirmações", "Blocos adicionados após sua transação; muitos serviços aguardam vários antes de creditá-la.", "Uma transação incluída em um bloco está na rede, mas exchanges e pontes costumam aguardar blocos adicionais antes de considerá-la definitiva. Os requisitos variam por plataforma e rede, então um depósito pode aparecer no explorador antes de aparecer no saldo."],
    gas: ["Network fee (gas)", "Paid in the network’s native currency (ETH, POL…). If a transaction fails, spent gas is not refunded.", "Every transaction consumes gas, paid in the network’s native currency. If the gas limit is too low or a contract rejects the operation, the transaction fails: the principal funds do not move, but consumed gas is not refunded. A fee that is too low can leave it pending.", "Taxa de rede (gas)", "Paga na moeda nativa da rede (ETH, POL…). Se a transação falhar, o gas gasto não é devolvido.", "Toda transação consome gas, pago na moeda nativa da rede. Se o limite de gas for insuficiente ou um contrato rejeitar a operação, a transação falha: os fundos principais não se movem, mas o gas consumido não é devolvido. Uma taxa muito baixa pode deixá-la pendente."],
    nonce: ["Nonce and pending transactions", "A wallet transaction counter; one pending transaction blocks later ones.", "Accounts number their transactions. If one is pending (for example, because of low gas), later ones wait behind it. It can be sped up or cancelled by sending a new transaction with the same nonce and a higher fee; the original is discarded and sends no funds.", "Nonce e transações pendentes", "Contador de transações da conta; uma transação pendente bloqueia as seguintes.", "As contas numeram suas transações. Se uma ficar pendente (por exemplo, por gas baixo), as seguintes aguardam. É possível acelerá-la ou cancelá-la enviando outra transação com o mesmo nonce e uma taxa maior; a original é descartada e não envia fundos."],
    token_contrato: ["Token contract", "Every token has its own contract address. Two tokens with the same name may be different.", "A token is identified by its contract address on each network, not by its name or symbol. Fake copies or different versions may share a name. Compare the contract address with the issuer’s published address to confirm the token.", "Contrato do token", "Cada token tem seu próprio endereço de contrato. Dois tokens com o mesmo nome podem ser diferentes.", "Um token é identificado pelo endereço do contrato em cada rede, não pelo nome ou símbolo. Cópias falsas ou versões diferentes podem compartilhar o mesmo nome. Compare o endereço do contrato com o publicado pelo emissor para confirmar o token."],
    usdc_e: ["USDC.e and other bridged versions", "Some networks have both native and bridged USDC (USDC.e). They are different contracts.", "Polygon, Optimism and Arbitrum have native USDC issued by Circle and an older bridged version, USDC.e. They may have the same value but are different tokens; some exchanges, apps or pools accept only one. Similar variants exist for some USDT.", "USDC.e e outras versões bridged", "Algumas redes têm USDC nativo e bridged (USDC.e). São contratos diferentes.", "Polygon, Optimism e Arbitrum têm USDC nativo emitido pela Circle e uma versão bridged mais antiga, USDC.e. Podem ter o mesmo valor, mas são tokens diferentes; algumas exchanges, aplicativos ou pools aceitam apenas um deles. Há variantes semelhantes de USDT."],
    memo: ["Memo / Tag / destination ID", "On networks such as XRP, Stellar, Cosmos or TON, it identifies your account within an exchange’s shared address.", "Some exchanges use one address for many customers and distinguish accounts with a memo (also called a tag or destination ID). If it is missing or wrong, the exchange receives the funds but cannot tell whose they are; support is usually needed. EVM networks do not use memos.", "Memo / Tag / ID de destino", "Em redes como XRP, Stellar, Cosmos ou TON, identifica sua conta dentro do endereço compartilhado da exchange.", "Algumas exchanges usam um endereço para vários clientes e distinguem as contas por um memo (também chamado tag ou ID de destino). Se estiver ausente ou incorreto, a exchange recebe os fundos, mas não sabe a quem pertencem; normalmente é preciso acionar o suporte. Redes EVM não usam memo."],
    no_evm: ["Non-EVM networks", "Tron, Bitcoin, Solana, XRP and Cosmos use formats and networks different from EVM.", "An EVM address (0x…) works only on EVM networks. A wrong network or format on a non-EVM transfer usually causes rejection before sending; otherwise, assets may end up somewhere inaccessible. This tool verifies only supported EVM networks.", "Redes não EVM", "Tron, Bitcoin, Solana, XRP e Cosmos usam formatos e redes diferentes da EVM.", "Um endereço EVM (0x…) funciona apenas em redes EVM. Uma rede ou formato incorreto em uma transferência não EVM geralmente causa rejeição antes do envio; caso contrário, os ativos podem ficar inacessíveis. Esta ferramenta verifica apenas redes EVM compatíveis."],
    bridge: ["Bridge", "Moves value between networks. It has a source transaction and a destination transaction; the second may take time.", "A bridge receives funds on the source network and delivers an equivalent asset on the destination network. There are two separate transactions with two hashes. Success of the first does not mean the second has happened; timing depends on the bridge and congestion.", "Ponte (bridge)", "Move valor entre redes. Há uma transação de origem e outra de destino, e a segunda pode demorar.", "Uma ponte recebe fundos na rede de origem e entrega um ativo equivalente na rede de destino. São duas transações distintas, com dois hashes. O sucesso da primeira não significa que a segunda já ocorreu; o prazo depende da ponte e do congestionamento."],
    swap: ["Swap (exchange)", "Exchanges one token for another on the same network. It does not move funds between networks.", "A DEX swap exchanges tokens on the same network and is atomic: it either completes or fails. The result remains in your wallet on that network. Moving between networks also requires a bridge.", "Swap (troca)", "Troca um token por outro na mesma rede. Não transfere fundos entre redes.", "Um swap em uma DEX troca tokens na mesma rede e é atômico: é concluído por inteiro ou falha. O resultado permanece na sua carteira nessa rede. Para mudar de rede também é necessária uma ponte."],
    aprobacion: ["Approval (approve)", "Permission for a contract to spend your token; it does not move funds by itself.", "Before a swap or bridge, an app may request an approval. That transaction only authorizes spending; the actual transfer happens in a second transaction. If only the approval completed, nothing was sent.", "Aprovação (approve)", "Permissão para um contrato gastar seu token; por si só, não transfere fundos.", "Antes de um swap ou de uma ponte, um aplicativo pode solicitar uma aprovação. Essa transação apenas autoriza o gasto; a transferência real ocorre em uma segunda transação. Se apenas a aprovação foi concluída, nada foi enviado."],
    retiro_l2: ["Native L2-to-Ethereum withdrawals", "With the official Optimism, Base or Arbitrum bridge, withdrawing to Ethereum takes about 7 days.", "Official bridges for Optimism, Base and Arbitrum protect withdrawals with a dispute window of about 7 days, followed by a final claim transaction on Ethereum. This is a security design, not a failure or loss. Fast third-party bridges avoid the wait by using their own liquidity.", "Saques nativos de L2 para Ethereum", "Com a ponte oficial da Optimism, Base ou Arbitrum, o saque para Ethereum leva cerca de 7 dias.", "As pontes oficiais da Optimism, Base e Arbitrum protegem os saques com um período de contestação de cerca de 7 dias, seguido de uma transação final de resgate na Ethereum. É uma medida de segurança, não uma falha ou perda. Pontes rápidas de terceiros evitam a espera usando liquidez própria."],
    slippage: ["Fees and slippage", "Swaps and bridges deliver slightly less than sent due to service fees and price changes.", "Bridges and swaps charge fees; in swaps, prices can also move between confirmation and execution. A small difference (usually a few percent or less) is normal; a large one deserves review.", "Taxas e slippage", "Swaps e pontes entregam um pouco menos do que foi enviado devido às taxas do serviço e à variação de preço.", "Pontes e swaps cobram taxas; em swaps, o preço também pode mudar entre a confirmação e a execução. Uma pequena diferença (geralmente alguns por cento ou menos) é normal; uma diferença grande merece ser analisada."],
    address_poisoning: ["Address poisoning", "A scam uses addresses almost identical to yours to trick you into copying the wrong one from history.", "An attacker sends tiny amounts from addresses with the same beginning and ending as your contacts’ addresses, making them appear in history. Copying one without checking it fully sends funds to the attacker. Transactions are irreversible. Always verify the entire address.", "Envenenamento de endereços", "Golpe que usa endereços quase iguais ao seu para induzir você a copiar o endereço errado do histórico.", "Um invasor envia valores mínimos de endereços com o mesmo início e final dos endereços dos seus contatos, fazendo-os aparecer no histórico. Se você copiar um sem conferir por inteiro, enviará fundos ao invasor. As transações são irreversíveis. Sempre verifique o endereço completo."],
    checksum: ["Address checksum", "Uppercase and lowercase letters in an EVM address can detect typing errors.", "EIP-55 uses letter case as a check code. If a mixed-case address does not match, at least one character was copied incorrectly. Reputable wallets warn before sending; an all-lowercase address has no such protection.", "Checksum do endereço", "Letras maiúsculas e minúsculas em um endereço EVM podem detectar erros de digitação.", "O EIP-55 usa maiúsculas e minúsculas como código de verificação. Se um endereço misto não corresponder, pelo menos um caractere foi copiado incorretamente. Carteiras confiáveis alertam antes do envio; um endereço todo em minúsculas não tem essa proteção."],
    wallet_contrato: ["Contract wallet", "Smart accounts (Safe, etc.) whose address may exist only on some networks.", "Unlike a personal wallet, a contract wallet is a program deployed on a specific network. Its address may not exist, or may not be under your control, on another network. Sending to it where it is not deployed may make funds inaccessible.", "Carteira de contrato", "Contas inteligentes (Safe etc.) cujo endereço pode existir apenas em algumas redes.", "Ao contrário de uma carteira pessoal, uma carteira de contrato é um programa implantado em uma rede específica. Seu endereço pode não existir ou não estar sob seu controle em outra rede. Enviar para ele onde não está implantado pode tornar os fundos inacessíveis."],
    custodia: ["Funds held by an exchange", "Your exchange balance is an internal ledger entry; deposits and withdrawals go through its wallets and checks.", "Funds on an exchange are not in your wallet: the exchange keeps an internal balance. Withdrawals pass through its systems, limits and security checks before reaching the network. Deposits are credited when it recognizes the correct transaction, asset and amount.", "Fundos sob custódia de uma exchange", "Seu saldo na exchange é um registro interno; depósitos e saques passam pelas carteiras e verificações dela.", "Fundos em uma exchange não estão na sua carteira: ela mantém um saldo interno. Saques passam pelos sistemas, limites e verificações de segurança da plataforma antes de chegar à rede. Depósitos são creditados quando ela reconhece a transação, o ativo e o valor corretos."],
    deposito_minimo: ["Minimum deposit", "Exchanges often set a minimum amount per asset and network; smaller deposits may not be credited.", "Many platforms ignore deposits below a published minimum to cover operating costs. Funds remain on-chain, but the exchange may not credit them automatically; support may or may not help.", "Depósito mínimo", "Exchanges costumam definir um valor mínimo por ativo e rede; depósitos menores podem não ser creditados.", "Muitas plataformas ignoram depósitos abaixo do mínimo publicado para cobrir custos operacionais. Os fundos permanecem na rede, mas a exchange pode não creditá-los automaticamente; o suporte pode ou não ajudar."],
    deposito_contrato: ["Deposits sent from contracts", "Some exchanges do not automatically credit deposits sent from smart contracts or bridges.", "If funds reach an exchange through a contract (bridge, aggregator or Safe wallet) rather than a direct personal-wallet transfer, the platform may not detect or credit them without support intervention. Check its terms.", "Depósitos enviados por contratos", "Algumas exchanges não creditam automaticamente depósitos enviados por contratos inteligentes ou pontes.", "Se os fundos chegam à exchange por um contrato (ponte, agregador ou carteira Safe), em vez de uma transferência direta de uma carteira pessoal, a plataforma pode não detectá-los ou creditá-los sem intervenção do suporte. Consulte as regras da exchange."],
    tokens_no_visibles: ["Why a wallet may not show a balance", "Balances are shown per network; some tokens must be added manually or may be hidden.", "Wallets show balances network by network: funds on Polygon will not appear while viewing Ethereum. Less-known tokens may need to be added by contract address or may be hidden as spam. If the explorer shows the token at your address, the funds exist.", "Por que uma carteira pode não mostrar o saldo", "Os saldos são exibidos por rede; alguns tokens precisam ser adicionados manualmente ou podem estar ocultos.", "Carteiras mostram saldos por rede: fundos na Polygon não aparecem quando você está vendo Ethereum. Tokens menos conhecidos talvez precisem ser adicionados pelo endereço do contrato ou podem estar ocultos como spam. Se o explorador mostra o token no seu endereço, os fundos existem."],
    irreversible: ["Transactions are irreversible", "No one can reverse a confirmed transaction; only the recipient can return the funds.", "There is no authority that can undo a blockchain transaction. If funds are at an address you control, you can move them. If they are at someone else’s address, only that owner can return them; an exchange or service may help if the address is theirs and its policy allows it.", "As transações são irreversíveis", "Ninguém pode reverter uma transação confirmada; somente quem recebeu pode devolver os fundos.", "Não existe uma entidade capaz de desfazer uma transação na blockchain. Se os fundos estão em um endereço que você controla, pode movê-los. Se estão no endereço de outra pessoa, somente o titular pode devolvê-los; uma exchange ou serviço pode ajudar se o endereço for dela e a política permitir."],
  };

  function conceptsFor(ids) {
    const out = [];
    const seen = new Set();
    for (const id of ids || []) {
      if (seen.has(id) || !CONCEPTS[id]) continue;
      seen.add(id);
      const base = CONCEPTS[id];
      const tr = TRANSLATIONS[id];
      const loc = locale();
      out.push({ id, ...(loc === "en" && tr ? { term: tr[0], short: tr[1], long: tr[2] } : loc === "pt" && tr ? { term: tr[3], short: tr[4], long: tr[5] } : base) });
    }
    return out;
  }

  Object.assign(K, { CONCEPTS, conceptsFor });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
