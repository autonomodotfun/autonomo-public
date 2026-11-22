# Changelog

What shipped on [autonomo.fun](https://autonomo.fun), newest first. Development happens in a private repo; this
repo gets a copy of each release.

## November 22, 2026

- **Simpler docs.** The docs menu is now six short groups (Start, Build an agent, Frameworks, Ways to pay, Launch an
  API, Reference) with short names, in place of one long list. The docs home opens on a three-step quickstart and
  tiles for every tool and way to pay. Long guides get an "On this page" list that follows you down the page, every
  guide shows which group it belongs to, and each ends with links to the previous and next guide. New pages:
  [Quickstart](https://autonomo.fun/docs/quickstart), [How x402 works](https://autonomo.fun/docs/x402) and
  [FAQ](https://autonomo.fun/docs/faq).
- **A guide to finding agent jobs on Tokyo Futuro.** [/docs/tokyo-futuro](https://autonomo.fun/docs/tokyo-futuro)
  shows how an agent finds open paid jobs with the Tokyo Futuro Job Finder, what comes back, how to take a job with
  Tokyo Futuro's own tools, and Tokyo Futuro's limits: a 10% bond, small jobs first for a new wallet, and 14 jobs a
  week.

## November 21, 2026

- **The provider bond is live.** An API creator can lock $AUTONOMO from the wallet their APIs are paid at, and those
  APIs show as Bonded. If a bonded API takes payments and doesn't deliver, part of the bond is slashed: half refunds
  the agent and the rest is burned. Bonded means about $100 of $AUTONOMO, set weekly from the previous week's average
  price, and once a creator qualifies their amount is locked, like Verified. The contract has limits nobody can lift:
  at most 50% of a bond per slash, at least half of every slash burned, one slash per creator every 30 days, and a
  creator can always withdraw the rest before a second one. It is not audited yet. The rules, the contract and every
  slash with its evidence are on [/bond](https://autonomo.fun/bond); creators bond from the dashboard.
- **A new footer.** Links are grouped into Build, Token and Community, next to the logo and the social icons, with the
  $AUTONOMO contract address and its copy button underneath. The links to the docs home and to the x402 docs are gone:
  the docs stay one click away in the header.
- **The roadmap is up to date.** [/roadmap](https://autonomo.fun/roadmap) now shows what shipped since November 11:
  16 official APIs, payments in USDC on Base with the burn still on Robinhood Chain, one dollar price per API, the
  listing in Coinbase's x402 Bazaar, llms.txt, the official APIs' agent identity, the rewards vesting contract, and
  Tokyo Futuro, Stoa and QHooks as partners. Coming next adds Base payments in the SDK, CLI, LangChain tools and
  elizaOS plugin, and Solana payments on gateways.

## November 20, 2026

- **A guide to keeping an agent's savings in a QWallet.** [/docs/qwallet](https://autonomo.fun/docs/qwallet) shows the
  pattern: the agent's savings sit in a QHooks QWallet on Robinhood Chain, where every withdrawal needs both the
  owner wallet's key and a post-quantum key the agent keeps, and a small wallet pays for Autonomo APIs and gets topped
  up from it. Every step uses QHooks' MCP server, which signs on the agent's machine. The independent review of the
  QWallet contracts is still pending, so the guide says to start with small amounts.
- **An elizaOS plugin.** `elizaos-plugin-autonomo` gives an elizaOS agent three actions: find an Autonomo API, check
  its price, and pay for a call in USDG or $AUTONOMO on Robinhood Chain. The wallet key and the per-call and daily
  limits go in the agent's settings, and a call over a limit is refused before anything is signed. One package works
  on elizaOS 1.x and 2.x. Guide: [autonomo.fun/docs/eliza](https://autonomo.fun/docs/eliza).
- **"How it works" for both sides.** The homepage's three launch steps now sit next to three steps for agents: give
  it a wallet, connect Autonomo, and it pays per call.
- **The homepage shows a paid call.** Next to the headline, one call to Safe Swap plays out line by line: the
  request for a swap quote, the 402 with its price, the agent paying from its own wallet, the verdict that comes back,
  and the 5% that buys back and burns $AUTONOMO. The price is the API's live one.
- **Directory listings can show their logo.** Explore, the Autonomo tab and each listing's page show a project's own
  logo when it has one, and its first letter otherwise.

## November 19, 2026

- **A "Use with" section on the homepage.** The partners move out of the hero into their own section under "How a
  launch works": one card each, with a two-word label above the partner's logo, linking to its guide.
- **QHooks joins the partners**, on [/partners](https://autonomo.fun/partners) and in the homepage's "Use with" section.
  Its QProof API is in the directory with both paid endpoints: a stored token report for $0.02 and a fresh scan for
  $0.25, in USDG on Robinhood Chain or USDC on Base. A fresh scan is only charged once every required check completes.
- **Directory listings can show their paid endpoints.** An x402 API listed from a submission used to show only a
  description and links. Its endpoints can now be added from each endpoint's own 402 answer, so the listing shows the
  price, the chains, how to pay and what each endpoint does, the same as APIs imported from the Coinbase and PayAI
  catalogs. Prices in USDG now show in dollars too.
- **The official APIs have an ERC-8004 agent identity**: agent 26170 in the identity registry on Robinhood Chain,
  owned by Autonomo. Its registration file is at
  [autonomo.fun/.well-known/agent-registration.json](https://autonomo.fun/.well-known/agent-registration.json): what
  the APIs do, how they're paid and where to find them. It also proves the agent belongs to autonomo.fun.
- **Stoa joins the partners**, on [/partners](https://autonomo.fun/partners) and in the homepage's "Use with" row.
  Stoa is a DEX aggregator on Robinhood Chain, and it launched two of its APIs on Autonomo: a token safety check that
  simulates a buy and a sell before an agent buys, and a swap quote that can come with ready-to-sign calldata.
- **A Creator APIs shelf.** APIs that other teams built and run on Autonomo's gateways now have their own shelf on the
  Explore page's Autonomo tab, in the Playground and in [/llms.txt](https://autonomo.fun/llms.txt), after Autonomo's
  own APIs, instead of sharing "Other tools" with them. Safe Swap moves to the Tokens shelf, and /llms.txt and
  `/api/v1/gateways` show how to call Safe Swap and Stoa's two APIs.
- **Burn splitter v2 is deployed on Robinhood Chain**, at
  [`0x8691…2C37`](https://robinhoodchain.blockscout.com/address/0x8691b73eBE4064FbAaeF05Ea893cD2e5584b2C37). It splits
  payments exactly like v1: 5% of USDG to the buyback, 5% of $AUTONOMO burned, the rest to the API's payee. What's new
  is that a v2 splitter can be declared as an agent's wallet in the ERC-8004 identity registry, so the USDG payments it
  receives count toward that agent's record, for example on Priors. It approves only that one registry message and
  nothing else, so no signature can move funds out of it before the split. APIs move to their v2 splitters when the
  app switches factories; v1 splitters keep being flushed and their burns stay on [/burn](https://autonomo.fun/burn).
  Source and tests are in `contracts/robinhood`. Not audited.
- **All 16 official APIs describe themselves to Coinbase's x402 Bazaar.** Ostrapad Offer Finder, Tokyo Futuro Job
  Finder and Safe Swap now carry a Bazaar listing too: what they do, their inputs and a real example answer. Safe
  Swap is listed at its quote, where every swap starts. As before, Coinbase lists an API after a payment for it
  settles in USDC on Base.

## November 18, 2026

- **Tokyo Futuro Job Finder**, a new official API built with Tokyo Futuro, the job market for AI agents on Robinhood
  Chain: say the work you're after and it finds open jobs an agent can take, with the reward and bond in ZENI, when
  each job was posted, time left, whether a new wallet can take it, and how to take it with Tokyo Futuro's own tools.
  Rewards are the amounts escrowed on chain and each job's age comes from the job board contract. $0.01 a call at
  `/x/tokyo-futuro-job-finder/jobs?q=…`, in USDG, $AUTONOMO or USDC on Base. A search that finds nothing isn't charged.

## November 17, 2026

- **Official APIs take USDC on Base.** All 13 official APIs now accept USDC on Base, at the same dollar price, next
  to USDG and $AUTONOMO on Robinhood Chain. Base payments are settled by Coinbase's x402 facilitator and paid to
  the same 2-of-2 payment Safe on Base, which is checked before Base is offered (same owners and threshold on both
  chains).
- **Base payments are burned too, through a mirror burn.** Base has no $AUTONOMO pool, so the same 5% is burned on
  Robinhood Chain instead. A new contract, the mirror burn pot, holds a float of USDG there. Once a day it sends 5% of
  all Base payments so far to the buyback contract, which buys $AUTONOMO and burns it. The pot records the running
  Base total and can never send more than 5% of it; only the payment Safe can take USDG back out. If the pot runs
  short, the rest stays owed until the next refill. [/burn](https://autonomo.fun/burn) shows the Base total, what was
  sent, what's still owed and what's left in the pot. Base payments from November 17 onward are covered.
- **Every API can take USDC on Base, not just the official ones.** A creator's Base payments go to their own splitter
  on Base, which sends them 95% and keeps 5% for Autonomo's Base Safe; that 5% refills the mirror burn pot, so the
  burn on Base pays for itself and Autonomo never holds creators' money. Plain wallets, and Safes with the same
  signers on Base, can be paid there.
- **Creators choose whether their API takes Base.** The launch and settings form has a USDC on Base box next to
  Robinhood Chain, on by default, and an API's dashboard says whether Base is on, where it's paid, and why if it's
  off. APIs that only take $AUTONOMO keep Base off. Explore shows the Base price on Autonomo API cards and lists them
  under the Base chain filter, and the launch, Safe and official APIs guides explain Base payments.
- **Nine official APIs read Base too.** Token Risk, Dev Wallet Tracker, Holders & Bundles, Wallet Portfolio, Tx
  Explainer, Payment Check and Token Lookup take `chain=base`. Left out, they read Robinhood Chain exactly as before,
  or Base when the token, transaction or wallet is only there; the answer then says it's Base. New Launches and Gas
  Now take `chain=base` for Base's Clanker and Zora launches and Base's fees. On Base they recognize
  Clanker and Zora launches, read new tokens straight from the chain (Base's explorer misses many of them), and take
  prices and pools from DexScreener. Payment Check checks USDC payments on Base.
- **Listed in Coinbase's x402 Bazaar.** Each official API describes itself to the Bazaar, Coinbase's directory of
  x402 APIs: what it does, its inputs, and a real example answer. Coinbase lists an API after its first payment on
  Base.

## November 16, 2026

- **Explore's chain counts read correctly.** A project that accepts several chains is counted under each of them, so
  the chain counts add up to more than the directory's total. Picking a chain now says so ("5,022 of 5,2xx projects
  accept Base"), and a note under the chain list says the counts overlap. The numbers themselves did not change.

## November 15, 2026

- **$AUTONOMO prices follow the dollar price.** An API now has one price, in dollars. Paying in $AUTONOMO costs
  that price 20% lower, in tokens at the token's average price over the previous day, and every API's $AUTONOMO
  price is worked out again each day, so it never drifts from the dollar price. The launch form shows the amount as
  you type. This covers every API, official ones included: at today's price a $0.01 call is about 59 $AUTONOMO, down
  from a fixed 100. The `/api/v1/gateways` list gains `autonomoPricing`, with the dollar price it follows and the
  discount.
- **A rewards vesting contract is on-chain.** `AutonomoRewardsVesting` holds the $AUTONOMO set aside for rewards,
  just over 10 million (1% of supply), at
  [`0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277`](https://robinhoodchain.blockscout.com/address/0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277).
  It releases them in a straight line from December 1, 2026 to May 30, 2027, only to a 2-of-2 Rewards Safe. Nobody can
  take tokens out ahead of the schedule, the owner included. It is OpenZeppelin's `VestingWallet` with two guards:
  ownership can't be given up, and a handover has to be accepted. The code and its tests are in `contracts/`.

## November 14, 2026

- **Safer Borro borrowing in the SDKs.** `autonomo-sdk` 0.1.3 (npm) and `autonomo` 0.1.1 (PyPI) now check Borro's
  answer before signing anything. When the wallet is short and borrows on a Borro credit line, the SDK sends only one
  borrow, on your own line, into the agent's wallet, with no ETH attached, for no more than the call's price. Anything
  else is refused with `borro_unsafe` and nothing is sent. Earlier versions sent whatever transactions the answer held,
  outside the spending caps. If you use the Borro option, update. Thanks to r00k of HEY Research Lab for reporting it.
  Security reports go to contact@autonomo.fun (see `SECURITY.md`).
- **Research reports read the creator and the holders.** A report now also pays Dev Wallet Tracker (what the
  creator sold, burned, locked and claimed, who funded them, their other launches) and Holders & Bundles (wallets linked
  by one funder, snipers and what they still hold, same-block buys), with a card for each, and the summary connects
  them. A report makes six calls, 600 $AUTONOMO, and still finishes in time when a check is slow.
- **Six new official APIs are live.** Dev Wallet Tracker (what a token's creator did with their tokens and ETH),
  Holders & Bundles (who really holds a token, with linked wallets and snipers), Payment Check (did an x402 payment
  settle, and does it match a receipt), Gas Now (what common actions cost right now), Endpoint Health (is an x402 API
  up and payable) and Website Check (a trust check for a website or domain). Each is paid per call in USDG or
  $AUTONOMO, from 0.005 USDG. The Playground, the AI agent, the MCP server and `llms.txt` all know how to call them,
  and the [official APIs page](https://autonomo.fun/docs/official-apis) lists each path.
- **The Playground agent answers more.** Ask it who holds a token, what its creator did, whether a payment
  settled, what gas costs, or whether a website or an x402 endpoint can be trusted. It knows which of the three
  token APIs fits the question, and the start screen shows one example per shelf with the price list grouped as on
  Explore.
- **Explore leads with the whole directory.** The top of `/projects` now shows the directory's size in four tiles
  (projects, paid endpoints, chains, paid calls in 30 days), then one row of Autonomo's most-paid APIs with a link to
  all of them, then the full list under "All x402 APIs", which now starts on the first screen. Autonomo's APIs have
  their own **Autonomo** tab, grouped by shelf as before, and carry an "Autonomo" tag in the list. The
  `/api/v1/projects` results gain an `autonomo` field that says the same.
- **A reason when a listing isn't approved.** If your request to be listed is turned down, your API's dashboard page
  now says why, so you know what to change before asking again.
- **Listings are reviewed with live checks.** Before an API is listed, we now see whether it answers and whether its
  paid address asks for payment correctly, and several requests can be approved together.

## November 13, 2026

- **A clearer front door for API creators.** The launch page now opens on two choices: "I have a normal API", which
  Autonomo puts behind a paid address, and "My API already takes x402 payments", which is only added to the
  directory. Each shows who collects the payment, and a side-by-side table sets out the rest. The second form is
  renamed from "Launch your API" to "List your project", and the docs call it the listing form.
- **Launching an API in three short steps.** The launch form is now Your API, Your price, then a review. The fields
  have plainer names: "Your paid address" for the gateway URL, "Your API's address" for the upstream URL, and "Your API
  key, if it needs one" for the auth header and secret. A mistake shows on the step where it was made, and the review
  works out what you keep from each call after the burn.
- **Test your API before you launch it.** Step 1 of the launch form has a "Test my API" button. Autonomo makes one
  free call to your API, the way a paid call would reach it, and shows the status, the time it took and the start of
  the answer. An API that doesn't answer, refuses the call or fails on its own side can't be launched until it's
  fixed. A problem found at launch now shows on the review, with a button back to the step that needs fixing.
- **A clearer "Your API is live" page.** Right after launching, the page shows your paid address, what you earn from
  each call after the burn, and the three things to do next: see what an agent sees, ask to be listed, and choose
  where you get paid.
- **The price step is laid out by chain.** USDG and $AUTONOMO sit under Robinhood Chain, and ticking $AUTONOMO
  starts the price at 100 a call.
- **Official APIs grouped by what you are asking about.** The Explore page, the Official APIs docs page and
  `/llms.txt` now sort Autonomo's own APIs into Tokens, Wallets and Transactions, each marked On-chain because it
  reads Robinhood Chain directly, then Partner tools and Other tools.
- **Wallet Portfolio sees every token a wallet holds.** It used to find only tokens received in the last few days.
  It now starts from the full list of what the wallet holds, still reads each balance from the chain, so fake
  airdrops that never really arrived are left out, and prices more tokens.
- **Risk Checker and Token Lookup work on older tokens.** A launchpad token of any age can be checked and priced, not
  only ones launched in the last 13 days or so.
- **Tx Explainer names the contracts.** A summary now says "PoolManager" or "PonsV2LaunchAndBuy" next to the short
  address, where the contract has a verified name.
- **Launch several APIs at once.** For APIs that live at one address: enter the address and key once, list the APIs
  by typing or pasting, and check and launch them together. Each is tested the same way as a single launch, nothing
  launches unless all pass, and one tick asks for all of them to be listed.

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
