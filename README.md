# Autonomo

The agentic x402 launchpad for APIs. Launch an endpoint with an x402 price and AI agents can discover it and pay per call. Autonomo also tracks the ecosystem around it: facilitators, SDKs, extensions and explorers. User-facing docs are at `/docs`.

- **Hosted gateways** (`/dashboard`, `/x/<slug>`): owners put an existing API behind x402, paid in USDG or $AUTONOMO on Robinhood Chain. See below.
- **Official APIs** run by Autonomo itself (token price and lookup, new launches, risk checker, tx explainer, wallet portfolio, page reader), each behind its own gateway. Source in [`official-apis/`](official-apis/).
- **MCP server** (`autonomo-mcp` on npm, source in [`mcp/`](mcp/)): Claude, Cursor, Codex and other MCP clients find Autonomo APIs and pay per call.
- **Agent Playground** (`/playground`) and the **Telegram bot** ([@autonomoagentbot](https://t.me/autonomoagentbot), webhook at `/api/telegram`): an agent that answers questions by paying the official APIs in $AUTONOMO from its own wallet.
- **Paid services** are imported from facilitator discovery ("Bazaar") endpoints (Coinbase CDP and PayAI) and grouped into one project per host, with price, network, facilitator and 30-day usage for every endpoint. Refreshed every 3 days by a Vercel cron (`/api/cron/import`).
- **Ecosystem projects** (facilitators, SDKs, extensions, explorers) are hand-checked in [`src/data/curated.ts`](src/data/curated.ts).
- **Launch requests** (`/submit`) and gateway listing requests go into a review queue at `/admin`.
- **Free JSON API** for agents at `/api/v1/*` (projects, stats, gateways), documented at `/api-docs`.
- **Pro API** at `/api/v1/pro/endpoints`: endpoint-level search paid per call with x402, in USDG or $AUTONOMO on Robinhood Chain (optionally USDC). Off until configured; see below.
- **Agent payment demo** in [`examples/agent-demo/`](examples/agent-demo/): a script that pays a gateway and prints every step.

Stack: Next.js 16 (App Router), Tailwind 4, Drizzle ORM, Postgres (Neon in production, embedded PGlite locally).

## Local development

```bash
npm install
npm run db:setup   # migrate, seed curated entries, import Bazaar data (a few minutes)
npm run dev
```

Without `DATABASE_URL`, the app uses an embedded Postgres in `./.pglite`. Only one process can open it at a time, so **stop `npm run dev` before running any `db:*` script**.

`.env.local` holds `ADMIN_PASSWORD` for `/admin` (HTTP basic auth, any username). See `.env.example`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run db:generate` | Generate a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Upsert the curated projects |
| `npm run db:import` | Re-import Bazaar data. Refreshes stats; keeps names, categories and visibility you've edited. `-- --dry-run` prints stats only |
| `npm run db:remove -- <slug>` | Delete a project |

## Pro API

`/api/v1/pro/endpoints` is protected with x402 (`@x402/next`). It stays off, answering `503`, until `PRO_PAY_TO` and at least one payment rail are set (see `.env.example`):

- **USDG:** `PRO_ACCEPT_USDG=1`, priced at `PRO_PRICE_USD`, on Robinhood Chain (`eip155:4663`). USDG supports EIP-3009, so each payment is one signature.
- **$AUTONOMO:** `PRO_AUTONOMO_AMOUNT` whole tokens per call on Robinhood Chain. The token has no EIP-3009 or EIP-2612, so payments use Permit2; payers approve Permit2 once before their first payment.
- **USDC (optional):** `PRO_USDC_NETWORK` (e.g. `eip155:8453`) and `PRO_USDC_FACILITATOR_URL`, priced at `PRO_PRICE_USD`.

No hosted facilitator covers Robinhood Chain, so the app settles USDG and $AUTONOMO payments itself with `FACILITATOR_PRIVATE_KEY`, a gas-only wallet that needs a little ETH on Robinhood Chain. Paid responses are sent with `Cache-Control: private, no-store`.

## Hosted gateways

Owners sign in at `/dashboard` with Privy (email, Google, X or a wallet; users without a wallet get a Privy embedded wallet) when `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` are set, or directly with a browser wallet (Sign-In with Ethereum). Either way the server keeps an HMAC session cookie (`SESSION_SECRET`) for the owner's address: their own external wallet if they linked one, otherwise the embedded wallet. Owners paste an existing API URL and set a price. Agents call `/x/<slug>/<path>`; the gateway answers `402`, verifies the payment, forwards the request to `<upstream>/<path>` and settles only if the upstream answers below 400. Payments go to the owner's wallet (`payTo` = the signed-in address), in USDG or $AUTONOMO on Robinhood Chain, settled by the same `FACILITATOR_PRIVATE_KEY` wallet as the Pro API. Every paid attempt is logged in `gateway_calls` for the owner's dashboard.

- Upstreams must be https and resolve to public addresses (checked when saved and on every call); redirects aren't followed; 1 MB request and 5 MB response limits; 25 s timeout.
- An optional upstream auth header is stored encrypted with `GATEWAY_SECRET_KEY`.
- Owners can request a catalog listing; approving it in `/admin` creates a `service` project with the gateway URL as its endpoint.

## Agent Playground and Telegram bot

Both use the same agent (`src/lib/agent.ts`, `src/lib/playground.ts`): it picks an official API for the question, reads the live `402` price and pays from its own wallet.

- `PLAYGROUND_AGENT_PRIVATE_KEY`: the agent's wallet, holding $AUTONOMO on Robinhood Chain (and a little ETH once, for the Permit2 approval). Without it the Playground still searches and quotes but doesn't pay. `PLAYGROUND_DAILY_AUTONOMO` caps its spend per 24 h (default 20,000).
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` turn the bot on; `TELEGRAM_BOT_USERNAME` lets it answer mentions in groups; `TELEGRAM_FREE_DAILY` sets free paid answers per user per 24 h (default 3).

## Deploying (Vercel + Neon)

1. Create a Neon project and copy its pooled connection string.
2. Locally: `DATABASE_URL=… npm run db:setup` to create tables and load data into Neon.
3. Import the repo in Vercel and set `DATABASE_URL`, `ADMIN_PASSWORD`, `NEXT_PUBLIC_SITE_URL` and `CRON_SECRET`, plus the variables for the features you want (above and in `.env.example`).
4. The cron in `vercel.json` re-imports the Bazaar data at 03:00 UTC every 3 days (on the 1st, 4th, 7th, … of each month). Run `npm run db:import` against Neon to refresh it by hand.

## Roadmap

The live roadmap is in the "Roadmap & status" section of `/docs` (`src/app/docs/page.tsx`).

- **Phase 1 (live):** hosted gateways, USDG and $AUTONOMO payments on Robinhood Chain, owner dashboard, Agent Playground, official APIs.
- **Phase 2 (building):** Telegram bot and more official APIs (done), MCP server (in progress), agent SDK and CLI, webhooks and payout analytics.
- **Later:** Base and Solana support, paying x402 APIs from other platforms, verified listings and reputation.
