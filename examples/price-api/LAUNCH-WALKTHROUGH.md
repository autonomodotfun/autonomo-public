# Launching the $AUTONOMO Price API on Autonomo (live demo)

The example API is deployed at `https://price.autonomo.fun` (Vercel project `autonomo-price-api`) and only answers requests that carry its secret key, so the paywall can't be skipped.

## Before you start

- [x] `GATEWAY_SECRET_KEY` is set on the **autonomo** Vercel project, so the launch form can store the API's key encrypted.
- [ ] You have the price API's key: it's `PRICE_API_KEY` in the project's root `.env.local`. Keep it off camera.

## Launch it (this is the part to record)

1. Open **autonomo.fun/dashboard** and sign in.
2. Click **Launch an API** and fill in:

   | Field | Value |
   | --- | --- |
   | API name | `Token Price` |
   | Gateway URL | `token-price` |
   | What does it do? | `Live $AUTONOMO price from on-chain trades` |
   | Upstream base URL | `https://price.autonomo.fun/v1` |
   | Auth header | `X-API-Key` |
   | Auth secret | the `PRICE_API_KEY` value (paste it; it's hidden as you type) |
   | USDG price | `0.01` (covers the settlement gas about twice) |
   | $AUTONOMO | `1000` per call (≈ $0.015 at today's price) |

3. Click **Launch API**. Your gateway is `https://autonomo.fun/x/token-price`.

## Show it's paywalled

```bash
curl -i https://autonomo.fun/x/token-price/price/autonomo
```

You should see `402 Payment Required` and a `PAYMENT-REQUIRED` header with the price.

## Show the API itself is locked

```bash
curl -i https://price.autonomo.fun/v1/price/autonomo
```

You should see `401 unauthorized`. Only the gateway, which adds the key, can get the price.

## Next: an agent pays

A demo agent script pays $0.01 in USDG (or 1,000 $AUTONOMO) from a test wallet and prints the price it got back. It needs a fresh wallet with a little USDG on Robinhood Chain, with its key in `.env.local`.

## What the API returns (after payment)

```json
{
  "token": "AUTONOMO",
  "priceEth": 6.5e-9,
  "priceUsd": 0.0000154,
  "ethUsd": 2363.05,
  "lastTrade": { "side": "buy", "tokens": 1542998, "eth": 0.0099, "tx": "0x…", "time": "…" },
  "source": "Latest trade on the $AUTONOMO bonding curve (Robinhood Chain); ETH/USD from Chainlink on Base."
}
```
