# Token Risk API (official Autonomo API)

A rug-risk check for tokens launched on the Robinhood Chain launchpad, read straight from the chain.

```
GET /v1/risk/<token address>      header: x-api-key: <RISK_API_KEY>
```

| Field | Meaning |
| --- | --- |
| `risk.level`, `risk.score`, `risk.flags` | low / medium / high, with plain-English reasons |
| `holders` | Holder count, largest wallet and top-10 share of circulating supply, top 5 wallets |
| `supply` | Share still in the bonding curve, burned, held by the creator, and held by launch-block buyers |
| `trading` | Buys, sells (all time and 24 h), unique buyers, how many still hold, ETH volume |
| `market` | Price, market cap and bonding curve progress |
| `launch` | Launch time, creator, curve and launch tx |

Errors: `400 bad_token` (not an address), `404 not_found` (no launchpad launch in the last ~13 days). Through an
Autonomo gateway, errors are never charged: payments only settle on answers below 400.

## How it works

1. Finds the token's launch event on the launchpad factory `0x7ed598bc…ec7e` (creator, curve, launch block).
2. Replays every transfer since launch to get exact balances. Circulating supply excludes the curve and burns.
3. Reads the curve's buy and sell events for ETH volume, launch-block buyers and the creator's own trades.
4. Scores: one wallet or the top 10 holding too much, the creator holding or dumping, launch-block buyers
   (often bundled with the launch) still holding a lot, very few holders, most buyers already gone (bot volume),
   and sell pressure.

Results are cached for 60 seconds. This is a heuristic, not advice: a low score does not make a token safe.

## Run and deploy

Same setup as `examples/launches-api`: a plain Vercel project. Env: `RISK_API_KEY` (callers send it as
`x-api-key`; without it the API is open, for local use), optional `ROBINHOOD_RPC_URL` and `BASE_RPC_URL`.
Gateway upstream: `https://risk.autonomo.fun/v1`, auth header `x-api-key`. Use the slug `token-risk` so the
Agent Playground can route risk questions to it.
