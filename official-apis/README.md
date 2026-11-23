# Official Autonomo APIs

The APIs Autonomo runs itself. Each one is listed on autonomo.fun behind its own gateway, payable per call in
$AUTONOMO or USDG, and the Agent Playground and the Telegram bot use them to answer questions.

| API | Gateway | Upstream |
| --- | --- | --- |
| New Launches | `autonomo.fun/x/new-launches` | `tools/` → `/v1/launches` |
| Risk Checker | `autonomo.fun/x/token-risk` | `tools/` → `/v1/risk/<token>` |
| Token Lookup | `autonomo.fun/x/token-lookup` | `tools/` → `/v1/price/<token>` |
| Tx Explainer | `autonomo.fun/x/tx-explainer` | `tools/` → `/v1/tx/<hash>` |
| Wallet Portfolio | `autonomo.fun/x/wallet-portfolio` | `tools/` → `/v1/portfolio/<wallet>` |
| Dev Wallet Tracker | `autonomo.fun/x/dev-wallet` | `tools/` → `/v1/dev/<token>` |
| Holders & Bundles | `autonomo.fun/x/holders-bundles` | `tools/` → `/v1/holders/<token>` |
| Payment Check | `autonomo.fun/x/payment-check` | `tools/` → `/v1/payment/<hash>` |
| Gas Now | `autonomo.fun/x/gas-now` | `tools/` → `/v1/gas` |
| Endpoint Health | `autonomo.fun/x/endpoint-health` | `tools/` → `/v1/endpoint?url=…` |
| Website Check | `autonomo.fun/x/website-check` | `tools/` → `/v1/site?url=…` |
| Page Reader | `autonomo.fun/x/page-reader` | `tools/` → `/v1/page?url=…` |

All twelve are served by one Vercel project, [`tools/`](tools/) (tools.autonomo.fun). Details and safety limits are
in its README.

Token Price (`autonomo.fun/x/token-price`) was retired on Nov 23, 2026: Token Lookup answers the same for $AUTONOMO at
`autonomo.fun/x/token-lookup/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96`. Its gateway is paused and answers
410 with that address (`src/lib/retired.ts`); the gateway row and its upstream route stay, so it can be turned back on
from /admin.

## Adding a new official API

1. Add a handler in `tools/api/<name>.js` (shared helpers live in `tools/api/_lib.js`; check `authorized(req)` first).
2. Add a rewrite for `/v1/<name>` in `tools/vercel.json`, test it locally, then deploy from `tools/`.
3. Launch a gateway on autonomo.fun/dashboard with upstream `https://tools.autonomo.fun/v1`, auth header
   `x-api-key` and the `TOOLS_API_KEY` value. Use a keyword-rich description so the agent can find it.
4. Request listing and approve it in /admin.
5. Teach the agent the path for the new slug in `src/lib/playground.ts` (`GATEWAY_PATHS`, `intentKeywords`, `answerFrom`).
