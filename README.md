# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/84b3f0fd-688b-4d3d-948d-d202751302d4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 4kiscan Streamlit transaction triage

The EVM transaction checker in `app.py` runs separately from the Vite interface:

1. Install Python dependencies: `pip install -r requirements.txt`
2. Start Streamlit: `streamlit run app.py`
3. Select the origin and destination chains, enter the origin transaction hash
   and expected destination wallet. Configure `ALCHEMY_API_KEY` in Streamlit
   Community Cloud's app secrets (or in a local `.streamlit/secrets.toml` file);
   the key is not entered or displayed in the app. The app reads the origin
   transaction and receipt using Alchemy JSON-RPC, then reads the origin block
   timestamp.
4. The destination radar extracts native value and relevant ERC-20 `Transfer`
   amounts from the source transaction, then estimates destination block ranges
   from the latest observed block interval and searches inbound asset transfers
   to the wallet through progressively wider windows (1 minute, 5 minutes,
   30 minutes, 4 hours, and 48 hours) with
   `alchemy_getAssetTransfers`. It uses block timestamps from transfer metadata
   to filter approximate block ranges and paginates up to five 1,000-result pages
   per window. Internal transfers are requested only on Ethereum, Polygon, and
   Base, where Alchemy documents support for that category.

A radar result is marked green only when an inbound transfer matches the
expected destination wallet and a token equivalence group, and its amount is
between 97% and 100% of the source amount. The local deployment map covers
USDC (including listed bridged variants), USDT, WETH, eETH, and weETH on
configured networks. It intentionally only equates deployments listed for that
network; Optimism USDT includes the legacy bridged USDT and the listed USDT0
deployment. If token IDs differ, the radar also compares normalized symbol/name
labels (including USD₮, USDT0, Tether USD, and USD Coin aliases); an exact label
match permits amount evaluation but does not bypass the 97%-100% amount range.
eETH and weETH remain separate assets. A fee estimate is calculated as
`(source amount - destination amount) / source amount`; it is not a bridge quote
or proof of a protocol fee. Candidates outside the allowed amount range or with
unmapped tokens are displayed in yellow. Even an eligible match is not
cryptographic proof that the destination hash is causally linked to the source
transaction.
No match means no eligible inbound transfer was found in the searched windows,
not proof that the bridge failed.

After the traffic-light verdict, the Streamlit app displays a concise internal
audit/triage report with source and destination transaction details, detected
bridge/router, extracted source assets, and the destination radar outcome.
The source and detected destination hashes link to their network-specific block
explorers. The copy button copies this report verbatim, including Markdown links;
it is not a customer-facing reply.

The expanded local per-network catalog covers Across SpokePools, Stargate V1/V2
routers, bridges and pools, Hop bridges and AMM contracts, Celer cBridge,
LayerZero endpoints, LI.FI and Socket routers, and selected Polygon PoS,
Optimism/Base, and Arbitrum native bridge gateways. Deployments vary by chain and
the catalog is not exhaustive. A Rhino.fi StarkEx proxy is included as a
candidate match rather than a verified current deposit router. Unknown contracts
are still analyzed and displayed as addresses rather than causing the analysis
to fail.

Bridge matching checks `transaction.to`, calldata, log emitters, indexed event
topics, and address-shaped values in log data. Calldata and log-data matches are
indications only: they can reference a catalogued address without proving the
contract was called or that a cross-chain transfer was delivered. The catalog is
for support triage, may include candidate entries, and should not be treated as
an authoritative protocol registry. Such matches remain yellow unless the source
receipt independently shows a credit to the expected wallet.

The sender is shown as observed on-chain data and is not required to match the
expected destination wallet; it may be an exchange or intermediary. A matching
catalog entry identifies a likely protocol route only. The destination radar
queries the selected destination chain and reports the matched destination hash,
block, token, and amount when all strict match conditions are met.
