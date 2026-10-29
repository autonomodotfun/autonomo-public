# New Launches API (official Autonomo API)

The newest token launches on the Robinhood Chain launchpad, read straight from the chain.

```
GET /v1/launches?limit=10      header: x-api-key: <LAUNCHES_API_KEY>
```

`limit` is 1–25 (default 10). Each launch has:

| Field | Meaning |
| --- | --- |
| `token`, `name`, `symbol` | The new token |
| `launchedAt`, `ageMinutes` | When it launched |
| `creator`, `curve` | Who launched it and its bonding curve contract |
| `trades` | Buys, sells, unique buyers and ETH volume on the curve since launch |
| `priceEth`, `priceUsd`, `marketCapUsd` | From the latest curve trade; USD via Chainlink ETH/USD on Base |
| `curveProgress` | Net ETH bought into the curve against its graduation target (approximate, fees ignored) |
| `explorer`, `launchTx` | Links to check everything on Blockscout |

## How it works

Every launch emits one event from the launchpad factory `0x7ed598bc…ec7e` with the token, its curve and the
creator. The API reads the newest of those events (in 29,000-block windows, the RPC's limit), then each curve's
buy and sell events. Results are cached for 20 seconds.

## Run and deploy

Same setup as `examples/price-api`: a plain Vercel project with one serverless function.

- Env: `LAUNCHES_API_KEY` (callers must send it as `x-api-key`; without it the API is open, for local use),
  optional `ROBINHOOD_RPC_URL` and `BASE_RPC_URL`.
- Put it behind an Autonomo gateway with the upstream `https://launches.autonomo.fun/v1`, the auth header
  `x-api-key` and the key above, so agents pay per call and never see the key.
