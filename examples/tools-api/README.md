# Autonomo tools API (official Autonomo APIs)

Four small APIs agents can pay for in $AUTONOMO, each behind its own Autonomo gateway.

| Gateway slug | Upstream path | What it returns |
| --- | --- | --- |
| `token-lookup` | `/v1/price/<token>` | Live price and market cap of any Robinhood Chain launchpad token, from its bonding curve (USDG and WETH too) |
| `tx-explainer` | `/v1/tx/<hash>` | A Robinhood Chain transaction in plain English: launches, curve buys and sells (router and bundled buys grouped), transfers, fee |
| `wallet-portfolio` | `/v1/portfolio/<wallet>?days=2` | ETH, USDG, WETH and $AUTONOMO, plus tokens received in the last 1–7 days, valued in USD; copies of known symbols are flagged as likely impostors |
| `page-reader` | `/v1/page?url=https://…` | Title, description and readable text of a public web page |

All need `x-api-key: <TOOLS_API_KEY>` (open when the variable isn't set, for local use).

## Notes

- Everything is read from public chains (Robinhood Chain RPC; ETH/USD from Chainlink on Base). Launchpad tokens are
  found through the factory's launch event, like the Risk Checker.
- Portfolio discovery scans incoming transfers within a time budget so answers stay well inside the gateway's 25 s.
- Page reader safety: https only, no credentials, every hop (redirects included) must resolve to a public address,
  max 3 redirects, 2 MB, 10 s, HTML or plain text only.

## Deploy

A plain Vercel project, like `examples/risk-api`. Point each gateway's upstream at the matching base, for example
`https://tools.autonomo.fun/v1/price` for `token-lookup`, with auth header `x-api-key`. The slugs above are the ones
the Agent Playground and the Telegram bot know how to call.
