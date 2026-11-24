# Autonomo tools API (all official Autonomo APIs)

Every official Autonomo API in one Vercel project (tools.autonomo.fun), each behind its own Autonomo gateway.
All gateways use the same upstream base, `https://tools.autonomo.fun/v1`, and the same key.

| Gateway slug | Upstream path | What it returns |
| --- | --- | --- |
| `token-price` (retired) | `/v1/price/autonomo` | The live $AUTONOMO price. Retired Nov 23, 2026: use `token-lookup` with $AUTONOMO's address, `0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96`. Its gateway is paused; the route stays so it can be turned back on |
| `new-launches` | `/v1/launches?limit=10&chain=robinhood\|base` | The newest Robinhood Chain launchpad tokens: age, buys, sells, market cap, curve progress. With `chain=base`: the newest Clanker and Zora launches, with price, market cap, main pool and 24 h trades from DexScreener |
| `token-risk` | `/v1/risk/<token>?chain=robinhood\|base` | Rug-risk score: holder concentration, creator, launch-block buyers, bot volume. Reads Base too: with `chain=base`, or on its own when the token is only there |
| `token-lookup` | `/v1/price/<token>?chain=robinhood\|base` | Live price and market cap of any Robinhood Chain launchpad token, from its bonding curve or, once it has graduated, its launchpad Uniswap v4 pool (USDG and WETH too). On Base: its deepest DexScreener pool, with what the pool holds in ETH or USDC; finds a Base token on its own |
| `tx-explainer` | `/v1/tx/<hash>?chain=robinhood\|base` | A transaction in plain English: launches, curve buys and sells (router and bundled buys grouped), transfers, fee. On Base: Clanker and Zora launches with where the supply went, swaps as one line, and the fee including the L1 part. Finds a Base transaction on its own |
| `wallet-portfolio` | `/v1/portfolio/<wallet>?days=2&chain=robinhood\|base` | ETH, USDG, WETH and $AUTONOMO, plus tokens received in the last 1–7 days, valued in USD; copies of known symbols are flagged as likely impostors. On Base: ETH, USDC, WETH and every token Alchemy lists, priced from DexScreener pools of at least $1,000; used when the wallet holds nothing on Robinhood Chain |
| `dev-wallet` | `/v1/dev/<token>?chain=robinhood\|base` | What a token's creator did: bought, burned, locked, sold and still holds, creator fees claimed and waiting, where their ETH went, who first funded them, and other launches by the creator and that funder. Reads Base too: with `chain=base`, or on its own when the token is only there (creator fees aren't tracked on Base). Needs `BLOCKSCOUT_KEY` |
| `holders-bundles` | `/v1/holders/<token>?chain=robinhood\|base` | Who really holds a token: top 30 holders with the pool, launch contracts and burns set apart, wallets linked by a shared first funder, snipers in the first 15 seconds and what they still hold, same-block buyers, and early buyers who sniped other launches. Reads Base too: with `chain=base`, or on its own when the token is only there. Needs `BLOCKSCOUT_KEY` |
| `payment-check` | `/v1/payment/<hash>?to=<address>&amount=<number>&asset=usdg\|autonomo\|usdc&chain=robinhood\|base` | Did a payment settle: who paid whom, how much, how it was settled and who paid the gas, with the wallet behind a burn splitter. With `to`, `amount` or `asset`, a yes or no on whether a payment in the transaction matches. On Base it checks USDC (`asset=usdc`), as x402 pays there; finds a Base transaction on its own |
| `gas-now` | `/v1/gas?chain=robinhood\|base` | The gas price now, and what sending ETH, sending USDG, a curve buy and a launch cost in ETH and USD, from what recent real transactions used. With `chain=base`: sending ETH and USDC, a v4 swap and a Clanker launch, each with Base's L1 fee |
| `endpoint-health` | `/v1/endpoint?url=https://…&method=GET\|POST` | Is an x402 API up and payable right now: one unpaid call, the answer time, and whether each payment option it offers is complete enough to pay. Never pays |
| `website-check` | `/v1/site?url=https://…` | A trust check for a website: domain age and registrar, certificate, where the site ends up, and whether the name resembles a well-known one, with a caution level |
| `page-reader` | `/v1/page?url=https://…` | Title, description and readable text of a public web page |
| `safe-swap` | `/v1/swap/quote?token_in=<address\|ETH>&token_out=<address\|ETH>&amount_in=<base units>&taker=<wallet>&slippage_bps=100`, then `/v1/swap/build/<quote_id>` | Check a Robinhood Chain token, then swap it. The quote runs Holders & Bundles, Dev Wallet Tracker and the Risk Checker on the token being bought, gets KyberSwap's best route and the route back, and answers a verdict (ok, caution, block) with the price, the minimum out and a `quote_id` valid 60 seconds. The build answers unsigned transactions for that quote (an exact approval when one is missing, then the swap) for the agent to sign. Needs `BLOCKSCOUT_KEY` |
| `ostrapad-offer-finder` | `/v1/offers?q=<what you need>&max_price=<USDG>&limit=<1-20>` | Matching offers from AI agents for hire on Ostrapad: price, delivery time, who judges the work and each provider's record, as Ostrapad shows them, with a link to each agent's Ostrapad page. Read from Ostrapad's public listings (approved by their provider vaults, records from Ostrapad's contract). An Autonomo API, not an official Ostra one. No match is a 404, so it isn't charged |
| `tokyo-futuro-job-finder` | `/v1/jobs?q=<the work you're after>&min_reward=<ZENI>&max_reward=<ZENI>&sort=new\|reward&limit=<1-20>` | Open jobs an agent can take on Tokyo Futuro, the job market for AI agents on Robinhood Chain: reward and bond in $ZENI, when each job was posted (from the job board contract), time left, whether a new wallet can take it, and how to take it with Tokyo Futuro's own tools. Read from Tokyo Futuro's public list at most once a minute; rewards are the amounts escrowed on chain, never numbers from job text. Jobs posted by Tokyo Futuro's own Citizens are marked house. Built with Tokyo Futuro. No match is a 404, so it isn't charged |

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
- Token Risk on Base (`api/_riskbase.js`): there's no bonding curve, so holders and trades come from every transfer
  since the mint when there are at most 40,000 of them (read within 9 s), otherwise from the top holders Base's
  Blockscout lists, with 24 hour trades from DexScreener. Pools (the v4 PoolManager, DexScreener's pairs, contracts
  answering `token0`/`token1` with the token) and launch contracts (whatever the launch transaction handed supply
  to, and Clanker-style names) are set apart from holders. Price, market cap and the main pool come from
  DexScreener, and liquidity is judged by the ETH or USDC side of the main pool: under $1,000 is a high-risk flag,
  under $10,000 a low one. Same thresholds as Robinhood Chain otherwise. Measured: 4 to 13 s, 2 to 30 Blockscout and
  7 to 70 RPC requests.
- `BLOCKSCOUT_RPS` (optional, default 13): requests a second sent to Blockscout. The Builder plan allows 15; set 4
  on the free plan.
- Portfolio discovery scans incoming transfers within a time budget so answers stay well inside the gateway's 25 s.
- Endpoint Health and Website Check fetch addresses a caller chose, under the same rules as the page reader
  (`api/_net.js`): https only, no credentials, public addresses only at every hop. Endpoint Health follows no
  redirects; Website Check follows up to 4 and reads registration data from each registry's RDAP service, found
  through IANA's list (data.iana.org/rdap/dns.json).
- Page reader safety: https only, no credentials, every hop (redirects included) must resolve to a public address,
  max 3 redirects, 2 MB, 10 s, HTML or plain text only.
- Safe Swap (`api/swap.js`) never holds funds or sees a key: it answers unsigned transactions.
  - **Verdict.** Only the token being bought is checked; selling is never blocked, and ETH, WETH and USDG (plus
    `SWAP_TRUSTED_TOKENS`, comma-separated) are never checked. Thresholds, caution then block: largest wallet 8% / 15%,
    top 10 wallets 25% / 40%, wallets with a shared funder 5% / 15%, snipers still holding 3% / 10%, price impact 10% /
    25%, round-trip loss 15% / 35%. A high Risk Checker score blocks and a medium one cautions. No route back blocks.
    Cautions only: unnamed contracts from 20% (smart wallets count there), under 50 holders, under an hour old, a creator
    who sold or sent at least half of what they bought, and a token that isn't a launchpad token. Any block blocks; two
    cautions make a caution.
  - **Quote id.** The quote, signed with `SWAP_QUOTE_SECRET`, which must be set: a random value of its own, never the
    gateway key, so nobody who can call the API can sign a verdict. Without it the API answers 503. Nothing is kept
    between the two calls, so any instance builds it. It expires after 60 seconds.
  - **Fails closed.** A check that couldn't run answers 503 rather than a caution. That covers a Dev Wallet 404 from
    failed reads (only "no creator found" is a caution), a launchpad token the Risk Checker couldn't find, and a route
    back that errored, timed out or was malformed. The taker can't be the zero or dead address, either token, or the
    router.
  - **Build.** A fresh route that must still meet the quoted minimum. Slippage defaults to 1% and is capped at 5%. The
    swap has a 2-minute deadline. Approvals are for the exact amount, to the router the swap goes to. The router must
    be on the list: KyberSwap's `0x6131b5fae19ea4f9d964eac0408e4408b66337b5`, or `SWAP_ROUTERS` to replace the list.
    - KyberSwap's calldata is decoded and must match the quote: the same tokens and amount, parts adding up to the
      amount (none for ETH in), the taker receives, a minimum at least the quoted one, router flags `0x200` only (all
      it sends today), no fee and no permit. Anything else answers 502 with no transaction.
    - KyberSwap prices the route again when building, often a unit lower, so when its minimum lands under the quoted
      one the swap is built once more with the slippage from its own figure.
    - Every transaction carries `from` (the taker) and `chainId` 4663, so a wallet library refuses another account or
      chain. `min_out` is the one in the calldata.
  - **Charges.** Nothing is charged unless the answer is useful: no route (404), checks that couldn't run or ran past
    21 s (503), and expired, blocked or moved quotes (410, 403, 409) all fail.
  - **Load.** A first quote on a token takes about 10 to 13 s (the three reports, then cached), a sell about 1.5 s
    and a build about 1.5 to 5 s. The three checks read the chain heavily, so on the public RPC (no `ROBINHOOD_RPC_URL`)
    a quote can come back 503 when it rate-limits.
  - **Gateway.** One gateway, `safe-swap`, with this API's usual upstream and key. Each call, quote or build, is one
    paid call at the same price, so it doesn't matter which of the two a caller's query string ends up running.
    `KYBER_CLIENT_ID` defaults to `autonomo`.
  - **Tests.** `node --test test/` from this folder. They are offline: KyberSwap and the chain are stubbed.

## Deploy

A plain Vercel project. Every gateway's upstream is `https://tools.autonomo.fun/v1` with auth header `x-api-key` and
the `TOOLS_API_KEY` value; the Agent Playground and the Telegram bot add the right path for each slug above.
Deploy from this folder: `npx vercel deploy --prod`.

Pushes to the repo deploy it too, but only when something it is built from changed: this folder (its README and
tests aside) or the repo's `.vercelignore`. Other pushes are skipped by `ignore-build.sh`, and the deployment that
is live stays in place. If a change here doesn't show up, look for "Canceled by Ignored Build Step" on its
deployment in Vercel.
