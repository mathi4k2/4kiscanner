/* 4kiscan · concepts.js
 * Glosario en lenguaje claro. El evaluador devuelve ids de conceptos relevantes y
 * la interfaz los muestra como explicaciones desplegables para el cliente.
 */
(function () {
  "use strict";
  const K = (globalThis.Kiscan = globalThis.Kiscan || {});

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

  function conceptsFor(ids) {
    const out = [];
    const seen = new Set();
    for (const id of ids || []) {
      if (seen.has(id) || !CONCEPTS[id]) continue;
      seen.add(id);
      out.push({ id, ...CONCEPTS[id] });
    }
    return out;
  }

  Object.assign(K, { CONCEPTS, conceptsFor });
  if (typeof module !== "undefined" && module.exports) module.exports = K;
})();
