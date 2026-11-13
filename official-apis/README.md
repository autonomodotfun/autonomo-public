# Official Autonomo APIs

The APIs Autonomo runs itself. Each one is listed on autonomo.fun behind its own gateway, payable per call in
$AUTONOMO or USDG, and the Agent Playground and the Telegram bot use them to answer questions.

| API | Gateway | Upstream |
| --- | --- | --- |
| Token Price | `autonomo.fun/x/token-price` | `tools/` → `/v1/price/autonomo` |
| New Launches | `autonomo.fun/x/new-launches` | `tools/` → `/v1/launches` |
| Risk Checker | `autonomo.fun/x/token-risk` | `tools/` → `/v1/risk/<token>` |
| Token Lookup | `autonomo.fun/x/token-lookup` | `tools/` → `/v1/price/<token>` |
| Tx Explainer | `autonomo.fun/x/tx-explainer` | `tools/` → `/v1/tx/<hash>` |
| Wallet Portfolio | `autonomo.fun/x/wallet-portfolio` | `tools/` → `/v1/portfolio/<wallet>` |
| Dev Wallet Tracker (not launched yet) | `autonomo.fun/x/dev-wallet` | `tools/` → `/v1/dev/<token>` |
| Holders & Bundles (not launched yet) | `autonomo.fun/x/holders-bundles` | `tools/` → `/v1/holders/<token>` |
| Payment Check (not launched yet) | `autonomo.fun/x/payment-check` | `tools/` → `/v1/payment/<hash>` |
| Gas Now (not launched yet) | `autonomo.fun/x/gas-now` | `tools/` → `/v1/gas` |
| Endpoint Health (not launched yet) | `autonomo.fun/x/endpoint-health` | `tools/` → `/v1/endpoint?url=…` |
| Website Check (not launched yet) | `autonomo.fun/x/website-check` | `tools/` → `/v1/site?url=…` |
| Page Reader | `autonomo.fun/x/page-reader` | `tools/` → `/v1/page?url=…` |

All seven are served by one Vercel project, [`tools/`](tools/) (tools.autonomo.fun). Details and safety limits are
in its README.

## Adding a new official API

1. Add a handler in `tools/api/<name>.js` (shared helpers live in `tools/api/_lib.js`; check `authorized(req)` first).
2. Add a rewrite for `/v1/<name>` in `tools/vercel.json`, test it locally, then deploy from `tools/`.
3. Launch a gateway on autonomo.fun/dashboard with upstream `https://tools.autonomo.fun/v1`, auth header
   `x-api-key` and the `TOOLS_API_KEY` value. Use a keyword-rich description so the agent can find it.
4. Request listing and approve it in /admin.
5. Teach the agent the path for the new slug in `src/lib/playground.ts` (`GATEWAY_PATHS`, `intentKeywords`, `answerFrom`).
