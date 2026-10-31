"""4kiscan Streamlit app for reviewing EVM transactions through Alchemy JSON-RPC."""

import html
import json
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote

import requests
import streamlit as st
import streamlit.components.v1 as components
from streamlit.errors import StreamlitSecretNotFoundError


st.set_page_config(
    page_title="4kiscan",
    page_icon="🔎",
    layout="centered",
)

st.markdown(
    """
    <style>
    .traffic-box {
        padding: 1.1rem;
        border-radius: .75rem;
        margin: 1rem 0;
        font-weight: 600;
    }
    .traffic-green { background: #ecfdf5; border: 2px solid #10b981; color: #065f46; }
    .traffic-yellow { background: #fffbeb; border: 2px solid #f59e0b; color: #92400e; }
    .traffic-bridge { background: #fffbea; border: 2px solid #eab308; color: #854d0e; }
    .traffic-red { background: #fef2f2; border: 2px solid #ef4444; color: #991b1b; }
    .traffic-icon { font-size: 1.5rem; margin-right: .5rem; }
    </style>
    """,
    unsafe_allow_html=True,
)


CHAINS: Dict[str, Dict[str, Any]] = {
    "Polygon": {
        "alchemy_slug": "polygon-mainnet",
        "native_symbol": "POL",
        "average_block_time": 2.0,
    },
    "Ethereum": {
        "alchemy_slug": "eth-mainnet",
        "native_symbol": "ETH",
        "average_block_time": 12.0,
    },
    "Optimism": {
        "alchemy_slug": "opt-mainnet",
        "native_symbol": "ETH",
        "average_block_time": 2.0,
    },
    "Arbitrum": {
        "alchemy_slug": "arb-mainnet",
        "native_symbol": "ETH",
        "average_block_time": 0.25,
    },
    "Base": {
        "alchemy_slug": "base-mainnet",
        "native_symbol": "ETH",
        "average_block_time": 2.0,
    },
}

BLOCK_EXPLORER_BASE_URLS: Dict[str, str] = {
    "Polygon": "https://polygonscan.com",
    "Ethereum": "https://etherscan.io",
    "Optimism": "https://optimistic.etherscan.io",
    "Arbitrum": "https://arbiscan.io",
    "Base": "https://basescan.org",
}

RADAR_WINDOWS_SECONDS = (
    ("1 minute", 60),
    ("5 minutes", 5 * 60),
    ("30 minutes", 30 * 60),
    ("4 hours", 4 * 60 * 60),
    ("48 hours", 48 * 60 * 60),
)
RADAR_MAX_PAGES_PER_WINDOW = 5
RADAR_MIN_RECEIVED_PERCENT = 97
TOKEN_EQUIVALENCE_GROUPS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "USDC": {
        "Ethereum": {"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6},
        "Polygon": {
            "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6,
            "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": 6,
        },
        "Optimism": {
            "0x0b2c639c533813f4aa9d7837caf62653d097ff85": 6,
            "0x7f5c764cbc14f9669b88837ca1490cca17c31607": 6,
        },
        "Arbitrum": {
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 6,
            "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": 6,
        },
        "Base": {"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6},
    },
    "USDT": {
        "Ethereum": {"0xdac17f958d2ee523a2206206994597c13d831ec7": 6},
        "Polygon": {
            "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": 6,
            "0x9417669fbf23357d2774e9d421307bd5ea1006d2": 6,
        },
        "Optimism": {
            "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": 6,
            "0x01bff41798a0bcf287b996046ca68b395dbc1071": 6,
        },
        "Arbitrum": {"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 6},
        "Base": {"0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": 6},
    },
    "WETH": {
        "Ethereum": {"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18},
        "Polygon": {"0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 18},
        "Optimism": {"0x4200000000000000000000000000000000000006": 18},
        "Arbitrum": {"0x82af49447d8a07e3bd95bd0d56f35241523fbab1": 18},
        "Base": {"0x4200000000000000000000000000000000000006": 18},
    },
    "eETH": {
        "Ethereum": {"0x35fa164735182de50811e8e2e824cfb9b6118ac2": 18},
    },
    "weETH": {
        "Ethereum": {"0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": 18},
        "Optimism": {"0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff": 18},
        "Arbitrum": {"0x35751007a407ca6feffe80b3cb397736d2cf4dbe": 18},
        "Base": {"0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": 18},
    },
}

# Direcciones conocidas y candidatos de soporte; validar despliegues antes de
# tratar una coincidencia como prueba de ruta o entrega.
BRIDGE_CATALOG: Dict[str, Dict[str, Dict[str, str]]] = {
    "Ethereum": {
        "0x5d22045daceab03b158031ecb7d9d06fad24609b": {
            "name": "Rhino.fi StarkEx Proxy (candidate)",
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
            "type": "Router / LayerZero V1",
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
            "type": "Native Pool / LayerZero V2",
        },
        "0xc026395860db2d07ee33e05fe50ed7bd583189c7": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool / LayerZero V2",
        },
        "0x933597a323eb81cae705c5bc29985172fd5a3973": {
            "name": "Stargate V2 USDT Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool / LayerZero V2",
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
        "0x7e77461ca2a9d82d26fd5e0da2243bf72ea45747": {
            "name": "Hop USDC CCTP Bridge",
            "protocol": "Hop Protocol",
            "type": "CCTP Bridge",
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
            "name": "Polygon PoS ChildChainManager (candidate)",
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
            "type": "Router / LayerZero V1",
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
            "type": "Liquidity Pool / LayerZero V2",
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
        "0xce8cca271ebc0533920c83d39f417ed6a0abb7d0": {
            "name": "Stargate V2 USDC Pool",
            "protocol": "Stargate",
            "type": "Liquidity Pool / LayerZero V2",
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
            "type": "Router / LayerZero V1",
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
            "type": "Liquidity Pool / LayerZero V2",
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
            "type": "Liquidity Pool / LayerZero V2",
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
}

ALCHEMY_ENDPOINT_TEMPLATE = "https://{slug}.g.alchemy.com/v2/{api_key}"
DEFILLAMA_HISTORICAL_PRICE_URL = (
    "https://coins.llama.fi/prices/historical/{timestamp}/{coin_id}"
)
DEFILLAMA_CHAIN_IDS = {
    "Polygon": "polygon",
    "Ethereum": "ethereum",
    "Optimism": "optimism",
    "Arbitrum": "arbitrum",
    "Base": "base",
}
DEFILLAMA_NATIVE_COIN_IDS = {
    "Ethereum": "coingecko:ethereum",
    "Optimism": "coingecko:ethereum",
    "Arbitrum": "coingecko:ethereum",
    "Base": "coingecko:ethereum",
    "Polygon": "coingecko:polygon-ecosystem-token",
}
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TX_HASH_PATTERN = re.compile(r"^0x[a-fA-F0-9]{64}$")
ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")
HTTP_TIMEOUT_SECONDS = 12
DEFILLAMA_TIMEOUT_SECONDS = 10
SWAP_MIN_VALUE_PERCENT = Decimal("85")
SWAP_MAX_VALUE_PERCENT = Decimal("98")


class RpcError(Exception):
    """Readable error raised while querying Alchemy JSON-RPC."""


def get_alchemy_api_key() -> str:
    """Read the Alchemy API key from Streamlit secrets without exposing it in the UI."""
    try:
        secret_api_key = st.secrets.get("ALCHEMY_API_KEY", "")
    except StreamlitSecretNotFoundError:
        secret_api_key = ""
    if isinstance(secret_api_key, str) and secret_api_key.strip():
        return secret_api_key.strip()
    return os.environ.get("ALCHEMY_API_KEY", "").strip()


class DefiLlamaError(Exception):
    """Readable error raised while requesting historical DefiLlama prices."""


@st.cache_data(ttl=3600, max_entries=512)
def fetch_defillama_historical_price(
    timestamp: int,
    coin_id: str,
) -> Optional[float]:
    """Return a cached historical USD price from the public DefiLlama Coins API."""
    url = DEFILLAMA_HISTORICAL_PRICE_URL.format(
        timestamp=timestamp,
        coin_id=quote(coin_id, safe=":"),
    )
    try:
        response = requests.get(url, timeout=DEFILLAMA_TIMEOUT_SECONDS)
        response.raise_for_status()
    except requests.Timeout as error:
        raise DefiLlamaError(
            f"DefiLlama did not respond within {DEFILLAMA_TIMEOUT_SECONDS} seconds."
        ) from error
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        raise DefiLlamaError(
            f"DefiLlama returned HTTP {status} while looking up a historical price."
        ) from error
    except requests.RequestException as error:
        raise DefiLlamaError(
            "Could not connect to DefiLlama for historical token pricing."
        ) from error

    try:
        data = response.json()
    except ValueError as error:
        raise DefiLlamaError("DefiLlama returned an invalid JSON response.") from error
    if not isinstance(data, dict):
        raise DefiLlamaError("DefiLlama returned an unexpected price response.")
    coins = data.get("coins")
    coin_data = coins.get(coin_id) if isinstance(coins, dict) else None
    if not isinstance(coin_data, dict):
        return None

    raw_price = coin_data.get("price")
    if isinstance(raw_price, bool) or not isinstance(raw_price, (int, float)):
        return None
    price = float(raw_price)
    if not Decimal(str(price)).is_finite() or price <= 0:
        return None
    return price


def show_rpc_error(error: RpcError) -> None:
    message = str(error)
    if (
        "Alchemy authentication" in message
        or "HTTP 404" in message
        or "could not find the request" in message
        or "Transaction not found" in message
    ):
        st.warning(message)
    else:
        st.error(message)


def alchemy_rpc(
    chain_name: str,
    api_key: str,
    method: str,
    params: List[Any],
) -> Any:
    """Execute a JSON-RPC call against the selected network's Alchemy endpoint."""
    chain = CHAINS.get(chain_name)
    if chain is None:
        raise RpcError("The selected network is not configured for Alchemy.")

    clean_api_key = api_key.strip()
    if not clean_api_key:
        raise RpcError("The Alchemy API key is empty.")
    if any(character.isspace() for character in clean_api_key):
        raise RpcError(
            "The API key contains internal whitespace. Copy it again from Alchemy."
        )

    slug = chain["alchemy_slug"].strip().strip("/")
    if not slug or "/" in slug:
        raise RpcError("The Alchemy URL for this network is not configured correctly.")
    endpoint = ALCHEMY_ENDPOINT_TEMPLATE.format(
        slug=slug,
        api_key=quote(clean_api_key, safe=""),
    )
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    }

    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.Timeout as error:
        raise RpcError(
            f"Alchemy did not respond within {HTTP_TIMEOUT_SECONDS} seconds. "
            "Please try again later."
        ) from error
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        if status in (401, 403):
            message = (
                f"Alchemy authentication error (HTTP {status}). "
                "Check that your API key is valid and the selected network is enabled."
            )
        elif status == 404:
            message = (
                "Alchemy could not find the requested endpoint (HTTP 404). "
                "Check the selected network and copy your API key again."
            )
        else:
            message = f"Alchemy returned HTTP {status}. Please try again later."
        raise RpcError(message) from error
    except requests.RequestException as error:
        raise RpcError(
            "Could not connect to Alchemy. Check your connection and try again."
        ) from error

    try:
        data = response.json()
    except ValueError as error:
        raise RpcError("Alchemy returned an invalid JSON response.") from error

    if not isinstance(data, dict):
        raise RpcError("Alchemy returned an unexpected response.")
    if data.get("error"):
        rpc_error = data["error"]
        if isinstance(rpc_error, dict):
            error_message = str(rpc_error.get("message", rpc_error))
        else:
            error_message = str(rpc_error)
        if re.search(r"\b(401|403|unauthori[sz]ed|invalid api.?key|api key)\b", error_message, re.I):
            raise RpcError(
                "Alchemy authentication error. Check that your API key is valid "
                "and the selected network is enabled."
            )
        if re.search(r"\b(404|not found|unknown chain|unsupported network)\b", error_message, re.I):
            if method == "eth_getTransactionByHash":
                raise RpcError(
                    f"Transaction not found on {chain_name}. Check that "
                    "the hash belongs to the selected network."
                )
            raise RpcError(
                f"Alchemy could not complete {method} on {chain_name}. "
                "Check that the network and your API key access are compatible."
            )
        safe_error_message = error_message.replace(clean_api_key, "[API Key]")
        raise RpcError(f"Alchemy JSON-RPC error: {safe_error_message[:240]}")
    if "result" not in data:
        raise RpcError("Alchemy's response does not contain a result.")
    return data["result"]


def fetch_transaction_and_receipt(
    chain_name: str,
    api_key: str,
    tx_hash: str,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    transaction = alchemy_rpc(
        chain_name,
        api_key,
        "eth_getTransactionByHash",
        [tx_hash],
    )
    if transaction is None:
        raise RpcError(
            f"Transaction not found on {chain_name}. Check that the hash is correct "
            "and belongs to the selected network. If it is recent, wait a moment "
            "and try again."
        )
    if not isinstance(transaction, dict):
        raise RpcError("Alchemy returned invalid transaction data.")

    receipt = alchemy_rpc(
        chain_name,
        api_key,
        "eth_getTransactionReceipt",
        [tx_hash],
    )
    if receipt is not None and not isinstance(receipt, dict):
        raise RpcError("Alchemy returned invalid receipt data.")
    return transaction, receipt


def detect_transaction_network(tx_hash: str, api_key: str) -> Dict[str, Any]:
    """Query every configured Alchemy network concurrently for a transaction hash."""
    matches: List[str] = []
    errors: List[str] = []
    with ThreadPoolExecutor(max_workers=len(CHAINS)) as executor:
        futures = {
            executor.submit(
                alchemy_rpc,
                chain_name,
                api_key,
                "eth_getTransactionByHash",
                [tx_hash],
            ): chain_name
            for chain_name in CHAINS
        }
        for future in as_completed(futures):
            chain_name = futures[future]
            try:
                transaction = future.result()
            except RpcError as error:
                if "Transaction not found on " not in str(error):
                    errors.append(f"{chain_name}: {error}")
                continue
            if (
                isinstance(transaction, dict)
                and str(transaction.get("hash", "")).lower() == tx_hash.lower()
            ):
                matches.append(chain_name)

    if len(matches) == 1:
        return {"state": "detected", "networks": matches, "errors": errors}
    if matches:
        return {"state": "ambiguous", "networks": matches, "errors": errors}
    if errors:
        return {"state": "incomplete", "networks": [], "errors": errors}
    return {"state": "not_found", "networks": [], "errors": []}


def parse_block_number(value: Any, field_name: str = "blockNumber") -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise RpcError(f"Field {field_name} has an invalid block-number format.")
    try:
        return int(value, 16)
    except ValueError as error:
        raise RpcError(f"Field {field_name} has an invalid block-number format.") from error


def fetch_block_timestamp(chain_name: str, api_key: str, block_number: Any) -> int:
    block_number_int = (
        block_number
        if isinstance(block_number, int)
        else parse_block_number(block_number)
    )
    block = alchemy_rpc(
        chain_name,
        api_key,
        "eth_getBlockByNumber",
        [hex(block_number_int), False],
    )
    if not isinstance(block, dict):
        raise RpcError(f"Alchemy did not return block {hex(block_number_int)} on {chain_name}.")
    return parse_block_number(block.get("timestamp"), "timestamp")


def parse_transfer_timestamp(transfer: Dict[str, Any]) -> Optional[int]:
    metadata = transfer.get("metadata")
    timestamp = metadata.get("blockTimestamp") if isinstance(metadata, dict) else None
    if not isinstance(timestamp, str) or not timestamp.strip():
        return None
    try:
        parsed = datetime.fromisoformat(timestamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def format_utc_timestamp(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )


def estimate_average_block_time(
    chain_name: str,
    api_key: str,
    latest_block_number: int,
    latest_timestamp: int,
) -> Tuple[float, str]:
    fallback = float(CHAINS[chain_name]["average_block_time"])
    sample_count = max(1, int((RADAR_WINDOWS_SECONDS[-1][1] / fallback)))
    sample_number = max(0, latest_block_number - sample_count)
    if sample_number == latest_block_number:
        return fallback, "network reference estimate"
    try:
        sample_timestamp = fetch_block_timestamp(chain_name, api_key, sample_number)
    except RpcError:
        return fallback, "reference estimate (historical block could not be read)"
    elapsed_blocks = latest_block_number - sample_number
    elapsed_seconds = latest_timestamp - sample_timestamp
    if elapsed_blocks <= 0 or elapsed_seconds <= 0:
        return fallback, "reference estimate (invalid block sample)"
    return elapsed_seconds / elapsed_blocks, "average observed over the last ~48 hours"


def approximate_block_for_timestamp(
    target_timestamp: int,
    latest_block_number: int,
    latest_timestamp: int,
    average_block_time: float,
) -> int:
    if target_timestamp > latest_timestamp:
        return latest_block_number + 1
    blocks_ago = round((latest_timestamp - target_timestamp) / average_block_time)
    return max(0, min(latest_block_number, latest_block_number - blocks_ago))


def destination_transfer_categories(chain_name: str) -> List[str]:
    categories = ["external", "erc20", "erc721", "erc1155", "specialnft"]
    if chain_name in {"Ethereum", "Polygon", "Base"}:
        categories.insert(1, "internal")
    return categories


def scan_destination_radar(
    api_key: str,
    destination_chain: str,
    destination_wallet: str,
    origin_timestamp: int,
    origin_assets: Optional[List[Dict[str, Any]]] = None,
    origin_chain: str = "",
) -> Dict[str, Any]:
    """Find exact wallet, asset, and amount matches in widening time windows."""
    origin_assets = origin_assets or []
    latest_block = alchemy_rpc(
        destination_chain,
        api_key,
        "eth_getBlockByNumber",
        ["latest", False],
    )
    if not isinstance(latest_block, dict):
        raise RpcError(f"Could not read the latest block on {destination_chain}.")
    latest_block_number = parse_block_number(latest_block.get("number"), "number")
    latest_timestamp = parse_block_number(latest_block.get("timestamp"), "timestamp")
    average_block_time, estimate_source = estimate_average_block_time(
        destination_chain,
        api_key,
        latest_block_number,
        latest_timestamp,
    )
    if average_block_time <= 0:
        average_block_time = float(CHAINS[destination_chain]["average_block_time"])

    result: Dict[str, Any] = {
        "state": "not_found",
        "transfer": None,
        "candidates": [],
        "windows": [],
        "latest_timestamp": latest_timestamp,
        "searched_through": min(
            latest_timestamp,
            origin_timestamp + RADAR_WINDOWS_SECONDS[-1][1],
        ),
        "full_48h_available": (
            latest_timestamp >= origin_timestamp + RADAR_WINDOWS_SECONDS[-1][1]
        ),
        "average_block_time": average_block_time,
        "estimate_source": estimate_source,
        "partial": False,
        "swap_matching_enabled": True,
    }
    if latest_timestamp < origin_timestamp:
        result["state"] = "waiting_for_destination_chain"
        return result

    prior_window_end = 0
    wallet = destination_wallet.lower()
    categories = destination_transfer_categories(destination_chain)
    candidate_ids = set()

    for window_name, window_end_seconds in RADAR_WINDOWS_SECONDS:
        window_start = origin_timestamp + prior_window_end
        if prior_window_end:
            window_start += 1
        window_end = origin_timestamp + window_end_seconds
        prior_window_end = window_end_seconds
        if window_start > latest_timestamp:
            result["windows"].append(
                {"name": window_name, "state": "not_reached", "transfers_checked": 0}
            )
            continue

        effective_end = min(window_end, latest_timestamp)
        start_block = approximate_block_for_timestamp(
            window_start,
            latest_block_number,
            latest_timestamp,
            average_block_time,
        )
        end_block = approximate_block_for_timestamp(
            effective_end,
            latest_block_number,
            latest_timestamp,
            average_block_time,
        )
        padding_blocks = max(
            10,
            int(
                (latest_timestamp - window_start)
                / average_block_time
                * 0.02
            ),
        )
        from_block = max(0, start_block - padding_blocks)
        to_block = min(latest_block_number, end_block + padding_blocks)
        if from_block > to_block:
            result["windows"].append(
                {"name": window_name, "state": "not_reached", "transfers_checked": 0}
            )
            continue

        page_key: Optional[str] = None
        pages_read = 0
        transfers_checked = 0
        found_transfer = None
        window_candidates = 0
        while pages_read < RADAR_MAX_PAGES_PER_WINDOW:
            transfer_filter: Dict[str, Any] = {
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "toAddress": wallet,
                "category": categories,
                "excludeZeroValue": True,
                "withMetadata": True,
                "order": "asc",
                "maxCount": "0x3e8",
            }
            if page_key:
                transfer_filter["pageKey"] = page_key
            response = alchemy_rpc(
                destination_chain,
                api_key,
                "alchemy_getAssetTransfers",
                [transfer_filter],
            )
            if not isinstance(response, dict):
                raise RpcError(
                    f"Alchemy returned an invalid response while searching transfers "
                    f"on {destination_chain}."
                )
            transfers = response.get("transfers", [])
            if not isinstance(transfers, list):
                raise RpcError("Alchemy returned an invalid transfer list.")
            pages_read += 1
            transfers_checked += len(transfers)

            for transfer in transfers:
                if not isinstance(transfer, dict):
                    continue
                recipient = transfer.get("to")
                if not isinstance(recipient, str) or recipient.lower() != wallet:
                    continue
                transfer_timestamp = parse_transfer_timestamp(transfer)
                if transfer_timestamp is None:
                    block_number = transfer.get("blockNum")
                    try:
                        transfer_timestamp = fetch_block_timestamp(
                            destination_chain,
                            api_key,
                            block_number,
                        )
                    except RpcError:
                        continue
                if window_start <= transfer_timestamp <= effective_end:
                    destination_asset = parse_destination_asset(
                        transfer,
                        destination_chain,
                        api_key,
                        str(CHAINS[destination_chain]["native_symbol"]),
                    )
                    try:
                        destination_block = parse_block_number(
                            transfer.get("blockNum"),
                            "transfer.blockNum",
                        )
                    except RpcError:
                        destination_block = None
                    transfer_result = {
                        "hash": transfer.get("hash"),
                        "from": transfer.get("from"),
                        "to": recipient,
                        "asset": (
                            destination_asset["symbol"]
                            if destination_asset
                            else transfer.get("asset") or "Unidentified asset"
                        ),
                        "value": transfer.get("value"),
                        "category": transfer.get("category"),
                        "block_number": transfer.get("blockNum"),
                        "block_number_int": destination_block,
                        "timestamp": transfer_timestamp,
                        "raw_contract": transfer.get("rawContract"),
                        "destination_asset": destination_asset,
                    }
                    if destination_asset:
                        transfer_result["value"] = destination_asset["amount"]
                        origin_match = find_fee_tolerant_asset_match(
                            origin_assets,
                            destination_asset,
                        )
                    else:
                        origin_match = None

                    if origin_match is not None:
                        transfer_result["matched_origin_asset"] = origin_match[
                            "origin_asset"
                        ]
                        transfer_result["origin_amount"] = format(
                            origin_match["origin_amount"].normalize(),
                            "f",
                        )
                        transfer_result["destination_amount"] = format(
                            origin_match["destination_amount"].normalize(),
                            "f",
                        )
                        transfer_result["fee_percent"] = origin_match["fee_percent"]
                        transfer_result["matched_asset"] = origin_match["symbol"]
                        found_transfer = transfer_result
                        break

                    candidate_key = (
                        transfer_result["hash"],
                        destination_asset.get("asset_id") if destination_asset else None,
                        destination_asset.get("amount_raw") if destination_asset else None,
                    )
                    if candidate_key not in candidate_ids:
                        candidate_ids.add(candidate_key)
                        if len(result["candidates"]) < 25:
                            result["candidates"].append(transfer_result)
                            window_candidates += 1

            if found_transfer:
                break
            next_page_key = response.get("pageKey")
            page_key = (
                next_page_key.strip()
                if isinstance(next_page_key, str) and next_page_key.strip()
                else None
            )
            if page_key is None:
                break

        result["windows"].append(
            {
                "name": window_name,
                "state": "found" if found_transfer else (
                    "candidates" if window_candidates else "searched"
                ),
                "from_block": from_block,
                "to_block": to_block,
                "transfers_checked": transfers_checked,
            }
        )
        if found_transfer:
            result["state"] = "found"
            result["transfer"] = found_transfer
            return result
        if page_key is not None and pages_read >= RADAR_MAX_PAGES_PER_WINDOW:
            result["partial"] = True

    if result["candidates"]:
        try:
            swap_match = find_usd_swap_match(
                origin_assets,
                result["candidates"],
                origin_chain,
                destination_chain,
                origin_timestamp,
            )
        except DefiLlamaError as error:
            result["swap_error"] = str(error)
        else:
            if swap_match is not None:
                result["state"] = "found"
                result["transfer"] = swap_match
                result["match_type"] = "swap"
                return result

    if result["partial"]:
        result["state"] = "incomplete"
    elif result["candidates"]:
        result["state"] = "candidates"
    elif all(window["state"] == "not_reached" for window in result["windows"]):
        result["state"] = "waiting_for_destination_chain"
    return result


def address_from_topic(topic: Any) -> Optional[str]:
    if not isinstance(topic, str) or len(topic) != 66:
        return None
    if topic[:26].lower() != "0x" + ("0" * 24):
        return None
    address = "0x" + topic[-40:]
    return address.lower() if ADDRESS_PATTERN.fullmatch(address) else None


def parse_hex_quantity(value: Any, field_name: str) -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise RpcError(f"Receipt field {field_name} has an invalid format.")
    try:
        return int(value, 16)
    except ValueError as error:
        raise RpcError(f"Receipt field {field_name} has an invalid format.") from error


def analyze_transfer_logs(
    logs: List[Dict[str, Any]],
    destination_wallet: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    transfers: List[Dict[str, Any]] = []
    matching_transfers: List[Dict[str, Any]] = []
    expected_wallet = destination_wallet.lower()

    for log in logs:
        if not isinstance(log, dict):
            continue
        topics = log.get("topics", [])
        if (
            not isinstance(topics, list)
            or len(topics) < 3
            or str(topics[0]).lower() != TRANSFER_TOPIC
        ):
            continue

        sender = address_from_topic(topics[1])
        recipient = address_from_topic(topics[2])
        raw_data = log.get("data", "0x0")
        data = raw_data if isinstance(raw_data, str) else ""
        try:
            amount_raw = int(data, 16)
        except (TypeError, ValueError):
            amount_raw = None

        transfer = {
            "token_contract": str(log.get("address", "")).lower(),
            "from": sender,
            "to": recipient,
            "amount_raw": amount_raw,
            "transaction_hash": log.get("transactionHash"),
        }
        transfers.append(transfer)
        if (
            sender is not None
            and recipient == expected_wallet
            and amount_raw is not None
            and amount_raw > 0
        ):
            matching_transfers.append(transfer)

    return transfers, matching_transfers


def token_identity(
    chain_name: str,
    token_address: Optional[str],
    native_symbol: str,
) -> Tuple[str, str, Optional[int]]:
    if token_address is None:
        native_asset = "ETH" if native_symbol.upper() == "ETH" else native_symbol.upper()
        return f"native:{native_asset}", native_asset, 18
    normalized_address = token_address.lower()
    for asset_id, deployments in TOKEN_EQUIVALENCE_GROUPS.items():
        network_tokens = deployments.get(chain_name, {})
        if normalized_address in network_tokens:
            return asset_id, asset_id, int(network_tokens[normalized_address])
    return normalized_address, normalized_address, None


def fetch_token_decimals(
    chain_name: str,
    api_key: str,
    token_address: str,
) -> Optional[int]:
    try:
        response = alchemy_rpc(
            chain_name,
            api_key,
            "eth_call",
            [{"to": token_address, "data": "0x313ce567"}, "latest"],
        )
        decimals = parse_hex_quantity(response, "ERC-20 decimals")
    except RpcError:
        return None
    return decimals if 0 <= decimals <= 255 else None


def fetch_token_text(
    chain_name: str,
    api_key: str,
    token_address: str,
    selector: str,
) -> Optional[str]:
    try:
        response = alchemy_rpc(
            chain_name,
            api_key,
            "eth_call",
            [{"to": token_address, "data": selector}, "latest"],
        )
    except RpcError:
        return None
    if not isinstance(response, str) or not response.startswith("0x"):
        return None
    try:
        encoded = bytes.fromhex(response[2:])
        if len(encoded) >= 64:
            offset = int.from_bytes(encoded[:32], "big")
            if offset + 32 <= len(encoded):
                length = int.from_bytes(encoded[offset : offset + 32], "big")
                start = offset + 32
                if 0 < length <= len(encoded) - start:
                    value = encoded[start : start + length].decode("utf-8").strip("\x00 ")
                    return value or None
        if encoded:
            value = encoded.rstrip(b"\x00").decode("utf-8").strip()
            return value or None
    except (ValueError, UnicodeDecodeError):
        return None
    return None


def fetch_token_labels(
    chain_name: str,
    api_key: str,
    token_address: str,
) -> Tuple[Optional[str], Optional[str]]:
    symbol = fetch_token_text(chain_name, api_key, token_address, "0x95d89b41")
    name = fetch_token_text(chain_name, api_key, token_address, "0x06fdde03")
    return symbol, name


def format_raw_amount(raw_amount: int, decimals: Optional[int]) -> str:
    if decimals is None:
        return f"{raw_amount} base units"
    amount = Decimal(raw_amount) / (Decimal(10) ** decimals)
    return f"{amount.normalize():f}"


def extract_origin_assets(
    chain_name: str,
    api_key: str,
    transaction: Dict[str, Any],
    logs: List[Dict[str, Any]],
    bridge_matches: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Extract native value and relevant ERC-20 movements from the source receipt."""
    assets: List[Dict[str, Any]] = []
    native_symbol = str(CHAINS[chain_name]["native_symbol"])
    native_value = parse_hex_quantity(transaction.get("value", "0x0"), "value")
    if native_value > 0:
        asset_id, symbol, decimals = token_identity(chain_name, None, native_symbol)
        assets.append(
            {
                "asset_id": asset_id,
                "symbol": symbol,
                "token_address": None,
                "amount_raw": native_value,
                "decimals": decimals,
                "amount": format_raw_amount(native_value, decimals),
                "evidence": "transaction.value",
            }
        )

    transfers, _ = analyze_transfer_logs(logs, "")
    transaction_from = str(transaction.get("from") or "").lower()
    transaction_to = str(transaction.get("to") or "").lower()
    bridge_addresses = {str(match.get("address", "")).lower() for match in bridge_matches}
    relevant_transfers = [
        transfer
        for transfer in transfers
        if transfer["amount_raw"] is not None
        and transfer["amount_raw"] > 0
        and (
            transfer["from"] == transaction_from
            or transfer["to"] == transaction_to
            or transfer["to"] in bridge_addresses
        )
    ]
    if not relevant_transfers:
        relevant_transfers = [
            transfer
            for transfer in transfers
            if transfer["amount_raw"] is not None and transfer["amount_raw"] > 0
        ]

    decimals_by_token: Dict[str, Optional[int]] = {}
    seen = set()
    for transfer in relevant_transfers:
        token_address = transfer["token_contract"]
        if not ADDRESS_PATTERN.fullmatch(token_address):
            continue
        if token_address not in decimals_by_token:
            _, _, known_decimals = token_identity(
                chain_name,
                token_address,
                native_symbol,
            )
            decimals_by_token[token_address] = (
                known_decimals
                if known_decimals is not None
                else fetch_token_decimals(chain_name, api_key, token_address)
            )
        asset_id, symbol, _ = token_identity(
            chain_name,
            token_address,
            native_symbol,
        )
        token_name = None
        if asset_id == token_address:
            token_symbol, token_name = fetch_token_labels(
                chain_name,
                api_key,
                token_address,
            )
            if token_symbol:
                symbol = token_symbol
        raw_amount = transfer["amount_raw"]
        decimals = decimals_by_token[token_address]
        identity = (token_address, raw_amount, transfer["from"], transfer["to"])
        if identity in seen:
            continue
        seen.add(identity)
        assets.append(
            {
                "asset_id": asset_id,
                "symbol": symbol,
                "name": token_name,
                "token_address": token_address,
                "amount_raw": raw_amount,
                "decimals": decimals,
                "amount": format_raw_amount(raw_amount, decimals),
                "from": transfer["from"],
                "to": transfer["to"],
                "evidence": "receipt Transfer log",
            }
        )
    return assets


def parse_destination_asset(
    transfer: Dict[str, Any],
    chain_name: str,
    api_key: str,
    native_symbol: str,
) -> Optional[Dict[str, Any]]:
    raw_contract = transfer.get("rawContract")
    raw_contract = raw_contract if isinstance(raw_contract, dict) else {}
    raw_token_address = raw_contract.get("address")
    token_address = (
        raw_token_address.lower()
        if isinstance(raw_token_address, str)
        and ADDRESS_PATTERN.fullmatch(raw_token_address)
        else None
    )
    category = str(transfer.get("category", "")).lower()
    if token_address is None and category not in {"external", "internal"}:
        return None

    raw_value = raw_contract.get("value")
    try:
        if isinstance(raw_value, int):
            amount_raw = raw_value
        elif isinstance(raw_value, str) and raw_value.startswith("0x"):
            amount_raw = int(raw_value, 16)
        else:
            return None
    except ValueError:
        return None
    if amount_raw < 0:
        return None

    asset_id, symbol, known_decimals = token_identity(
        chain_name,
        token_address,
        native_symbol,
    )
    decimals: Optional[int] = known_decimals
    if decimals is None:
        raw_decimals = raw_contract.get("decimals")
        if isinstance(raw_decimals, int) and 0 <= raw_decimals <= 255:
            decimals = raw_decimals
        elif isinstance(raw_decimals, str):
            try:
                parsed_decimals = (
                    int(raw_decimals, 16)
                    if raw_decimals.startswith("0x")
                    else int(raw_decimals)
                )
            except ValueError:
                parsed_decimals = -1
            if 0 <= parsed_decimals <= 255:
                decimals = parsed_decimals

    display_symbol = symbol
    token_name = transfer.get("name")
    asset = transfer.get("asset")
    if token_address is not None and symbol == token_address and isinstance(asset, str) and asset:
        display_symbol = asset
    if token_address is not None and asset_id == token_address:
        fetched_symbol, fetched_name = fetch_token_labels(
            chain_name,
            api_key,
            token_address,
        )
        if fetched_symbol and display_symbol == token_address:
            display_symbol = fetched_symbol
        if not isinstance(token_name, str) or not token_name.strip():
            token_name = fetched_name
    return {
        "asset_id": asset_id,
        "symbol": display_symbol,
        "name": token_name if isinstance(token_name, str) else None,
        "token_address": token_address,
        "amount_raw": amount_raw,
        "decimals": decimals,
        "amount": format_raw_amount(amount_raw, decimals),
    }


def normalize_asset_label(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = unicodedata.normalize("NFKC", value.replace("₮", "T")).upper()
    normalized = re.sub(r"[^A-Z0-9]", "", normalized)
    if normalized.startswith("BRIDGED"):
        normalized = normalized[len("BRIDGED") :]
    aliases = {
        "USDT0": "USDT",
        "TETHERUSD": "USDT",
        "USDCOIN": "USDC",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized or None


def format_fee_percent(value: Any) -> str:
    try:
        fee_percent = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return "N/A"
    if not fee_percent.is_finite():
        return "N/A"
    return f"{fee_percent:.6f}".rstrip("0").rstrip(".") or "0"


def asset_labels(asset: Dict[str, Any]) -> Set[str]:
    labels: Set[str] = set()
    token_address = asset.get("token_address")
    for field in ("symbol", "name"):
        label = asset.get(field)
        if not isinstance(label, str):
            continue
        if isinstance(token_address, str) and label.lower() == token_address.lower():
            continue
        normalized = normalize_asset_label(label)
        if normalized:
            labels.add(normalized)
    return labels


def find_fee_tolerant_asset_match(
    origin_assets: List[Dict[str, Any]],
    destination_asset: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    for origin_asset in origin_assets:
        same_asset_id = origin_asset.get("asset_id") == destination_asset.get(
            "asset_id"
        )
        matching_labels = asset_labels(origin_asset) & asset_labels(destination_asset)
        if not same_asset_id and not matching_labels:
            continue
        origin_raw = origin_asset.get("amount_raw")
        destination_raw = destination_asset.get("amount_raw")
        origin_decimals = origin_asset.get("decimals")
        destination_decimals = destination_asset.get("decimals")
        if (
            isinstance(origin_raw, int)
            and isinstance(destination_raw, int)
            and isinstance(origin_decimals, int)
            and isinstance(destination_decimals, int)
        ):
            comparison_decimals = max(origin_decimals, destination_decimals)
            origin_scaled = origin_raw * 10 ** (
                comparison_decimals - origin_decimals
            )
            destination_scaled = destination_raw * 10 ** (
                comparison_decimals - destination_decimals
            )
            origin_amount = Decimal(origin_raw) / (Decimal(10) ** origin_decimals)
            destination_amount = Decimal(destination_raw) / (
                Decimal(10) ** destination_decimals
            )
        else:
            continue

        if origin_amount <= 0 or destination_amount <= 0:
            continue
        if destination_scaled > origin_scaled:
            continue
        if destination_scaled * 100 < origin_scaled * RADAR_MIN_RECEIVED_PERCENT:
            continue

        fee_percent = (
            Decimal(origin_scaled - destination_scaled)
            * Decimal(100)
            / Decimal(origin_scaled)
        ).quantize(Decimal("0.000001"))
        return {
            "origin_asset": origin_asset,
            "origin_amount": origin_amount,
            "destination_amount": destination_amount,
            "fee_percent": fee_percent,
            "asset_id": origin_asset["asset_id"],
            "symbol": (
                sorted(matching_labels)[0]
                if matching_labels
                else origin_asset.get("symbol", "Asset")
            ),
        }
    return None


def defillama_coin_id(chain_name: str, asset: Dict[str, Any]) -> Optional[str]:
    chain_id = DEFILLAMA_CHAIN_IDS.get(chain_name)
    if chain_id is None:
        return None
    token_address = asset.get("token_address")
    if token_address is None:
        return DEFILLAMA_NATIVE_COIN_IDS.get(chain_name)
    if isinstance(token_address, str) and ADDRESS_PATTERN.fullmatch(token_address):
        return f"{chain_id}:{token_address.lower()}"
    return None


def asset_amount_decimal(asset: Dict[str, Any]) -> Optional[Decimal]:
    raw_amount = asset.get("amount_raw")
    decimals = asset.get("decimals")
    if (
        not isinstance(raw_amount, int)
        or isinstance(raw_amount, bool)
        or raw_amount <= 0
        or not isinstance(decimals, int)
        or isinstance(decimals, bool)
        or not 0 <= decimals <= 255
    ):
        return None
    return Decimal(raw_amount) / (Decimal(10) ** decimals)


def compare_historical_usd_values(
    origin_asset: Dict[str, Any],
    destination_asset: Dict[str, Any],
    origin_chain: str,
    destination_chain: str,
    origin_timestamp: int,
    destination_timestamp: int,
) -> Optional[Dict[str, Decimal]]:
    origin_amount = asset_amount_decimal(origin_asset)
    destination_amount = asset_amount_decimal(destination_asset)
    origin_coin_id = defillama_coin_id(origin_chain, origin_asset)
    destination_coin_id = defillama_coin_id(destination_chain, destination_asset)
    if (
        origin_amount is None
        or destination_amount is None
        or origin_coin_id is None
        or destination_coin_id is None
    ):
        return None

    origin_price = fetch_defillama_historical_price(
        origin_timestamp,
        origin_coin_id,
    )
    destination_price = fetch_defillama_historical_price(
        destination_timestamp,
        destination_coin_id,
    )
    if origin_price is None or destination_price is None:
        return None

    origin_usd = origin_amount * Decimal(str(origin_price))
    destination_usd = destination_amount * Decimal(str(destination_price))
    if origin_usd <= 0 or destination_usd <= 0:
        return None
    efficiency = destination_usd * Decimal(100) / origin_usd
    return {
        "origin_usd": origin_usd,
        "destination_usd": destination_usd,
        "efficiency_percent": efficiency,
    }


def find_usd_swap_match(
    origin_assets: List[Dict[str, Any]],
    candidates: List[Dict[str, Any]],
    origin_chain: str,
    destination_chain: str,
    origin_timestamp: int,
) -> Optional[Dict[str, Any]]:
    """Match different assets when historical USD value is within the swap range."""
    price_unavailable = False
    for candidate in candidates:
        destination_asset = candidate.get("destination_asset")
        destination_timestamp = candidate.get("timestamp")
        if (
            not isinstance(destination_asset, dict)
            or not isinstance(destination_timestamp, int)
        ):
            continue
        destination_amount = asset_amount_decimal(destination_asset)
        destination_coin_id = defillama_coin_id(
            destination_chain,
            destination_asset,
        )
        if destination_amount is None or destination_coin_id is None:
            continue

        for origin_asset in origin_assets:
            if not isinstance(origin_asset, dict):
                continue
            if origin_asset.get("asset_id") == destination_asset.get("asset_id"):
                continue
            if asset_labels(origin_asset) & asset_labels(destination_asset):
                continue
            origin_amount = asset_amount_decimal(origin_asset)
            if (
                origin_amount is None
                or defillama_coin_id(origin_chain, origin_asset) is None
            ):
                continue

            comparison = compare_historical_usd_values(
                origin_asset,
                destination_asset,
                origin_chain,
                destination_chain,
                origin_timestamp,
                destination_timestamp,
            )
            if comparison is None:
                price_unavailable = True
                continue
            origin_usd = comparison["origin_usd"]
            destination_usd = comparison["destination_usd"]
            efficiency = comparison["efficiency_percent"]
            if not SWAP_MIN_VALUE_PERCENT <= efficiency <= SWAP_MAX_VALUE_PERCENT:
                continue

            origin_symbol = str(origin_asset.get("symbol") or "Unknown asset")
            destination_symbol = str(destination_asset.get("symbol") or "Unknown asset")
            match = dict(candidate)
            match.update(
                {
                    "match_type": "swap",
                    "matched_origin_asset": origin_asset,
                    "origin_amount": format(origin_amount.normalize(), "f"),
                    "destination_amount": format(
                        destination_amount.normalize(),
                        "f",
                    ),
                    "origin_symbol": origin_symbol,
                    "destination_symbol": destination_symbol,
                    "matched_asset": f"{origin_symbol} → {destination_symbol}",
                    "origin_usd": origin_usd,
                    "destination_usd": destination_usd,
                    "efficiency_percent": efficiency.quantize(Decimal("0.01")),
                    "destination_value_usd": destination_usd.quantize(
                        Decimal("0.01")
                    ),
                    "origin_value_usd": origin_usd.quantize(Decimal("0.01")),
                }
            )
            return match
    if price_unavailable:
        raise DefiLlamaError(
            "DefiLlama did not return a historical USD price for one or more candidate assets."
        )
    return None


def addresses_in_hex_payload(value: Any) -> List[str]:
    """Extract address-shaped values from raw hex or ABI-padded 32-byte words."""
    if not isinstance(value, str):
        return []
    payload = value[2:] if value.startswith("0x") else value
    if not payload or not re.fullmatch(r"[a-fA-F0-9]+", payload):
        return []

    addresses: List[str] = []
    seen_addresses = set()

    def add_address(address: str) -> None:
        normalized_address = "0x" + address[-40:].lower()
        if normalized_address not in seen_addresses:
            seen_addresses.add(normalized_address)
            addresses.append(normalized_address)

    alignments = (0, 8) if len(payload) % 64 == 8 else (0,)
    for alignment in alignments:
        for offset in range(alignment, len(payload) - 63, 64):
            word = payload[offset : offset + 64]
            if word[:24] == "0" * 24:
                add_address(word[-40:])
    for match in re.finditer(r"(?<![a-fA-F0-9])([a-fA-F0-9]{40})(?![a-fA-F0-9])", payload):
        add_address(match.group(1))
    return addresses


def identify_bridges(
    chain_name: str,
    transaction_to: str,
    logs: List[Dict[str, Any]],
    transaction_input: Any = "",
) -> List[Dict[str, Any]]:
    """Match known contracts in the recipient, transaction calldata, and receipt logs."""
    catalog = BRIDGE_CATALOG.get(chain_name, {})
    evidence_by_address: Dict[str, List[str]] = {}

    def add_evidence(address: str, evidence: str) -> None:
        normalized_address = address.lower()
        if normalized_address in catalog:
            evidence_by_address.setdefault(normalized_address, [])
            if evidence not in evidence_by_address[normalized_address]:
                evidence_by_address[normalized_address].append(evidence)

    if transaction_to:
        add_evidence(transaction_to, "tx.to")
    for address in addresses_in_hex_payload(transaction_input):
        add_evidence(address, "tx.input")

    for log in logs:
        if not isinstance(log, dict):
            continue
        emitter = str(log.get("address", "")).lower()
        if ADDRESS_PATTERN.fullmatch(emitter):
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


def payload_contains_hash(payload: Any, tx_hash: str) -> bool:
    if not isinstance(payload, str):
        return False
    normalized_payload = payload.lower().removeprefix("0x")
    normalized_hash = tx_hash.lower().removeprefix("0x")
    return bool(normalized_hash) and normalized_hash in normalized_payload


def verify_destination_bridge_reference(
    api_key: str,
    destination_chain: str,
    destination_tx_hash: Any,
    origin_tx_hash: str,
    origin_sender: Any,
) -> Dict[str, Any]:
    """Inspect a destination transaction for explicit references to its source."""
    if not isinstance(destination_tx_hash, str) or not TX_HASH_PATTERN.fullmatch(
        destination_tx_hash
    ):
        return {
            "status": "Not checked",
            "detail": "The destination transfer did not include a valid transaction hash.",
        }

    try:
        transaction, receipt = fetch_transaction_and_receipt(
            destination_chain,
            api_key,
            destination_tx_hash,
        )
    except RpcError as error:
        return {"status": "Lookup failed", "detail": str(error)}
    if receipt is None:
        return {
            "status": "Receipt unavailable",
            "detail": "The destination transaction has no receipt yet.",
        }

    raw_logs = receipt.get("logs", [])
    logs = (
        [log for log in raw_logs if isinstance(log, dict)]
        if isinstance(raw_logs, list)
        else []
    )
    transaction_input = transaction.get("input", "")
    source_sender = (
        origin_sender.lower()
        if isinstance(origin_sender, str)
        and ADDRESS_PATTERN.fullmatch(origin_sender)
        else None
    )

    hash_in_input = payload_contains_hash(transaction_input, origin_tx_hash)
    hash_in_logs = False
    sender_in_input = False
    sender_in_logs = False
    bridge_hash_log_match = False
    bridge_sender_log_match = False
    catalog = BRIDGE_CATALOG.get(destination_chain, {})
    transaction_to = str(transaction.get("to") or "").lower()
    bridge_transaction_target = transaction_to in catalog

    if source_sender:
        sender_in_input = source_sender in addresses_in_hex_payload(transaction_input)

    for log in logs:
        topics = log.get("topics", [])
        topics = topics if isinstance(topics, list) else []
        payloads = [value for value in topics if isinstance(value, str)]
        log_data = log.get("data")
        if isinstance(log_data, str):
            payloads.append(log_data)

        log_hash_match = any(
            payload_contains_hash(payload, origin_tx_hash)
            for payload in payloads
        )
        hash_in_logs = hash_in_logs or log_hash_match

        log_sender_match = source_sender is not None and any(
            source_sender in addresses_in_hex_payload(payload)
            for payload in payloads
        )
        if log_sender_match:
            sender_in_logs = True

        emitter = str(log.get("address") or "").lower()
        if emitter in catalog and log_hash_match:
            bridge_hash_log_match = True
        if emitter in catalog and log_sender_match:
            bridge_sender_log_match = True

    verified = (
        (hash_in_input and bridge_transaction_target)
        or bridge_hash_log_match
        or (sender_in_input and bridge_transaction_target)
        or bridge_sender_log_match
    )
    bridge_matches = identify_bridges(
        destination_chain,
        transaction_to,
        logs,
        transaction_input,
    )
    bridge_names = list(
        dict.fromkeys(
            str(match.get("name", match.get("protocol", "Bridge")))
            for match in bridge_matches
            if "tx.to" in match.get("evidence", [])
            or "log.address" in match.get("evidence", [])
        )
    )
    if verified:
        status = "Verified Bridge Reference"
        detail = (
            "The source transaction hash or sender wallet is referenced in calldata "
            "to a catalogued bridge/router or in a log emitted by one."
        )
    elif hash_in_input or hash_in_logs:
        status = "Origin transaction hash referenced"
        detail = (
            "The origin hash appears in destination calldata/logs, but no binding "
            "reference from a catalogued bridge/router was verified."
        )
    elif sender_in_input or sender_in_logs:
        status = "Sender wallet referenced (unverified)"
        detail = (
            "The source sender address appears in destination calldata/logs; this "
            "alone does not establish a bridge transaction link."
        )
    else:
        status = "No explicit origin reference found"
        detail = (
            "No origin transaction hash or source sender reference was found in the "
            "destination transaction input or receipt logs."
        )

    return {
        "status": status,
        "detail": detail,
        "origin_hash_in_input": hash_in_input,
        "origin_hash_in_logs": hash_in_logs,
        "origin_sender_in_input": sender_in_input,
        "origin_sender_in_logs": sender_in_logs,
        "bridge_sender_log_match": bridge_sender_log_match,
        "bridge_names": bridge_names,
    }


def format_native_value(value_hex: Any, symbol: str) -> str:
    wei_value = parse_hex_quantity(value_hex, "value")
    native_value = Decimal(wei_value) / Decimal(10**18)
    return f"{native_value.normalize():f} {symbol}"


def diagnose_transaction(
    chain_name: str,
    tx_hash: str,
    destination_wallet: str,
    transaction: Dict[str, Any],
    receipt: Dict[str, Any],
    destination_chain: Optional[str] = None,
    api_key: str = "",
) -> Dict[str, Any]:
    status = str(receipt.get("status", "")).lower()
    if status not in {"0x0", "0x1"}:
        raise RpcError("The receipt does not contain a valid transaction status.")

    raw_logs = receipt.get("logs", [])
    logs_warning = None
    if raw_logs is None:
        logs = []
    elif isinstance(raw_logs, list):
        logs = [log for log in raw_logs if isinstance(log, dict)]
        if len(logs) != len(raw_logs):
            logs_warning = (
                "The receipt contains malformed log entries; they were skipped "
                "so analysis could continue."
            )
    else:
        logs = []
        logs_warning = (
            "The receipt's logs field has an unexpected format; "
            "events could not be analyzed."
        )
    transfers, matching_transfers = analyze_transfer_logs(logs, destination_wallet)

    tx_to = str(transaction.get("to") or "").lower()
    tx_from = str(transaction.get("from") or "").lower()
    bridge_matches = identify_bridges(
        chain_name,
        tx_to,
        logs,
        transaction.get("input", ""),
    )
    destination_chain = destination_chain or chain_name
    native_value = parse_hex_quantity(transaction.get("value", "0x0"), "value")
    direct_native_credit = (
        tx_to == destination_wallet.lower()
        and native_value > 0
    )
    origin_succeeded = status == "0x1"
    origin_assets = (
        extract_origin_assets(
            chain_name,
            api_key,
            transaction,
            logs,
            bridge_matches,
        )
        if origin_succeeded
        else []
    )
    source_chain_credit = (
        destination_chain == chain_name
        and (direct_native_credit or bool(matching_transfers))
    )

    if not origin_succeeded:
        color = "red"
        indicator = "🔴"
        title = "Transaction failed on the source network"
        status_code = "ORIGIN_FAILED"
        notes = "The Alchemy receipt reports status 0x0; execution was not successful."
    elif source_chain_credit:
        color = "green"
        indicator = "🟢"
        title = "Explicit credit observed in the destination wallet"
        status_code = "DESTINATION_CREDIT_FOUND"
        credit_detail = (
            f"native transfer of {format_native_value(transaction.get('value', '0x0'), CHAINS[chain_name]['native_symbol'])}"
            if direct_native_credit
            else f"{len(matching_transfers)} ERC-20 Transfer event(s)"
        )
        notes = (
            f"The transaction succeeded and the receipt shows {credit_detail} "
            "sent to the specified wallet on the queried network."
        )
    elif bridge_matches:
        color = "bridge"
        indicator = "🟡"
        detected_protocols = ", ".join(
            dict.fromkeys(match["protocol"] for match in bridge_matches)
        )
        detected_contracts = ", ".join(
            dict.fromkeys(match["name"] for match in bridge_matches)
        )
        title = (
            f"Routed through known bridge/router {detected_contracts}. "
            "Source OK; pending credit on the destination network"
        )
        status_code = "ORIGIN_ROUTED_TO_BRIDGE"
        notes = (
            f"Source: successful. Catalog match: {detected_protocols}. "
            "Evidence may come from the recipient, calldata, or references in log "
            "topics/data; this alone does not confirm actual protocol usage or delivery. "
            "Verify credit on the destination network."
        )
    else:
        color = "yellow"
        indicator = "🟡"
        title = "Source successful; destination credit not shown in this receipt"
        status_code = "ORIGIN_CONFIRMED_DESTINATION_UNVERIFIED"
        if destination_chain != chain_name and (direct_native_credit or matching_transfers):
            notes = (
                f"The receipt shows a credit to the wallet on {chain_name}, but "
                f"the selected destination network is {destination_chain}. This is not "
                "evidence of destination credit; a radar match is required."
            )
        else:
            notes = (
                "The source transaction succeeded, but this receipt does not show a "
                "native transfer or ERC-20 Transfer event to the specified wallet. "
                "If the operation used a bridge, delivery must be confirmed separately "
                "on the destination network."
            )

    return {
        "color": color,
        "indicator": indicator,
        "title": title,
        "status_code": status_code,
        "notes": notes,
        "chain": chain_name,
        "tx_hash": tx_hash,
        "status": status,
        "from": tx_from,
        "to": tx_to or "Contract creation",
        "destination_wallet": destination_wallet,
        "destination_chain": destination_chain,
        "origin_assets": origin_assets,
        "bridge_matches": bridge_matches,
        "bridge_protocols": list(
            dict.fromkeys(match["protocol"] for match in bridge_matches)
        ),
        "native_value": format_native_value(
            transaction.get("value", "0x0"),
            CHAINS[chain_name]["native_symbol"],
        ),
        "block_number": (
            parse_hex_quantity(receipt["blockNumber"], "blockNumber")
            if receipt.get("blockNumber") is not None
            else None
        ),
        "log_count": len(logs),
        "logs_warning": logs_warning,
        "transfers": transfers,
        "matching_transfers": matching_transfers,
        "direct_native_credit": direct_native_credit,
        "sender_matches_destination": tx_from == destination_wallet.lower(),
        "receipt": receipt,
    }


def classify_operation(result: Dict[str, Any]) -> Dict[str, str]:
    """Classify a confirmed operation from its route and radar asset match."""
    source_chain = str(result.get("chain") or "Unknown")
    destination_chain = str(result.get("destination_chain") or "Unknown")
    same_network = source_chain.casefold() == destination_chain.casefold()
    radar = result.get("radar")
    transfer = (
        radar.get("transfer")
        if isinstance(radar, dict) and radar.get("state") == "found"
        else None
    )

    if not isinstance(transfer, dict):
        source_assets = result.get("origin_assets", [])
        source_symbols = [
            str(asset.get("symbol") or asset.get("asset_id") or "Unknown asset")
            for asset in source_assets
            if isinstance(asset, dict)
        ]
        source_asset_flow = ", ".join(dict.fromkeys(source_symbols)) or "Unknown asset"
        return {
            "category": "Operation not confirmed",
            "operation_type": "Unconfirmed",
            "network_route": f"{source_chain} -> {destination_chain}",
            "asset_flow": f"{source_asset_flow} -> Unconfirmed destination asset",
            "verification_method": "No qualifying destination transfer match",
            "verdict": "Destination operation not confirmed",
        }

    match_type = (
        radar.get("match_type", transfer.get("match_type", "same_token"))
        if isinstance(radar, dict)
        else transfer.get("match_type", "same_token")
    )
    if match_type == "swap":
        category = "Same-Network Swap" if same_network else "Cross-Chain Swap"
        operation_type = "Swap" if same_network else "Cross-Chain Swap"
        verification_method = "DefiLlama historical USD equivalent"
    elif same_network:
        category = "Same-Network Transfer"
        operation_type = "Transfer"
        reference_check = (
            radar.get("reference_check") if isinstance(radar, dict) else None
        )
        if (
            isinstance(reference_check, dict)
            and reference_check.get("status") == "Verified Bridge Reference"
        ):
            verification_method = "Bridge router signature"
        else:
            verification_method = (
                "Direct log match (indexed destination transfer; wallet, asset, and amount)"
            )
    else:
        category = "Cross-Chain Bridge"
        operation_type = "Bridge"
        reference_check = (
            radar.get("reference_check") if isinstance(radar, dict) else None
        )
        if (
            isinstance(reference_check, dict)
            and reference_check.get("status") == "Verified Bridge Reference"
        ):
            verification_method = "Bridge router signature"
        else:
            verification_method = (
                "Direct log match (indexed destination transfer; wallet, asset, and amount)"
            )

    origin_asset = transfer.get("matched_origin_asset")
    destination_asset = transfer.get("destination_asset")
    origin_symbol = (
        transfer.get("origin_symbol")
        or (
            origin_asset.get("symbol")
            if isinstance(origin_asset, dict)
            else None
        )
        or transfer.get("matched_asset")
        or "Unknown asset"
    )
    destination_symbol = (
        transfer.get("destination_symbol")
        or (
            destination_asset.get("symbol")
            if isinstance(destination_asset, dict)
            else None
        )
        or transfer.get("matched_asset")
        or "Unknown asset"
    )
    origin_amount = transfer.get("origin_amount")
    destination_amount = transfer.get("destination_amount")
    asset_flow = (
        f"{origin_amount} {origin_symbol} -> "
        f"{destination_amount} {destination_symbol}"
    )
    return {
        "category": category,
        "operation_type": operation_type,
        "network_route": f"{source_chain} -> {destination_chain}",
        "asset_flow": asset_flow,
        "verification_method": verification_method,
        "verdict": f"{category} Confirmed",
    }


def build_audit_report(result: Dict[str, Any]) -> str:
    radar = result.get("radar")
    classification = result.get("operation_classification")
    if not isinstance(classification, dict):
        classification = classify_operation(result)
    transfer: Dict[str, Any] = {}
    historical_value_summary = "Historical USD valuation: unavailable."
    reference_summary = [
        "Status: not checked",
        "Detail: no confirmed destination transfer was available for inspection.",
    ]
    if isinstance(radar, dict) and radar.get("state") == "found":
        transfer = radar["transfer"]
        match_type = radar.get("match_type", transfer.get("match_type", "same_token"))
        destination_hash = transfer.get("hash")
        destination_url = build_transaction_explorer_url(
            result.get("destination_chain"),
            destination_hash,
        )
        destination_hash_display = (
            f"[{destination_hash}]({destination_url})"
            if destination_url
            else str(destination_hash or "Unavailable")
        )
        transfer_time = format_utc_timestamp(transfer["timestamp"])
        if match_type == "swap":
            radar_summary = [
                "CONFIRMED: different-token swap matched by historical USD value.",
                f"Destination hash: {destination_hash_display}",
                f"Destination block: {transfer.get('block_number_int') or transfer.get('block_number') or 'N/A'}",
                f"Source amount: {transfer.get('origin_amount')} "
                f"{escape_markdown_text(transfer.get('origin_symbol'))}",
                f"Received amount: {transfer.get('destination_amount')} "
                f"{escape_markdown_text(transfer.get('destination_symbol'))}",
                f"Estimated USD sent: ${transfer.get('origin_value_usd')}",
                f"Estimated USD received: ${transfer.get('destination_value_usd')}",
                f"Estimated value efficiency: {transfer.get('efficiency_percent')}%",
                f"Destination block time: {transfer_time}",
            ]
        else:
            token = escape_markdown_text(
                transfer.get("matched_asset", transfer.get("asset", "asset"))
            )
            radar_summary = [
                "CONFIRMED: wallet and equivalent asset match; amount is within the 97%-100% range.",
                f"Destination hash: {destination_hash_display}",
                f"Destination block: {transfer.get('block_number_int') or transfer.get('block_number') or 'N/A'}",
                f"Token: {token}",
                f"Amount sent: {transfer.get('origin_amount')} {token}",
                f"Amount received: {transfer.get('destination_amount')} {token}",
                f"Estimated fee difference: {format_fee_percent(transfer.get('fee_percent'))}%",
                f"Destination block time: {transfer_time}",
            ]
        if (
            transfer.get("origin_value_usd") is not None
            and transfer.get("destination_value_usd") is not None
            and transfer.get("efficiency_percent") is not None
        ):
            historical_value_summary = (
                f"Estimated USD sent: ${transfer['origin_value_usd']}; "
                f"received: ${transfer['destination_value_usd']}; "
                f"value efficiency: {transfer['efficiency_percent']}%."
            )
    elif isinstance(radar, dict) and radar.get("state") == "candidates":
        radar_summary = [
            (
                "NOT CONFIRMED: no candidate matched either the same-token 97%-100% "
                "range or the enabled different-token USD-value range (85%-98%)."
                if radar.get("swap_matching_enabled")
                else "NOT CONFIRMED: no candidate matched the asset equivalence and amount range (97%-100%)."
            ),
            f"Time-window candidates for review: {len(radar.get('candidates', []))}",
        ]
    elif isinstance(radar, dict) and radar.get("state") == "incomplete":
        radar_summary = [
            "PARTIAL SEARCH: Alchemy indicated that more result pages are available.",
            f"Time-window candidates recorded: {len(radar.get('candidates', []))}",
        ]
    elif isinstance(radar, dict) and radar.get("state") == "not_found":
        radar_summary = [
            "NOT CONFIRMED: no compatible incoming transfer was found in the queried windows.",
            (
                "Last time searched: "
                + format_utc_timestamp(radar["searched_through"])
                if isinstance(radar.get("searched_through"), int)
                else "Last time searched: N/A"
            ),
            (
                "Full 48-hour window available: "
                + ("yes" if radar.get("full_48h_available") else "no")
            ),
        ]
    elif isinstance(radar, dict) and radar.get("state") == "waiting_for_destination_chain":
        radar_summary = [
            "PENDING: the destination chain has not yet reached the source block timestamp."
        ]
    elif isinstance(radar, dict) and radar.get("state") == "error":
        radar_summary = [
            f"ERROR: {radar.get('error', 'the radar query could not be completed')}"
        ]
    else:
        radar_summary = [
            "NOT RUN: the radar was not run because the source failed or block data is missing."
        ]
    if isinstance(radar, dict) and radar.get("state") in {"candidates", "incomplete"}:
        for candidate in radar.get("candidates", [])[:5]:
            if not isinstance(candidate, dict):
                continue
            candidate_hash = candidate.get("hash")
            candidate_url = build_transaction_explorer_url(
                result.get("destination_chain"),
                candidate_hash,
            )
            if candidate_url and isinstance(candidate_hash, str):
                radar_summary.append(
                    f"Candidate destination hash: [{candidate_hash}]({candidate_url})"
                )
    if isinstance(radar, dict) and radar.get("swap_matching_enabled"):
        radar_summary.append("Different-token USD-value matching: enabled")
    if isinstance(radar, dict) and radar.get("swap_error"):
        radar_summary.append(
            "Historical price lookup: "
            + escape_markdown_text(radar["swap_error"])
        )
    if isinstance(radar, dict) and radar.get("price_error"):
        radar_summary.append(
        "Historical price lookup: "
        + escape_markdown_text(radar["price_error"])
        )
    reference_check = radar.get("reference_check") if isinstance(radar, dict) else None
    if isinstance(reference_check, dict):
        reference_summary = [
            f"Status: {reference_check.get('status', 'Not checked')}",
            "Detail: "
            + escape_markdown_text(
                reference_check.get("detail", "No details available.")
            ),
            (
                "Source hash in destination input: "
                + ("yes" if reference_check.get("origin_hash_in_input") else "no")
            ),
            (
                "Source hash in destination logs: "
                + ("yes" if reference_check.get("origin_hash_in_logs") else "no")
            ),
            (
                "Source sender referenced: "
                + (
                    "yes"
                    if reference_check.get("origin_sender_in_input")
                    or reference_check.get("origin_sender_in_logs")
                    else "no"
                )
            ),
            "Bridge/router identified: "
            + (
                ", ".join(
                    escape_markdown_text(name)
                    for name in reference_check.get("bridge_names", [])
                )
                or "none"
            ),
        ]

    bridge_matches = result.get("bridge_matches", [])
    bridges = (
        "; ".join(
            dict.fromkeys(
                f"{match.get('name', match.get('protocol', 'Bridge'))} "
                f"[{match.get('address', 'address N/A')}]"
                for match in bridge_matches
            )
        )
        if bridge_matches
        else "Not detected in local catalog"
    )
    origin_assets = result.get("origin_assets", [])
    assets_summary = (
        "; ".join(
            f"{asset.get('amount', 'N/A')} "
            f"{escape_markdown_text(asset.get('symbol', 'asset'))} "
            f"({asset.get('token_address') or 'native'})"
            for asset in origin_assets
        )
        if origin_assets
        else "Not identified in receipt"
    )
    origin_state = (
        "SUCCESS" if result.get("status") == "0x1" else "FAILED"
    )
    origin_hash = result.get("tx_hash")
    origin_url = build_transaction_explorer_url(result.get("chain"), origin_hash)
    origin_hash_display = (
        f"[{origin_hash}]({origin_url})"
        if origin_url
        else str(origin_hash or "Unavailable")
    )
    source_detection = result.get("source_network_detection", "Manual selection")
    origin_timestamp = result.get("origin_timestamp")
    source_time = (
        format_utc_timestamp(origin_timestamp)
        if isinstance(origin_timestamp, int)
        else "Unavailable"
    )

    return "\n".join(
        [
            "## 4kiscan — Internal transaction audit",
            "",
            "**Source transaction**",
            f"- Hash: {origin_hash_display}",
            f"- Network: {result.get('chain', 'N/A')}",
            f"- Network selection: {source_detection}",
            f"- Source timestamp: {source_time}",
            f"- Status: {origin_state}",
            f"- Verdict: {result.get('title', 'N/A')} [{result.get('status_code', 'N/A')}]",
            "",
            "**Destination**",
            f"- Wallet: `{result.get('destination_wallet', 'N/A')}`",
            f"- Network: {result.get('destination_chain', 'N/A')}",
            "",
            "**Operation Classification**",
            f"- Category: {classification['category']}",
            f"- Operation Type: {classification['operation_type']}",
            f"- Network Route: {classification['network_route']}",
            f"- Asset Flow: {classification['asset_flow']}",
            f"- Verification Method: {classification['verification_method']}",
            "",
            "**Route and source assets**",
            f"- Bridge/router: {bridges}",
            f"- Assets/amounts: {assets_summary}",
            "",
            "**Historical USD value comparison**",
            historical_value_summary,
            "",
            "**Destination radar**",
            *[f"- {line}" for line in radar_summary],
            "",
            "**Destination logs/reference inspection**",
            *[f"- {line}" for line in reference_summary],
            "",
            "> A wallet, asset, amount, and time correlation alone does not prove "
            "causation between the hashes. A verified bridge reference requires the "
            "source hash in calldata to a catalogued bridge/router or in a log emitted "
            "by one.",
        ]
    )


def build_transaction_explorer_url(
    chain_name: Any,
    tx_hash: Any,
) -> Optional[str]:
    if not isinstance(chain_name, str) or not isinstance(tx_hash, str):
        return None
    explorer_base_url = BLOCK_EXPLORER_BASE_URLS.get(chain_name)
    if explorer_base_url is None or not TX_HASH_PATTERN.fullmatch(tx_hash):
        return None
    return f"{explorer_base_url}/tx/{tx_hash}"


def transaction_explorer_markdown(chain_name: str, tx_hash: Any) -> str:
    explorer_url = build_transaction_explorer_url(chain_name, tx_hash)
    if explorer_url is None or not isinstance(tx_hash, str):
        return "Unavailable"
    return f"[`{tx_hash}`]({explorer_url})"


def escape_markdown_text(value: Any) -> str:
    return re.sub(
        r"([\\`*_{}\[\]()#+.!|<>~-])",
        r"\\\1",
        str(value),
    )


def copy_button(text: str) -> None:
    escaped_text = json.dumps(text)
    components.html(
        f"""
        <button id="copy-response" style="padding:8px 14px;cursor:pointer">
            Copy report
        </button>
        <span id="copy-status" aria-live="polite"></span>
        <script>
        const responseText = {escaped_text};
        document.getElementById("copy-response").addEventListener("click", async () => {{
            try {{
                await navigator.clipboard.writeText(responseText);
                document.getElementById("copy-status").textContent = " Copied";
            }} catch (error) {{
                document.getElementById("copy-status").textContent =
                    " Could not copy; select the text and copy it manually.";
            }}
        }});
        </script>
        """,
        height=44,
    )


def main() -> None:
    st.title("🔎 4kiscan")
    st.caption(
        "Internal EVM transaction triage. The sender may be an exchange hot wallet "
        "and does not have to match the destination wallet. Expanded catalog of known "
        "routers, pools, and bridges; a match identifies a possible route, not delivery."
    )

    api_key = get_alchemy_api_key()
    tx_hash = st.text_input(
        "Transaction Hash",
        placeholder="0x + 64 hexadecimal characters",
        key="transaction_hash_input",
    ).strip()
    network_names = list(CHAINS)
    source_network_key = "source_network_selection"
    st.session_state.setdefault(source_network_key, network_names[0])

    detection_key = "_detected_transaction_hash"
    detection_result_key = "_transaction_network_detection"
    detection_result = st.session_state.get(detection_result_key)
    valid_tx_hash = bool(TX_HASH_PATTERN.fullmatch(tx_hash))
    detection_unblocked = (
        st.session_state.get(detection_key) == tx_hash
        and isinstance(detection_result, dict)
        and detection_result.get("state") == "unavailable"
        and bool(api_key)
    )
    if valid_tx_hash and (
        st.session_state.get(detection_key) != tx_hash or detection_unblocked
    ):
        if api_key:
            with st.spinner("Detecting the source network across supported chains..."):
                detection_result = detect_transaction_network(tx_hash, api_key)
        else:
            detection_result = {
                "state": "unavailable",
                "networks": [],
                "errors": [],
            }
        st.session_state[detection_key] = tx_hash
        st.session_state[detection_result_key] = detection_result
        if detection_result["state"] == "detected":
            st.session_state[source_network_key] = detection_result["networks"][0]

    chain_name = st.selectbox(
        "Source Network",
        network_names,
        key=source_network_key,
    )
    if valid_tx_hash and isinstance(detection_result, dict):
        detection_state = detection_result.get("state")
        detected_networks = detection_result.get("networks", [])
        if detection_state == "detected" and detected_networks:
            detected_network = detected_networks[0]
            if chain_name == detected_network:
                st.success(f"Source network automatically detected: {detected_network}.")
                network_detection_report = f"Automatically detected: {detected_network}"
            else:
                st.info(
                    f"Detected {detected_network}; currently using the manually "
                    f"selected network {chain_name}."
                )
                network_detection_report = (
                    f"Automatically detected {detected_network}; manually overridden "
                    f"to {chain_name}"
                )
        elif detection_state == "ambiguous":
            st.warning(
                "The transaction hash was found on multiple networks "
                f"({', '.join(detected_networks)}). Select the source network manually."
            )
            network_detection_report = (
                f"Ambiguous across {', '.join(detected_networks)}; "
                f"manual selection: {chain_name}"
            )
        elif detection_state == "not_found":
            st.info(
                "The hash was not found on the supported networks; select the source "
                "network manually."
            )
            network_detection_report = f"Not found automatically; manual selection: {chain_name}"
        elif detection_state == "incomplete":
            st.warning(
                "Automatic detection could not query every network. Select the source "
                f"network manually. {'; '.join(detection_result.get('errors', []))}"
            )
            network_detection_report = (
                f"Detection incomplete; manual selection: {chain_name}"
            )
        elif detection_state == "unavailable":
            st.info(
                "Automatic detection is unavailable until the Alchemy API key is "
                "configured. Select the source network manually."
            )
            network_detection_report = f"Unavailable; manual selection: {chain_name}"
        else:
            network_detection_report = f"Manual selection: {chain_name}"
    else:
        network_detection_report = f"Manual selection: {chain_name}"

    destination_wallet = st.text_input(
        "Destination Wallet",
        placeholder="0x + 40 hexadecimal characters",
        key="destination_wallet_input",
    ).strip()
    destination_chain = st.selectbox(
        "Destination Network",
        network_names,
        index=network_names.index("Arbitrum"),
        key="destination_network_selection",
    )

    analyze = st.button(
        "Analyze Transaction",
        type="primary",
    )
    if not analyze:
        return
    if not api_key:
        st.error(
            "Alchemy API key is not configured. Set ALCHEMY_API_KEY in "
            "Streamlit Community Cloud secrets or the app environment."
        )
        return
    if not TX_HASH_PATTERN.fullmatch(tx_hash):
        st.error("The hash must start with 0x and contain 64 hexadecimal characters.")
        return
    if not ADDRESS_PATTERN.fullmatch(destination_wallet):
        st.error("The destination wallet must be a valid EVM address (0x + 40 characters).")
        return

    try:
        with st.spinner(f"Querying {chain_name} through Alchemy..."):
            transaction, receipt = fetch_transaction_and_receipt(
                chain_name,
                api_key,
                tx_hash,
            )
    except RpcError as error:
        show_rpc_error(error)
        return

    if receipt is None:
        st.warning(
            "Alchemy found the transaction, but no receipt is available yet. "
            "It may be pending inclusion or confirmation."
        )
        return

    try:
        result = diagnose_transaction(
            chain_name,
            tx_hash,
            destination_wallet,
            transaction,
            receipt,
            destination_chain,
            api_key,
        )
    except RpcError as error:
        show_rpc_error(error)
        return

    result["destination_chain"] = destination_chain
    result["source_network_detection"] = network_detection_report
    result["radar"] = None
    st.subheader("Destination Radar (Receiving Network)")
    if result["status"] != "0x1":
        st.info("The radar was not run because the source transaction did not succeed.")
    elif receipt.get("blockNumber") is None:
        st.warning(
            "The radar cannot start: the source receipt does not include the block "
            "needed to retrieve its timestamp."
        )
    else:
        try:
            with st.spinner(
                f"Searching {destination_chain} incoming transfers across time windows..."
            ):
                origin_timestamp = fetch_block_timestamp(
                    chain_name,
                    api_key,
                    receipt["blockNumber"],
                )
                radar_result = scan_destination_radar(
                    api_key,
                    destination_chain,
                    destination_wallet,
                    origin_timestamp,
                    result["origin_assets"],
                    origin_chain=chain_name,
                )
            result["origin_timestamp"] = origin_timestamp
            result["radar"] = radar_result
            transfer_for_inspection = (
                radar_result.get("transfer")
                if radar_result["state"] == "found"
                else (
                    radar_result["candidates"][0]
                    if radar_result.get("candidates")
                    else None
                )
            )
            if isinstance(transfer_for_inspection, dict):
                transfer = transfer_for_inspection
                origin_asset = transfer.get("matched_origin_asset")
                destination_asset = transfer.get("destination_asset")
                if isinstance(origin_asset, dict) and isinstance(destination_asset, dict):
                    try:
                        usd_comparison = compare_historical_usd_values(
                            origin_asset,
                            destination_asset,
                            chain_name,
                            destination_chain,
                            origin_timestamp,
                            transfer["timestamp"],
                        )
                    except DefiLlamaError as error:
                        radar_result["price_error"] = str(error)
                    else:
                        if usd_comparison is not None:
                            transfer["origin_value_usd"] = usd_comparison[
                                "origin_usd"
                            ].quantize(Decimal("0.01"))
                            transfer["destination_value_usd"] = usd_comparison[
                                "destination_usd"
                            ].quantize(Decimal("0.01"))
                            transfer["efficiency_percent"] = usd_comparison[
                                "efficiency_percent"
                            ].quantize(Decimal("0.01"))
                        elif not radar_result.get("price_error"):
                            radar_result["price_error"] = (
                                "DefiLlama did not return a historical price for the "
                                "source or destination asset."
                            )

                with st.spinner("Inspecting destination transaction references..."):
                    reference_check = verify_destination_bridge_reference(
                        api_key,
                        destination_chain,
                        transfer.get("hash"),
                        tx_hash,
                        transaction.get("from"),
                    )
                radar_result["reference_check"] = reference_check
                transfer["reference_check"] = reference_check

            if radar_result.get("swap_error"):
                st.warning(
                    "Swap price matching could not be completed; same-token "
                    f"matching remains available. {radar_result['swap_error']}"
                )
            if radar_result.get("price_error"):
                st.warning(
                    "Historical USD comparison could not be completed. Existing "
                    f"same-token or swap matching is unchanged. {radar_result['price_error']}"
                )
            if radar_result["state"] == "found":
                transfer = radar_result["transfer"]
                classification = classify_operation(result)
                result["operation_classification"] = classification
                result["color"] = "green"
                result["indicator"] = "🟢"
                result["title"] = classification["verdict"]
                if classification["category"] == "Same-Network Transfer":
                    result["status_code"] = "SAME_NETWORK_TRANSFER_CONFIRMED"
                elif classification["category"] == "Same-Network Swap":
                    result["status_code"] = "SAME_NETWORK_SWAP_CONFIRMED"
                elif classification["category"] == "Cross-Chain Bridge":
                    result["status_code"] = "CROSS_CHAIN_BRIDGE_CONFIRMED"
                else:
                    result["status_code"] = "CROSS_CHAIN_SWAP_CONFIRMED"
                if radar_result.get("match_type") == "swap":
                    result["notes"] = (
                        f"Different-token transfer matched by historical USD value: "
                        f"${transfer.get('destination_value_usd')} received vs "
                        f"${transfer.get('origin_value_usd')} sent "
                        f"({transfer.get('efficiency_percent')}% value efficiency)."
                    )
                else:
                    formatted_fee = format_fee_percent(
                        transfer.get("fee_percent")
                    )
                    result["notes"] = (
                        f"The radar found a qualifying incoming transfer to the specified "
                        f"wallet on {destination_chain}: received "
                        f"{transfer.get('destination_amount')} "
                        f"{transfer.get('matched_asset', transfer['asset'])}, from "
                        f"{transfer.get('origin_amount')} "
                        f"{transfer.get('matched_asset', transfer['asset'])} at source. "
                        f"Estimated variation: {formatted_fee}%."
                    )
            if radar_result["state"] == "found":
                transfer = radar_result["transfer"]
                transfer_time = format_utc_timestamp(transfer["timestamp"])
                classification = result["operation_classification"]
                st.success(f"🟢 {classification['verdict']}:")
                st.markdown(
                    "**Destination hash:** "
                    + transaction_explorer_markdown(
                        destination_chain,
                        transfer.get("hash"),
                    )
                )
                st.write(
                    f"**Destination block:** "
                    f"{transfer.get('block_number_int') or transfer.get('block_number') or 'Unavailable'}"
                )
                if radar_result.get("match_type") == "swap":
                    st.write(
                        f"**Source asset and amount:** "
                        f"{transfer.get('origin_amount')} {transfer.get('origin_symbol')}"
                    )
                    st.write(
                        f"**Received asset and amount:** "
                        f"{transfer.get('destination_amount')} {transfer.get('destination_symbol')}"
                    )
                    st.write(
                        f"**Estimated USD Received:** "
                        f"${transfer.get('destination_value_usd')} vs Sent: "
                        f"${transfer.get('origin_value_usd')} "
                        f"(Efficiency: {transfer.get('efficiency_percent')}%)"
                    )
                else:
                    st.write(
                        f"**Identified token:** "
                        f"{transfer.get('matched_asset', transfer['asset'])}"
                    )
                    st.write(
                        f"**Amount sent:** {transfer.get('origin_amount')} "
                        f"{transfer.get('matched_asset', transfer['asset'])}"
                    )
                    st.write(
                        f"**Amount received:** {transfer.get('destination_amount')} "
                        f"{transfer.get('matched_asset', transfer['asset'])}"
                    )
                    st.write(
                        f"**Estimated fee:** "
                        f"{format_fee_percent(transfer.get('fee_percent'))}%"
                    )
                    if (
                        transfer.get("origin_value_usd") is not None
                        and transfer.get("destination_value_usd") is not None
                        and transfer.get("efficiency_percent") is not None
                    ):
                        st.write(
                            f"**Estimated USD Received:** "
                            f"${transfer['destination_value_usd']} vs Sent: "
                            f"${transfer['origin_value_usd']} "
                            f"(Efficiency: {transfer['efficiency_percent']}%)"
                        )
                    else:
                        st.caption(
                            "Historical USD pricing was unavailable; the same-token "
                            "match uses the existing 97%-100% amount validation."
                        )
                st.write(f"**Destination wallet:** `{transfer['to']}`")
                st.write(f"**Estimated destination block time:** {transfer_time}")
                reference_check = radar_result.get("reference_check", {})
                if isinstance(reference_check, dict):
                    reference_status = reference_check.get(
                        "status",
                        "Not checked",
                    )
                    st.write(
                        f"**Destination bridge reference status:** {reference_status}"
                    )
                    bridge_names = reference_check.get("bridge_names", [])
                    if bridge_names:
                        st.write(
                            "**Bridge/router referenced:** "
                            + ", ".join(bridge_names)
                        )
                    if reference_status == "Verified Bridge Reference":
                        st.success(reference_check["detail"])
                    elif reference_status == "Lookup failed":
                        st.warning(reference_check["detail"])
                    else:
                        st.caption(reference_check.get("detail", ""))
                if radar_result.get("match_type") == "swap":
                    st.caption(
                        "Historical USD pricing is an estimate from DefiLlama, not an "
                        "execution quote. The 85%-98% value range does not prove a "
                        "cryptographic link between the source and destination hashes."
                    )
                else:
                    st.caption(
                        "A match requires the same wallet and equivalent logical asset; the "
                        "received amount must be between 97% and 100% of the sent amount. "
                        "The fee is an arithmetic estimate; temporal correlation alone does "
                        "not prove a cryptographic link between the hashes."
                    )
            elif radar_result["state"] == "waiting_for_destination_chain":
                st.info(
                    f"The latest {destination_chain} block header has a timestamp "
                    "earlier than the source block. The radar found no destination "
                    "range to query; try again later."
                )
            elif radar_result["state"] in {"candidates", "incomplete"}:
                if radar_result["candidates"]:
                    route_label = (
                        "same-network"
                        if destination_chain == chain_name
                        else "cross-network"
                    )
                    result["color"] = "yellow"
                    result["indicator"] = "🟡"
                    result["title"] = (
                        f"Source successful; {route_label} candidates found without "
                        "a verified asset/value match"
                    )
                    result["status_code"] = "DESTINATION_CANDIDATES_UNVERIFIED"
                    result["notes"] = (
                        "Incoming transfers to the wallet were found in the queried "
                        "windows, but none matched the required same-token amount range "
                        "or different-token historical USD range. The operation is not "
                        "confirmed."
                    )
                    candidate_reference = radar_result.get("reference_check")
                    if isinstance(candidate_reference, dict):
                        st.write(
                            "**Top candidate reference status:** "
                            f"{candidate_reference.get('status', 'Not checked')}"
                        )
                        st.caption(candidate_reference.get("detail", ""))
                    st.warning(
                        "Possible incoming transfers: none matched the same-token "
                        "97%-100% range or the different-token 85%-98% historical USD "
                        "value range, so credit is not confirmed."
                    )
                    for candidate in radar_result["candidates"][:10]:
                        candidate_time = format_utc_timestamp(
                            candidate["timestamp"]
                        )
                        st.write(
                            f"- Hash: "
                            + transaction_explorer_markdown(
                                destination_chain,
                                candidate.get("hash"),
                            )
                            + f" | Block {candidate.get('block_number_int') or 'N/A'} | "
                            f"{candidate.get('value', 'amount N/A')} "
                            f"{candidate.get('asset', 'asset N/A')} | {candidate_time}"
                        )
                if radar_result["state"] == "incomplete":
                    st.warning(
                        "Alchemy reported more results; the search is partial. Retry "
                        "or verify the activity in the block explorer."
                    )
                if not radar_result["candidates"]:
                    st.warning(
                        "No eligible token and amount match was found. "
                        + (
                            "The search was partial because Alchemy reported more "
                            "results."
                            if radar_result["state"] == "incomplete"
                            else "There were no incoming candidates in the queried windows."
                        )
                    )
            else:
                total_checked = sum(
                    window["transfers_checked"] for window in radar_result["windows"]
                )
                searched_through = format_utc_timestamp(
                    radar_result["searched_through"]
                )
                if destination_chain == chain_name:
                    st.info(
                        "No qualifying incoming transfer was found on the selected "
                        "network. The operation remains unconfirmed by the radar."
                    )
                else:
                    st.info(
                        "No incoming transfer to the wallet was found in the available "
                        "range. The bridge may still be processing the operation, or "
                        "crediting may take longer."
                    )
                st.caption(
                    f"Progressive windows completed (1 min, 5 min, 30 min, 4 h, and 48 h); "
                    f"{total_checked} transfers "
                    f"checked through {searched_through}. "
                    f"Block estimate: {radar_result['estimate_source']}."
                    + (
                        " The full 48-hour period has not elapsed yet; check again later."
                        if not radar_result["full_48h_available"]
                        else ""
                    )
                )
        except RpcError as error:
            result["radar"] = {"state": "error", "error": str(error)}
            st.warning(
                "The Destination Radar could not be completed. The source diagnosis "
                f"remains unchanged: {error}"
            )

    if not isinstance(result.get("operation_classification"), dict):
        result["operation_classification"] = classify_operation(result)

    if result["logs_warning"]:
        st.warning(result["logs_warning"])

    st.markdown(
        f"""
        <div class="traffic-box traffic-{result['color']}">
            <span class="traffic-icon">{result['indicator']}</span>
            <strong>{html.escape(result['title'])}</strong>
            <div>{html.escape(result['notes'])}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.subheader("📋 Internal Audit Report")
    audit_report = build_audit_report(result)
    with st.container(border=True, key="audit_report"):
        st.markdown(audit_report)
    copy_button(audit_report)

    st.subheader("Observed Data")
    st.markdown(
        "**Source hash:** "
        + transaction_explorer_markdown(chain_name, tx_hash)
    )
    left, middle, right = st.columns(3)
    left.metric("Receipt Status", "Success" if result["status"] == "0x1" else "Failed")
    middle.metric("Block", result["block_number"] or "Pending")
    right.metric("Logs", result["log_count"])
    if result.get("origin_timestamp") is not None:
        origin_time_display = format_utc_timestamp(result["origin_timestamp"])
        st.write(f"**Source Timestamp:** {origin_time_display}")
    st.write(f"**Sender (`from`):** `{result['from'] or 'N/A'}`")
    st.write(
        f"**Sender matches destination wallet:** "
        f"{'Yes' if result['sender_matches_destination'] else 'No; may be a CEX or intermediary'}"
    )
    st.write(f"**Contract/recipient (`to`):** `{result['to']}`")
    st.write(f"**Expected destination wallet:** `{result['destination_wallet']}`")
    st.write(f"**Native value:** {result['native_value']}")
    st.write("**Source assets and amounts:**")
    if result["origin_assets"]:
        for asset in result["origin_assets"]:
            token_detail = (
                f" (`{asset['token_address']}`)"
                if asset.get("token_address")
                else " (native)"
            )
            st.write(
                f"- {asset['amount']} {asset['symbol']}{token_detail}; "
                f"evidence: {asset['evidence']}"
            )
    else:
        st.caption("No asset movements could be extracted from the source receipt.")
    st.write(
        f"**Direct native credit to destination:** "
        f"{'Yes' if result['direct_native_credit'] else 'No'}"
    )
    st.write(
        f"**ERC-20 Transfer events to destination:** {len(result['matching_transfers'])}"
    )
    if result["bridge_matches"]:
        st.write(
            "**Detected intermediary / bridge:** "
            + ", ".join(result["bridge_protocols"])
        )
        with st.expander("Identified bridge/router contracts"):
            for match in result["bridge_matches"]:
                st.markdown(
                    f"- **{match['name']}** — {match['type']} "
                    f"(`{match['address']}`); evidence: "
                    f"{', '.join(match['evidence'])}"
                )
            st.caption(
                "References in calldata or log data are catalog clues; they do not "
                "by themselves prove a contract call or delivery."
            )
    else:
        st.write(
            "**Detected intermediary / bridge:** "
            "Not recognized in the local catalog"
        )

    with st.expander(f"ERC-20 Transfer Events ({len(result['transfers'])})"):
        if result["transfers"]:
            st.json(result["transfers"])
        else:
            st.caption("The receipt contains no recognized ERC-20 Transfer events.")

    with st.expander("Full JSON Receipt"):
        st.json(result["receipt"])
    st.caption("4kiscan · Internal cross-chain transaction triage")

if __name__ == "__main__":
    main()
