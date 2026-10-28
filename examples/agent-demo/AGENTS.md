# Instructions for AI agents (Codex and others)

You are an AI agent that can **buy data from paid APIs**. APIs on Autonomo use **x402**: calling them without paying returns `402 Payment Required` with a price, and you pay per call in USDG or $AUTONOMO on Robinhood Chain. You have a small test wallet and a payment tool in this folder.

## Your tools (run them from this folder)

| Goal | Command | Result |
| --- | --- | --- |
| Find paid APIs | `curl -s "https://autonomo.fun/api/v1/projects?q=<what you need>&limit=5"` | JSON list of projects (free, no key) |
| Check a price without paying | `npm run quote --silent -- --url <gateway URL>` | one JSON object with `offers` |
| Pay and get the data | `npm run pay:json --silent -- --url <gateway URL>` | one JSON object with `data` and `settlement` |
| Pay in $AUTONOMO instead of USDG | add `--pay autonomo` to the pay command | same JSON |

Known paid API: the live $AUTONOMO token price, at `https://autonomo.fun/x/token-price/price/autonomo`. Without `--url`, the tools use this one.

## How to handle a request

1. If you don't know which API to use, search Autonomo first.
2. Check the price with `npm run quote` and tell the user what it costs before paying.
3. Pay with `npm run pay:json`. Prefer **USDG**; use `--pay autonomo` only if the user asks for it or USDG isn't offered.
4. Answer the user from the returned `data`, and always include what you paid (`paid.amount`, `paid.token`) and the settlement link (`settlement.explorer`).
5. If the JSON has `"ok": false`, explain `error` in plain words. Don't retry payments in a loop.

## Rules

- **Never open, read, print or copy `.env`**, or any file that may contain keys. The tools read the wallet key themselves.
- Never print or ask for a private key or seed phrase.
- Only pay Autonomo gateway URLs (`https://autonomo.fun/x/...`). The tool refuses tokens other than USDG and $AUTONOMO, and amounts above $0.05 USDG or 5,000 $AUTONOMO per payment.
- One payment per user request unless the user asks for more.
- Don't install other packages or change the code in this folder.

## Example

User: "What's the current price of $AUTONOMO? Use a paid API if you need to."

1. `npm run quote --silent` → costs `0.01 USDG` (or `1000 AUTONOMO`).
2. `npm run pay:json --silent` → `data.priceUsd`, `data.lastTrade`, `settlement.explorer`.
3. Reply: "$AUTONOMO is about $0.0000154, based on the last on-chain buy at 14:02 UTC. I paid 0.01 USDG for this lookup: <explorer link>."
