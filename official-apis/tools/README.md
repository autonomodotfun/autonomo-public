# Autonomo tools API (all official Autonomo APIs)

Every official Autonomo API in one Vercel project (tools.autonomo.fun), each behind its own Autonomo gateway.
All gateways use the same upstream base, `https://tools.autonomo.fun/v1`, and the same key.

| Gateway slug | Upstream path | What it returns |
| --- | --- | --- |
| `token-price` | `/v1/price/autonomo` | The live $AUTONOMO price (same as token-lookup for $AUTONOMO) |
| `new-launches` | `/v1/launches?limit=10` | The newest Robinhood Chain launchpad tokens: age, buys, sells, market cap, curve progress |
| `token-risk` | `/v1/risk/<token>` | Rug-risk score: holder concentration, creator, launch-block buyers, bot volume |
| `token-lookup` | `/v1/price/<token>` | Live price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, once it has graduated, its launchpad Uniswap v4 pool (USDG and WETH too) |
| `tx-explainer` | `/v1/tx/<hash>` | A Robinhood Chain transaction in plain English: launches, curve buys and sells (router and bundled buys grouped), transfers, fee |
| `wallet-portfolio` | `/v1/portfolio/<wallet>?days=2` | ETH, USDG, WETH and $AUTONOMO, plus tokens received in the last 1–7 days, valued in USD; copies of known symbols are flagged as likely impostors |
| `page-reader` | `/v1/page?url=https://…` | Title, description and readable text of a public web page |

All need `x-api-key: <TOOLS_API_KEY>` (open when the variable isn't set, for local use).

## Notes

- Everything is read from public chains (Robinhood Chain RPC; ETH/USD from Chainlink on Base). Launchpad tokens are
  found through the factory's launch event, like the Risk Checker.
- `ROBINHOOD_RPC_URL` (optional, a paid RPC such as Alchemy): with it, Token Risk and Token Lookup find tokens from
  the launchpad's whole history (from block 27,000,000). Without it they search only the last ~13 days, since the
  public RPC caps each log search at 10M blocks and rate limits the many searches an older token needs. Wallet
  Portfolio prices only recent launches either way.
- Portfolio discovery scans incoming transfers within a time budget so answers stay well inside the gateway's 25 s.
- Page reader safety: https only, no credentials, every hop (redirects included) must resolve to a public address,
  max 3 redirects, 2 MB, 10 s, HTML or plain text only.

## Deploy

A plain Vercel project. Every gateway's upstream is `https://tools.autonomo.fun/v1` with auth header `x-api-key` and
the `TOOLS_API_KEY` value; the Agent Playground and the Telegram bot add the right path for each slug above.
Deploy from this folder: `npx vercel deploy --prod`.
