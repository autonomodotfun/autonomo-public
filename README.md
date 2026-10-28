# Autonomo

The agentic x402 launchpad for APIs. Launch an endpoint with an x402 price and AI agents can discover it and pay per call. Autonomo also tracks the ecosystem around it: facilitators, SDKs, extensions and explorers.

- **Paid services** are imported from facilitator discovery ("Bazaar") endpoints (Coinbase CDP and PayAI) and grouped into one project per host, with price, network, facilitator and 30-day usage for every endpoint.
- **Ecosystem projects** (facilitators, SDKs, extensions, explorers) are hand-checked in [`src/data/curated.ts`](src/data/curated.ts).
- **Launch requests** (`/submit`) go into a review queue at `/admin`.
- **Free JSON API** for agents at `/api/v1/*`, documented at `/api-docs`.
- **Pro API** at `/api/v1/pro/endpoints`: endpoint-level search paid per call with x402, in USDG or $AUTONOMO on Robinhood Chain (optionally USDC). Off until configured; see below.

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

## Paid API tier

`/api/v1/pro/endpoints` is protected with x402 (`@x402/next`). It stays off, answering `503`, until `PRO_PAY_TO` and at least one payment rail are set (see `.env.example`):

- **USDG:** `PRO_ACCEPT_USDG=1`, priced at `PRO_PRICE_USD`, on Robinhood Chain (`eip155:4663`). USDG supports EIP-3009, so each payment is one signature.
- **$AUTONOMO:** `PRO_AUTONOMO_AMOUNT` whole tokens per call on Robinhood Chain. The token has no EIP-3009 or EIP-2612, so payments use Permit2; payers approve Permit2 once before their first payment.
- **USDC (optional):** `PRO_USDC_NETWORK` (e.g. `eip155:8453`) and `PRO_USDC_FACILITATOR_URL`, priced at `PRO_PRICE_USD`.

No hosted facilitator covers Robinhood Chain, so the app settles USDG and $AUTONOMO payments itself with `FACILITATOR_PRIVATE_KEY`, a gas-only wallet that needs a little ETH on Robinhood Chain. Paid responses are sent with `Cache-Control: private, no-store`.

## Deploying (Vercel + Neon)

1. Create a Neon project and copy its pooled connection string.
2. Locally: `DATABASE_URL=… npm run db:setup` to create tables and load data into Neon.
3. Import the repo in Vercel and set `DATABASE_URL`, `ADMIN_PASSWORD` and `NEXT_PUBLIC_SITE_URL`.
4. Re-run `npm run db:import` against Neon to refresh data (scheduled refresh comes in Phase 3).

## Roadmap

- **Phase 2: live checks.** Probe each endpoint for a valid `402` response (never paying), record status and uptime, show a "verified live" badge.
- **Phase 3: auto-discovery.** Scheduled Bazaar refresh, more facilitators, GitHub search for x402 packages, dedupe into the review queue.
- **Phase 4: agent access.** Paid API tier via x402, `llms.txt`, MCP server.
- **Phase 5: growth.** Owner claims (sign with the `payTo` wallet), editable listings, ecosystem stats, featured slots.
