# Changelog

What shipped on [autonomo.fun](https://autonomo.fun), newest first. Development happens in a private repo; this
repo gets a copy of each release.

## November 13, 2026

- **A clearer front door for API creators.** The launch page now opens on two choices: "I have a normal API", which
  Autonomo puts behind a paid address, and "My API already takes x402 payments", which is only added to the
  directory. Each shows who collects the payment, and a side-by-side table sets out the rest. The second form is
  renamed from "Launch your API" to "List your project", and the docs call it the listing form.

## November 12, 2026

- **`/llms.txt` for AI agents.** A plain-text map of Autonomo in the llms.txt format: the chain and the official
  $AUTONOMO address, how to find, call and pay for an API (with the 402 headers), the MCP server, SDK, CLI and
  LangChain installs, every live API with its path and price, every docs page and the discovery API. It's built from
  the site's own data, so prices, APIs and page descriptions stay current.

## November 11, 2026

- **A command for the terminal.** `autonomo-sdk` 0.1.1 on npm adds a CLI on top of the SDK: `npx autonomo-sdk risk
  0x…` pays for a Risk Checker call and prints the answer, with shortcuts for every official API and `call "…"` for
  the rest. The per-call and daily spend limits apply (`--max`, `--daily`), `--dry-run` shows the price without
  paying, and `--json` gives agents one object with the answer and the receipt.
- **Private payments from the terminal.** `autonomo-sdk` 0.1.2 adds `--private` to the command: it pays from your
  private Gloam balance by starting Gloam's own server on your machine, with Gloam's own key and limits and no
  wallet key. `--retry-header` finishes a call that was paid but not answered, without paying again.
- **A guide for the command** at `/docs/cli`: trying it free, paying, every command and option, private payments
  with Gloam, Borro credit, and use from scripts and agents.
- **Roadmap:** the Agent SDK and CLI are done.
- **A roadmap page** at `/roadmap`, linked from the header: what has shipped, what comes next
  and later. It replaces the roadmap section of `/docs`.
- **The header shows where you are.** The menu item for the page you're on is highlighted.

## November 10, 2026

- **LangChain tools for Python and TypeScript.** `langchain-autonomo` on PyPI and npm gives a LangChain or LangGraph
  agent three tools: find an Autonomo API, check its price and pay for a call. The model picks the API and pays
  itself, within the SDK's per-call and daily limits and a cap on paid calls per run. Guide at `/docs/langchain`.
- **Research agent in the Agent Playground.** A new "Research a token" tab: paste a Robinhood Chain token and the
  agent pays Token Risk, Tx Explainer for the launch transaction, and Wallet Portfolio for the creator and the
  largest holder, then writes up what it found. Each step shows live with its on-chain receipt, and any other top
  holder can be checked with one more call. Three free reports a day.

## November 9, 2026

- **Ostrapad Offer Finder**, a new official API: say what you need and it finds the matching offers from agents
  listed on Ostrapad, with each one's price and profile link, for 0.01 USDG or 100 $AUTONOMO a call.
- **Ostra** joins the partners: agents with an Ostra vault can list Autonomo's APIs and pay for them in USDG with
  Ostra's MCP server, with a guide at `/docs/ostra`. The homepage's "Use with" row now links to each partner's guide.
- **Try every route yourself** on `/docs/sdk`: one script tries each way the SDK pays (USDG, $AUTONOMO, Gloam and
  Borro) with one small call, and prints each receipt's transaction link to check on-chain.
- **Gloam fix in the SDK examples:** they now wait up to 5 minutes for a private payment instead of the MCP client's
  60 seconds, and the TypeScript one starts Gloam's server on Windows too.
- **Borro guide:** opening a credit line step by step, from buying CREDIT on Uniswap to setting the agent wallet.

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
