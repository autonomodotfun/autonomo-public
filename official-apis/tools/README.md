# Autonomo tools API (all official Autonomo APIs)

Every official Autonomo API in one Vercel project (tools.autonomo.fun), each behind its own Autonomo gateway.
All gateways use the same upstream base, `https://tools.autonomo.fun/v1`, and the same key.

| Gateway slug | Upstream path | What it returns |
| --- | --- | --- |
| `token-price` | `/v1/price/autonomo` | The live $AUTONOMO price (same as token-lookup for $AUTONOMO) |
| `new-launches` | `/v1/launches?limit=10` | The newest Robinhood Chain launchpad tokens: age, buys, sells, market cap, curve progress |
| `token-risk` | `/v1/risk/<token>` | Rug-risk score: holder concentration, creator, launch-block buyers, bot volume |
| `token-lookup` | `/v1/price/<token>` | Live price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, once it has graduated, its launchpad Uniswap v4 pool (USDG and WETH too) |
| `tx-explainer` | `/v1/tx/<hash>` | A Robinhood Chain transaction in plain English: launches, curve buys and sells (router and bundled buys grouped), transfers, fee |
| `wallet-portfolio` | `/v1/portfolio/<wallet>?days=2` | ETH, USDG, WETH and $AUTONOMO, plus tokens received in the last 1–7 days, valued in USD; copies of known symbols are flagged as likely impostors |
| `dev-wallet` | `/v1/dev/<token>?chain=robinhood\|base` | What a token's creator did: bought, burned, locked, sold and still holds, creator fees claimed and waiting, where their ETH went, who first funded them, and other launches by the creator and that funder. Reads Base too: with `chain=base`, or on its own when the token is only there (creator fees aren't tracked on Base). Needs `BLOCKSCOUT_KEY` |
| `holders-bundles` | `/v1/holders/<token>?chain=robinhood\|base` | Who really holds a token: top 30 holders with the pool, launch contracts and burns set apart, wallets linked by a shared first funder, snipers in the first 15 seconds and what they still hold, same-block buyers, and early buyers who sniped other launches. Reads Base too: with `chain=base`, or on its own when the token is only there. Needs `BLOCKSCOUT_KEY` |
| `payment-check` | `/v1/payment/<hash>?to=<address>&amount=<number>&asset=usdg\|autonomo` | Did a payment settle: who paid whom, how much, how it was settled and who paid the gas, with the wallet behind a burn splitter. With `to`, `amount` or `asset`, a yes or no on whether a payment in the transaction matches |
| `gas-now` | `/v1/gas` | The gas price now, and what sending ETH, sending USDG, a curve buy and a launch cost in ETH and USD, from what recent real transactions used |
| `endpoint-health` | `/v1/endpoint?url=https://…&method=GET\|POST` | Is an x402 API up and payable right now: one unpaid call, the answer time, and whether each payment option it offers is complete enough to pay. Never pays |
| `website-check` | `/v1/site?url=https://…` | A trust check for a website: domain age and registrar, certificate, where the site ends up, and whether the name resembles a well-known one, with a caution level |
| `page-reader` | `/v1/page?url=https://…` | Title, description and readable text of a public web page |
| `ostrapad-offer-finder` | `/v1/offers?q=<what you need>&max_price=<USDG>&limit=<1-20>` | Matching offers from AI agents for hire on Ostrapad: price, delivery time, who judges the work and each provider's record, as Ostrapad shows them, with a link to each agent's Ostrapad page. Read from Ostrapad's public listings (approved by their provider vaults, records from Ostrapad's contract). An Autonomo API, not an official Ostra one. No match is a 404, so it isn't charged |

All need `x-api-key: <TOOLS_API_KEY>` (open when the variable isn't set, for local use).

## Notes

- Everything is read from public chains (Robinhood Chain RPC; ETH/USD from Chainlink on Base; Base itself for `chain=base`). Launchpad tokens are
  found through the factory's launch event, like the Risk Checker.
- `ROBINHOOD_RPC_URL` (optional, a paid RPC such as Alchemy): with it, Token Risk and Token Lookup find tokens from
  the launchpad's whole history (from block 27,000,000). Without it they search the last ~13 days on the public RPC,
  since it caps each log search at 10M blocks; for an older token they then ask Blockscout which block it was created
  in and read the launch from that one block (needs `BLOCKSCOUT_KEY`). Wallet Portfolio looks up launch prices for
  recent launches only, either way.
- What the older tools use Blockscout for, when the key is set. Each keeps working without it, the old way:
  Wallet Portfolio lists every token the wallet holds (1 request) instead of scanning the last few days, and uses
  Blockscout's market price for a token that isn't a recent launch; balances are still read from the chain, which
  drops fake airdrops that only exist as transfer events. Token Risk and Token Lookup find launches of any age
  (2 requests, older tokens only). Tx Explainer calls contracts by their verified name (up to 6 requests).
  New Launches doesn't use it.
- `BLOCKSCOUT_KEY` (needed by Dev Wallet Tracker and Holders & Bundles): a Blockscout PRO API key, used by nothing
  else. A wallet's full history can't be read from the RPC, so these two ask Blockscout: about 6 requests for a dev
  check, 60 to 110 for a holders check. Without the key they answer 503 and callers aren't charged.
- `chain=base` (Dev Wallet Tracker and Holders & Bundles): a Robinhood Chain token gets exactly the answer it got
  before, with the chain left out or `chain=robinhood`. On Base the creator comes from the Clanker (v4, v3.1) or Zora launch event in the transaction that
  minted the token, otherwise from whoever sent it. Base's Blockscout misses many new tokens (Nov 2026: about 93% of
  blocks indexed, and Clanker tokens a day old not listed), so the token's own history (its mint, the creator's
  moves, the first seconds of trading, and holders when Blockscout hasn't listed the token) is read from the chain;
  wallet histories and contract names still come from Blockscout, on the same key. That needs `BASE_RPC_URL`, an RPC
  of our own such as Alchemy, since the public one refuses whole-history log searches; without it `chain=base`
  answers 503 and callers aren't charged. Left out, the chain is Robinhood Chain, or Base when Robinhood Chain has no token at the address but
  Base does: that answer says `"chain": "base"` with a `chainNote` on why (one supply read on Base, only after
  Robinhood Chain found nothing, and only once Base is set up). A token on both chains gets the Robinhood Chain
  answer. `chain=robinhood` looks there only, and a Base token's 404 then says to pass `chain=base`. Measured per report: Dev Wallet about 2 to 5 Blockscout and 12 to 14 RPC
  requests; Holders about 2 to 10 Blockscout requests for a new token and about 50 for a large one like Brett.
- `BLOCKSCOUT_RPS` (optional, default 13): requests a second sent to Blockscout. The Builder plan allows 15; set 4
  on the free plan.
- Portfolio discovery scans incoming transfers within a time budget so answers stay well inside the gateway's 25 s.
- Endpoint Health and Website Check fetch addresses a caller chose, under the same rules as the page reader
  (`api/_net.js`): https only, no credentials, public addresses only at every hop. Endpoint Health follows no
  redirects; Website Check follows up to 4 and reads registration data from each registry's RDAP service, found
  through IANA's list (data.iana.org/rdap/dns.json).
- Page reader safety: https only, no credentials, every hop (redirects included) must resolve to a public address,
  max 3 redirects, 2 MB, 10 s, HTML or plain text only.

## Deploy

A plain Vercel project. Every gateway's upstream is `https://tools.autonomo.fun/v1` with auth header `x-api-key` and
the `TOOLS_API_KEY` value; the Agent Playground and the Telegram bot add the right path for each slug above.
Deploy from this folder: `npx vercel deploy --prod`.
