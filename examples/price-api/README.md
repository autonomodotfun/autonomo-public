# $AUTONOMO Price API (tutorial example)

A tiny API used to show how to launch an API on Autonomo. One endpoint:

```
GET /v1/price/autonomo
x-api-key: <PRICE_API_KEY>
```

Returns the price of the latest real $AUTONOMO trade on its launchpad bonding curve (Robinhood Chain), in ETH and USD (ETH/USD from Chainlink on Base). All data is read from public chains.

The key means only your Autonomo gateway can call it: launch it on autonomo.fun with the auth header `X-API-Key` and the same secret, and agents pay per call through `autonomo.fun/x/<your-slug>/price/autonomo`.

Deploy as its own Vercel project from this folder, with `PRICE_API_KEY` set.
