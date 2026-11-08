# Changelog

What shipped on [autonomo.fun](https://autonomo.fun), newest first. Development happens in a private repo; this
repo gets a copy of each release.

## November 8, 2026

- **SDKs for TypeScript and Python.** `autonomo-sdk` on npm and `autonomo` (or `autonomo-sdk`) on PyPI. One `call`
  finds the right Autonomo API for a request, pays in USDG or $AUTONOMO, privately through Gloam or on Borro credit
  when the wallet is short, keeps to per-call and daily limits, and returns the answer with a receipt.
- **SDK guide** at `/docs/sdk`, with tested examples for each way to pay.
- **Borro** joins the partners: agents can borrow USDG from a Borro credit line and pay in the same request, with a
  guide at `/docs/borro`.
- **Directory refresh**: clearer Explore page, category tabs, "Pay with Autonomo" for Autonomo's own APIs, payer
  counts and a "How to pay" box on each listing.
- **Older tokens in Token Risk and Token Lookup**: launch searches now cover the launchpad's whole history instead of
  the last ~13 days.

## November 7, 2026

- **Track record for every API**: paid calls, success rate, speed and outside payers over 30 days, and a public
  numbers page.
- **Private Gloam payments on every API that accepts USDG.**
- **Loading screens** right after each click.
- Payments recheck a low balance once before refusing, for agents whose funds land a moment late.

## November 5–6, 2026

- **Gloam private payments**: agents can pay from a private Gloam balance, so the payment doesn't link to their
  wallet. Guide at `/docs/gloam`, and a partners page.
- **Simpler docs**: a short home page and focused guides.
- **New homepage** split into the launchpad and the directory.

## November 4, 2026

- **Burn on paid calls**: 5% of every API payment is burned on-chain, $AUTONOMO directly and USDG through a buyback,
  with a public receipt for each burn at `/burn`. Each API creator is paid through their own splitter contract.

## November 3, 2026

- **Get paid at a Safe**: API creators can send their earnings to a separate wallet or a multisig, set from the
  dashboard.
- The wallets behind the official APIs are listed in the docs.
- **The first payment from an outside agent.**

## November 1–2, 2026

- **Verified badge** for API providers holding about $27 of $AUTONOMO, locked once a wallet qualifies.
- **The MCP server** is listed on the official MCP Registry.
- **The Agent Playground becomes a chat** with an AI agent: you ask, it pays the APIs and answers with receipts.
- Risk checks treat the launchpad's locker as locked supply.
- The directory counts every network a listing accepts.

## October 29–31, 2026

- **Official APIs**: New Launches, Token Risk, Token Lookup, Tx Explainer, Wallet Portfolio and Page Reader, all
  served from one tools API. Graduated tokens are priced from their Uniswap v4 pool.
- **MCP server** (`autonomo-mcp` on npm): Claude, Cursor, Codex and other MCP clients find Autonomo APIs and pay per
  call.
- **Telegram agent bot** that answers by paying the official APIs.
- **The x402 directory** refreshes on a schedule, and a public gateways list for agents.
- A roadmap and live status in the docs.

## October 28, 2026

- **Autonomo launches**: the agentic x402 launchpad for APIs on Robinhood Chain.
- **Hosted gateways** with an owner dashboard: put an existing API behind x402 and get paid per call in USDG or
  $AUTONOMO.
- The $AUTONOMO contract address in a bar on every page.
- Docs with launch and agent guides, a token price API, an agent payment demo, and the first Agent Playground.
