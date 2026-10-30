"""Prueba manual de lectura JSON-RPC y detección local de bridges en Alchemy.

Configura ALCHEMY_API_KEY como variable de entorno o ingrésala en el prompt.
No guardes la API key en este archivo ni la compartas en salidas de consola.
"""

import getpass
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests


CHAINS: Dict[str, Dict[str, str]] = {
    "Ethereum": {"slug": "eth-mainnet"},
    "Arbitrum": {"slug": "arb-mainnet"},
    "Optimism": {"slug": "opt-mainnet"},
    "Base": {"slug": "base-mainnet"},
    "Polygon": {"slug": "polygon-mainnet"},
}

# Direcciones conocidas para diagnóstico indicativo. Verifica los despliegues
# con la documentación del protocolo; una coincidencia no prueba entrega destino.
BRIDGE_CATALOG: Dict[str, Dict[str, Dict[str, str]]] = {
    "Ethereum": {
        "0x5d22045daceab03b158031ecb7d9d06fad24609b": {
            "name": "Rhino.fi StarkEx Proxy (candidato)",
            "protocol": "Rhino.fi",
            "type": "StarkEx Proxy",
        },
        "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
            "name": "LI.FI Diamond",
            "protocol": "LI.FI",
            "type": "Cross-chain Aggregator",
        },
        "0x3a23f943181408eac424116af7b7790c94cb97a5": {
            "name": "Socket Gateway",
            "protocol": "Socket",
            "type": "Cross-chain Router",
        },
        "0xfbc81a18ecda8e6a91275cfdf5fc6d91a7c5ae80": {
            "name": "Across SpokePool",
            "protocol": "Across Protocol",
            "type": "SpokePool",
        },
        "0x8731d54e9d02c286767d56ac03e8037c07e01e98": {
            "name": "Stargate V1 Router",
            "protocol": "Stargate",
            "type": "Router",
        },
        "0x150f94b44927f078737562f0fcf3c95c01cc2376": {
            "name": "Stargate V1 RouterETH",
            "protocol": "Stargate",
            "type": "Native-asset Router",
        },
        "0xb1b2eef380f21747944f46d28f683cd1fbb4d03c": {
            "name": "Stargate V1 RouterETH with Payload",
            "protocol": "Stargate",
            "type": "Payload Router",
        },
        "0x296f55f8fb28e498b858d0bcda06d955b2cb3f97": {
            "name": "Stargate V1 Bridge",
            "protocol": "Stargate",
            "type": "Bridge",
        },
        "0x77b2043768d28e9c9ab44e1abfc95944bce57931": {
            "name": "Stargate V2 Native Pool",
            "protocol": "Stargate",
            "type": "Native Pool",
        },
        "0xc026395860db2d07ee33e05fe50ed7bd583189c7": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x933597a323eb81cae705c5bc29985172fd5a3973": {
            "name": "Stargate V2 USDT Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x3666f603cc164936c1b87e207f36beba4ac5f18a": {
            "name": "Hop USDC L1 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0x3e4a3a4796d16c0cd582c382691998f7c06420b6": {
            "name": "Hop USDT L1 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0x841ce48f9446c8e281d3f1444cb859b4a6d0738c": {
            "name": "Celer cBridge",
            "protocol": "Celer cBridge",
            "type": "Liquidity Bridge",
        },
        "0x1a44076050125825900e736c501f859c50fe728c": {
            "name": "LayerZero V2 Endpoint",
            "protocol": "LayerZero",
            "type": "Messaging Endpoint",
        },
        "0xbeb5fc579115071764c7423a4f12edde41f106ed": {
            "name": "Optimism Portal",
            "protocol": "Optimism Native Bridge",
            "type": "L1 Portal",
        },
        "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1": {
            "name": "Optimism L1 Standard Bridge",
            "protocol": "Optimism Native Bridge",
            "type": "L1 Standard Bridge",
        },
        "0x49048044d57e1c92a77f79988d21fa8faf74e97e": {
            "name": "Base L1 Portal",
            "protocol": "Base Native Bridge",
            "type": "L1 Portal",
        },
        "0x3154cf16ccdb4c6d922629664174b904d80f2c35": {
            "name": "Base L1 Standard Bridge",
            "protocol": "Base Native Bridge",
            "type": "L1 Standard Bridge",
        },
        "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f": {
            "name": "Arbitrum One Inbox",
            "protocol": "Arbitrum Native Bridge",
            "type": "L1 Inbox",
        },
        "0x72ce9c846789fdb6fc1f34ac4ad25dd9ef7031ef": {
            "name": "Arbitrum One L1 Gateway Router",
            "protocol": "Arbitrum Native Bridge",
            "type": "L1 Gateway Router",
        },
        "0xa3a7b6f88361f48403514059f1f16c8e78d60eec": {
            "name": "Arbitrum One L1 ERC-20 Gateway",
            "protocol": "Arbitrum Native Bridge",
            "type": "L1 Token Gateway",
        },
        "0xcee284f754e854890e311e3280b767f80797180d": {
            "name": "Arbitrum One L1 Custom Gateway",
            "protocol": "Arbitrum Native Bridge",
            "type": "L1 Custom Token Gateway",
        },
        "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a": {
            "name": "Arbitrum One L1 Bridge",
            "protocol": "Arbitrum Native Bridge",
            "type": "Rollup Bridge",
        },
        "0xa0c68c638235ee32657e8f720a23cec1bfc77c77": {
            "name": "Polygon PoS RootChainManager",
            "protocol": "Polygon Native Bridge",
            "type": "RootChainManager",
        },
        "0x401f6c983ea34274ec46f84d70b31c151321188b": {
            "name": "Polygon PoS DepositManager",
            "protocol": "Polygon Native Bridge",
            "type": "L1 Deposit Manager",
        },
        "0x2a88696e0ffa76baa1338f2c74497cc013495922": {
            "name": "Polygon PoS WithdrawManager",
            "protocol": "Polygon Native Bridge",
            "type": "L1 Withdraw Manager",
        },
    },
    "Arbitrum": {
        "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
            "name": "LI.FI Diamond",
            "protocol": "LI.FI",
            "type": "Cross-chain Aggregator",
        },
        "0x3a23f943181408eac424116af7b7790c94cb97a5": {
            "name": "Socket Gateway",
            "protocol": "Socket",
            "type": "Cross-chain Router",
        },
        "0x2a5a4ed1220f64714d4a7c3b3bd6188957764c9a": {
            "name": "Across SpokePool",
            "protocol": "Across Protocol",
            "type": "SpokePool",
        },
        "0x53bf833a5d6c4dda888f69c22c88c9f356a41614": {
            "name": "Stargate V1 Router",
            "protocol": "Stargate",
            "type": "Router",
        },
        "0xbf22f0f184bccbea268df387a49ff5238dd23e40": {
            "name": "Stargate V1 RouterETH",
            "protocol": "Stargate",
            "type": "Native-asset Router",
        },
        "0x352d8275aae3e0c2404d9f68f6cee084b5beb3dd": {
            "name": "Stargate V1 Bridge",
            "protocol": "Stargate",
            "type": "Bridge",
        },
        "0x892785f33cdee22a30aef750f285e18c18040c3e": {
            "name": "Stargate V1 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0xb6cfcf89a7b22988bfc96632ac2a9d6dab60d641": {
            "name": "Stargate V1 USDT Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0xe8cdf27acd73a434d661c84887215f7598e7d0d3": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x0e0e3d2c5c292161999474247956ef542cabf8dd": {
            "name": "Hop USDC L2 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0xe22d2bedb3eca35e6397e0c6d62857094aa26f52": {
            "name": "Hop USDC AMM Wrapper",
            "protocol": "Hop Protocol",
            "type": "AMM Wrapper",
        },
        "0x10541b07d8ad2647dc6cd67abd4c03575dade261": {
            "name": "Hop USDC Saddle Swap",
            "protocol": "Hop Protocol",
            "type": "AMM Swap",
        },
        "0x841ce48f9446c8e281d3f1444cb859b4a6d0738c": {
            "name": "Celer cBridge",
            "protocol": "Celer cBridge",
            "type": "Liquidity Bridge",
        },
        "0x1a44076050125825900e736c501f859c50fe728c": {
            "name": "LayerZero V2 Endpoint",
            "protocol": "LayerZero",
            "type": "Messaging Endpoint",
        },
        "0x0000000000000000000000000000000000000064": {
            "name": "Arbitrum ArbSys",
            "protocol": "Arbitrum Native Bridge",
            "type": "L2 System Precompile",
        },
        "0x5288c571fd7ad117bea99bf60fe0846c4e84f933": {
            "name": "Arbitrum L2 Gateway Router",
            "protocol": "Arbitrum Native Bridge",
            "type": "L2 Gateway Router",
        },
        "0x09e9222e96e7b4ae2a407b98d48e330053351eee": {
            "name": "Arbitrum L2 ERC-20 Gateway",
            "protocol": "Arbitrum Native Bridge",
            "type": "L2 Token Gateway",
        },
        "0x096760f208390250649e3e8763348e783aef5562": {
            "name": "Arbitrum L2 Custom Gateway",
            "protocol": "Arbitrum Native Bridge",
            "type": "L2 Custom Token Gateway",
        },
    },
    "Optimism": {
        "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
            "name": "LI.FI Diamond",
            "protocol": "LI.FI",
            "type": "Cross-chain Aggregator",
        },
        "0x3a23f943181408eac424116af7b7790c94cb97a5": {
            "name": "Socket Gateway",
            "protocol": "Socket",
            "type": "Cross-chain Router",
        },
        "0xd51099ac551350bf3198c69104b5dc4694b3a536": {
            "name": "Across SpokePool",
            "protocol": "Across Protocol",
            "type": "SpokePool",
        },
        "0xb49c4e680174e331cb0a7ff3ab58afc9738d5f8b": {
            "name": "Stargate V1 RouterETH",
            "protocol": "Stargate",
            "type": "Native-asset Router",
        },
        "0xce8cca271ebc0533920c83d39f417ed6a0abb7d0": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0xa81d244a1814468c734e5b4101f7b9c0c577a8fc": {
            "name": "Hop USDC L2 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0x3c0ffaca566fccfd9cc95139fef6cba143795963": {
            "name": "Hop USDC Saddle Swap",
            "protocol": "Hop Protocol",
            "type": "AMM Swap",
        },
        "0x2ad09850b0ca4c7c1b33f5acd6cbabcab5d6e796": {
            "name": "Hop USDC AMM Wrapper",
            "protocol": "Hop Protocol",
            "type": "AMM Wrapper",
        },
        "0x1a44076050125825900e736c501f859c50fe728c": {
            "name": "LayerZero V2 Endpoint",
            "protocol": "LayerZero",
            "type": "Messaging Endpoint",
        },
        "0x4200000000000000000000000000000000000010": {
            "name": "Optimism L2 Standard Bridge",
            "protocol": "Optimism Native Bridge",
            "type": "L2 Standard Bridge",
        },
    },
    "Base": {
        "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
            "name": "LI.FI Diamond",
            "protocol": "LI.FI",
            "type": "Cross-chain Aggregator",
        },
        "0x3a23f943181408eac424116af7b7790c94cb97a5": {
            "name": "Socket Gateway",
            "protocol": "Socket",
            "type": "Cross-chain Router",
        },
        "0x6c99671b249af73b2847d92123d823cb3875e399": {
            "name": "Across SpokePool",
            "protocol": "Across Protocol",
            "type": "SpokePool",
        },
        "0x27a16dc786820b16e5c9028b75b99f6f604b5d26": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x46ae9bab8cea96610807a275ebd36f8e916b5c61": {
            "name": "Hop USDC L2 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0x7d269d3e0d61a05a0ba976b7dbf8805bf844af3f": {
            "name": "Hop USDC AMM Wrapper",
            "protocol": "Hop Protocol",
            "type": "AMM Wrapper",
        },
        "0x022c5ce6f1add7423268d41e08df521d5527c2a0": {
            "name": "Hop USDC Saddle Swap",
            "protocol": "Hop Protocol",
            "type": "AMM Swap",
        },
        "0x1a44076050125825900e736c501f859c50fe728c": {
            "name": "LayerZero V2 Endpoint",
            "protocol": "LayerZero",
            "type": "Messaging Endpoint",
        },
        "0x4200000000000000000000000000000000000010": {
            "name": "Base L2 Standard Bridge",
            "protocol": "Base Native Bridge",
            "type": "L2 Standard Bridge",
        },
    },
    "Polygon": {
        "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
            "name": "LI.FI Diamond",
            "protocol": "LI.FI",
            "type": "Cross-chain Aggregator",
        },
        "0x3a23f943181408eac424116af7b7790c94cb97a5": {
            "name": "Socket Gateway",
            "protocol": "Socket",
            "type": "Cross-chain Router",
        },
        "0xa0c68c638235ee32657e8f720a23cec1bfc77c77": {
            "name": "Polygon PoS ChildChainManager (candidato)",
            "protocol": "Polygon Native Bridge",
            "type": "Child-chain bridge manager",
        },
        "0x68ec189ca4d950d960bb59b56742ec292e7d2c17": {
            "name": "Across SpokePool",
            "protocol": "Across Protocol",
            "type": "SpokePool",
        },
        "0x45a01e4e04f14f7a4a6702c74187c5f6222033cd": {
            "name": "Stargate V1 Router",
            "protocol": "Stargate",
            "type": "Router",
        },
        "0x9d1b1669c73b033dfe47ae5a0164ab96df25b944": {
            "name": "Stargate V1 Bridge",
            "protocol": "Stargate",
            "type": "Bridge",
        },
        "0x1205f31718499dbf1fca446663b532ef87481fe1": {
            "name": "Stargate V1 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x29e38769f23701a2e4a8ef0492e19da4604be62c": {
            "name": "Stargate V1 USDT Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x841ce48f9446c8e281d3f1444cb859b4a6d0738c": {
            "name": "Celer cBridge",
            "protocol": "Celer cBridge",
            "type": "Liquidity Bridge",
        },
        "0x1a44076050125825900e736c501f859c50fe728c": {
            "name": "LayerZero V2 Endpoint",
            "protocol": "LayerZero",
            "type": "Messaging Endpoint",
        },
        "0x9aa02d4fae7f58b8e8f34c66e756cc734dac7fe4": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool",
        },
        "0x25d8039bb044dc227f741a9e381ca4ceae2e6ae8": {
            "name": "Hop USDC L2 Bridge",
            "protocol": "Hop Protocol",
            "type": "Bridge",
        },
        "0x5c32143c8b198f392d01f8446b754c181224ac26": {
            "name": "Hop USDC Saddle Swap",
            "protocol": "Hop Protocol",
            "type": "AMM Swap",
        },
        "0x76b22b8c1079a44f1211d867d68b1eda76a635a7": {
            "name": "Hop USDC AMM Wrapper",
            "protocol": "Hop Protocol",
            "type": "AMM Wrapper",
        },
    },
}

ALCHEMY_URL_TEMPLATE = "https://{slug}.g.alchemy.com/v2/{api_key}"
EXAMPLE_TX_HASH = "0x8f321d28373b5a7776595471d491f2e1a38f32b85d95392cf99222c15984632b"
TX_HASH_PATTERN = re.compile(r"^0x[a-fA-F0-9]{64}$")
ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")
HTTP_TIMEOUT_SECONDS = 12


def addresses_in_hex_payload(value: Any) -> List[str]:
    """Return address-shaped values found in raw hex or ABI-padded words."""
    if not isinstance(value, str):
        return []
    payload = value[2:] if value.startswith("0x") else value
    if not payload or re.fullmatch(r"[a-fA-F0-9]+", payload) is None:
        return []

    addresses: List[str] = []
    seen = set()

    def add_address(address: str) -> None:
        normalized = "0x" + address[-40:].lower()
        if normalized not in seen:
            seen.add(normalized)
            addresses.append(normalized)

    alignments = (0, 8) if len(payload) % 64 == 8 else (0,)
    for alignment in alignments:
        for offset in range(alignment, len(payload) - 63, 64):
            word = payload[offset : offset + 64]
            if word[:24] == "0" * 24:
                add_address(word[-40:])
    for match in re.finditer(
        r"(?<![a-fA-F0-9])([a-fA-F0-9]{40})(?![a-fA-F0-9])",
        payload,
    ):
        add_address(match.group(1))
    return addresses


def find_bridge_matches(
    chain_name: str,
    transaction: Optional[Dict[str, Any]],
    receipt: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Match catalog contracts in transaction.to/input and receipt logs."""
    catalog = BRIDGE_CATALOG[chain_name]
    evidence_by_address: Dict[str, List[str]] = {}

    def add_evidence(address: str, source: str) -> None:
        normalized = address.lower()
        if normalized in catalog:
            evidence_by_address.setdefault(normalized, [])
            if source not in evidence_by_address[normalized]:
                evidence_by_address[normalized].append(source)

    if transaction:
        transaction_to = transaction.get("to")
        if isinstance(transaction_to, str) and ADDRESS_PATTERN.fullmatch(transaction_to):
            add_evidence(transaction_to, "tx.to")
        for address in addresses_in_hex_payload(transaction.get("input")):
            add_evidence(address, "tx.input")

    logs = receipt.get("logs", []) if receipt else []
    if isinstance(logs, list):
        for log in logs:
            if not isinstance(log, dict):
                continue
            emitter = log.get("address")
            if isinstance(emitter, str) and ADDRESS_PATTERN.fullmatch(emitter):
                add_evidence(emitter, "log.address")
            topics = log.get("topics", [])
            if isinstance(topics, list):
                for topic in topics:
                    for address in addresses_in_hex_payload(topic):
                        add_evidence(address, "log.topic")
            for address in addresses_in_hex_payload(log.get("data")):
                add_evidence(address, "log.data")

    return [
        {
            "address": address,
            "evidence": evidence_by_address[address],
            **catalog[address],
        }
        for address in evidence_by_address
    ]


def rpc_call(
    chain_name: str,
    api_key: str,
    method: str,
    tx_hash: str,
) -> Tuple[Optional[int], Any, Optional[str]]:
    """Call one Alchemy JSON-RPC method and preserve its HTTP status."""
    endpoint = ALCHEMY_URL_TEMPLATE.format(
        slug=CHAINS[chain_name]["slug"],
        api_key=api_key,
    )
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": [tx_hash],
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; BridgeCatalogCheck/1.0)",
    }

    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except requests.Timeout:
        return None, None, f"Timeout después de {HTTP_TIMEOUT_SECONDS} segundos"
    except requests.RequestException as error:
        return None, None, f"Error de conexión: {error}"

    try:
        body = response.json()
    except ValueError:
        return response.status_code, None, "El nodo devolvió una respuesta no JSON"

    if not response.ok:
        return response.status_code, body, f"Error HTTP {response.status_code}"
    if not isinstance(body, dict):
        return response.status_code, None, "Respuesta JSON-RPC con formato inesperado"
    if body.get("error"):
        error = body["error"]
        if isinstance(error, dict):
            message = str(error.get("message", error))
        else:
            message = str(error)
        return response.status_code, None, f"Error JSON-RPC: {message}"
    if "result" not in body:
        return response.status_code, None, "La respuesta no contiene el campo result"
    return response.status_code, body["result"], None


def prompt_chain() -> str:
    chain_names = list(CHAINS)
    print("Red de origen:")
    for index, name in enumerate(chain_names, start=1):
        default_mark = " (predeterminada)" if name == "Polygon" else ""
        print(f"  {index}. {name}{default_mark}")
    choice = input("Selecciona una red [5]: ").strip() or "5"
    if not choice.isdigit() or not 1 <= int(choice) <= len(chain_names):
        raise ValueError("Selección de red inválida.")
    return chain_names[int(choice) - 1]


def main() -> int:
    print("=== Prueba de catálogo Bridge + Alchemy JSON-RPC ===")
    try:
        chain_name = prompt_chain()
    except ValueError as error:
        print(f"Error: {error}")
        return 2

    api_key = os.environ.get("ALCHEMY_API_KEY", "").strip()
    if not api_key:
        api_key = getpass.getpass("API Key de Alchemy (entrada oculta): ").strip()
    if not api_key:
        print("Error: configura ALCHEMY_API_KEY o ingresa una API key.")
        return 2

    default_hash = os.environ.get("TEST_TX_HASH", EXAMPLE_TX_HASH).strip()
    tx_hash = input(f"Hash de origen [{default_hash}]: ").strip() or default_hash
    if not TX_HASH_PATTERN.fullmatch(tx_hash):
        print("Error: el hash debe tener formato 0x seguido por 64 caracteres hex.")
        return 2

    print(f"\nRed seleccionada: {chain_name}")
    print(f"TxHash: {tx_hash}")
    print("Consultando Alchemy (la API key no se imprime)...\n")

    tx_http, transaction, tx_error = rpc_call(
        chain_name,
        api_key,
        "eth_getTransactionByHash",
        tx_hash,
    )
    receipt_http, receipt, receipt_error = rpc_call(
        chain_name,
        api_key,
        "eth_getTransactionReceipt",
        tx_hash,
    )

    print(f"eth_getTransactionByHash - Status Code HTTP: {tx_http or 'sin respuesta'}")
    if tx_error:
        print(f"  Resultado: {tx_error}")
    elif transaction is None:
        print("  Resultado: transacción no encontrada o aún no disponible.")
    elif isinstance(transaction, dict):
        print(
            "  Transacción leída: sí; "
            f"from={transaction.get('from')}, to={transaction.get('to')}"
        )
    else:
        print("  Resultado: formato de transacción inesperado.")

    print(f"eth_getTransactionReceipt - Status Code HTTP: {receipt_http or 'sin respuesta'}")
    if receipt_error:
        print(f"  Resultado: {receipt_error}")
    elif receipt is None:
        print("  Resultado: recibo pendiente/no encontrado; todavía no hay logs que revisar.")
    elif isinstance(receipt, dict):
        logs = receipt.get("logs", [])
        if not isinstance(logs, list):
            logs = []
        print(
            "  Recibo leído: sí; "
            f"status={receipt.get('status')}, logs={len(logs)}"
        )
    else:
        print("  Resultado: formato de recibo inesperado.")

    valid_transaction = transaction if isinstance(transaction, dict) else None
    valid_receipt = receipt if isinstance(receipt, dict) else None
    matches = find_bridge_matches(chain_name, valid_transaction, valid_receipt)

    print("\n--- Resultado de detección ---")
    if matches:
        print(f"Bridge/router detectado(s): {len(matches)}")
        for match in matches:
            print(
                f"- {match['name']} ({match['protocol']} / {match['type']})\n"
                f"  Dirección: {match['address']}\n"
                f"  Evidencia: {', '.join(match['evidence'])}"
            )
    else:
        print("Bridge/router detectado: ninguno en el catálogo local.")

    if valid_receipt is not None:
        logs = valid_receipt.get("logs", [])
        if isinstance(logs, list):
            print(f"Lectura de logs: OK ({len(logs)} logs examinados).")
        else:
            print("Lectura de logs: respuesta recibida, pero el campo logs no es una lista.")
    elif receipt_error:
        print("Lectura de logs: no disponible por error al consultar el recibo.")
    else:
        print("Lectura de logs: no disponible; no se obtuvo un recibo.")

    if tx_error or receipt_error:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())