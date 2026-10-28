# Agent payment demo

A small "AI agent" that buys one call from an Autonomo gateway with x402 and prints each step: its wallet, the 402 price, the payment, the data it bought, and the settlement transaction on Robinhood Chain.

This folder is self-contained: its own dependencies and its own `.env`.

## Setup (once)

```bash
cd examples/agent-demo
npm install
cp .env.example .env
```

Then open `.env` (in this folder) and set:

```
AGENT_PRIVATE_KEY=0x…   # a dedicated test wallet, never your main one
GATEWAY_URL=https://autonomo.fun/x/token-price/price/autonomo   # optional
```

`.env` is git-ignored and the key is never printed.

## Run

```bash
npm run pay            # pay in USDG
npm run pay:autonomo   # pay in $AUTONOMO (one-time Permit2 approval on the first run)
```

The agent only pays in USDG (max $0.05 per payment) or $AUTONOMO (max 5,000 per payment) on Robinhood Chain.

## Recording the agent payment video

### 1. Fix the gateway (once)

On autonomo.fun/dashboard → **Token Price** → **Settings**: tick **USDG** at `0.01`, keep **$AUTONOMO** at `1000`, make sure the API key is saved, and click **Save changes** (wait for "✓ Changes saved"). The gateway must be **active**.

### 2. Make and fund the agent wallet

- Create a **new** wallet just for the agent, different from the gateway owner's wallet, so viewers see money move from the agent to the owner.
- Fund it on **Robinhood Chain** with about **$0.20 USDG** and, for the $AUTONOMO run, **5,000+ $AUTONOMO** plus a tiny bit of **ETH** (around 0.00005) for the one-time approval.
- Export its private key off camera and paste it into `.env` in this folder.

### 3. Dry run (off camera)

`npm run pay` should end with `200 OK`, the live price and a settlement tx. Check the gateway dashboard shows the paid call.

### 4. Record

1. The Token Price dashboard on autonomo.fun.
2. A terminal in this folder, large font: `npm run pay`.
3. `npm run pay:autonomo` (the first run shows the one-time approval).
4. Back to the dashboard: refresh to show the new paid calls and earnings, then open a tx link on the Robinhood Chain explorer.

Keep off screen: `.env`, the wallet's key export screen, and your shell history if it contains keys.
