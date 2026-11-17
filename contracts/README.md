# Burn contracts

5% of every API payment through Autonomo is burned, on-chain, on Robinhood Chain.

- **`BurnSplitter`**: one per payee, at an address known before it's deployed. Gateways are paid there. Flushing it sends 5% of $AUTONOMO to `0x000000000000000000000000000000000000dEaD`, 5% of USDG to the `BuybackBurner`, and the rest to the payee. Anyone can flush. Nothing in it can be changed.
- **`BurnSplitterFactory`**: deploys splitters with CREATE2 (`splitterOf(payee)` gives the address) and flushes them.
- **`BuybackBurner`**: swaps the USDG it holds for $AUTONOMO in one Uniswap v4 unlock (USDG → ETH in the 0.05% ETH/USDG pool, ETH → $AUTONOMO in the token's pool) and sends the tokens straight from the pool to the dead address. Nobody can withdraw the USDG. Only the keeper can swap, and it sets a minimum output (the app uses 2% below a simulated quote). That limits what a sandwich can take from a buyback but doesn't rule one out, since a pool moved before the quote skews the quote too. A compromised keeper could force a poor price and profit from it, but can't withdraw the USDG, and whatever it buys is still burned. The owner can only change the keeper or hand over ownership, which the new owner has to accept.

Every burn is an on-chain event: `Flushed(token, toRecipient, toBurn)` on splitters and `BoughtAndBurned(usdgIn, ethIn, autonomoBurned)` on the buyback.

The app (`src/lib/burn.ts`) flushes a payee's splitter once a payment takes it to 1,000 $AUTONOMO or 0.10 USDG, and a daily run (`/api/cron/burn`) flushes anything from 100 $AUTONOMO or 0.10 USDG. It buys back once the buyback holds at least 0.1 USDG, swapping at most 100 USDG per run because the token's pool is thin (100 USDG moves the price by about 1%, 1,000 by about 8%). Anything above that waits for later runs.

## Build and test

Needs [Foundry](https://getfoundry.sh).

```bash
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge test
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract ForkTest -vv
```

The fork tests run against the real tokens and pools.

## Deploy

```bash
BURN_OWNER=<Autonomo Safe> BURN_KEEPER=<a dedicated gas-only wallet> forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --interactives 1 --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

Check that both contracts show verified source on the explorer: the docs send holders there to read the code. Then set `BUYBACK_BURNER`, `BURN_SPLITTER_FACTORY`, `BURN_START_BLOCK` and `BURN_KEEPER_PRIVATE_KEY` (the deployment block shown on the explorer) in the app's environment. Payments start going to splitters on the next deploy; until then they go straight to payees.

## Mirror burn for Base payments

Official APIs also take USDC on Base, paid straight to the official Safe there. Base has no splitter and no $AUTONOMO pool, so **`MirrorBurnPot`** burns the same 5% on Robinhood Chain instead:

- It holds a float of USDG, refilled by the official Safe from its fees. Anyone can refill it by sending USDG to it.
- Once a day the keeper calls `mirror(amount, paidElsewhere)`. It sends `amount` to the `BuybackBurner`, which buys and burns with it as usual.
- `paidElsewhere` is the running total of Base payments, in USDC's 6 decimals, which USDG shares. It can only go up, and everything ever sent can't exceed 5% of it. So the `Mirrored(usdgSent, paidElsewhere, mirroredTotal)` events show what each burn was for.
- When the pot runs short, the app sends what it holds. The rest stays owed (`owedFor(total)`) and goes out after the next refill.
- The keeper is the `BuybackBurner`'s own keeper, read from it, so replacing that keeper replaces this one too.
- The USDG can only go to the `BuybackBurner`, or back to the owner (`withdraw`). A compromised keeper can at worst burn the float early. Handing over ownership takes two steps.

Deploy it from [Remix](https://remix.ethereum.org) with [`flat/MirrorBurnPot.flat.sol`](flat/MirrorBurnPot.flat.sol): compiler 0.8.26, optimizer on with 10000 runs, EVM version cancun.

| Constructor value | What it is |
| --- | --- |
| `buybackBurner_` | `0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464` |
| `burnBps_` | `500` (5%) |
| `owner_` | The official payment Safe, `0x92a99FBD386F87277b6009BFF4C56728Ec5f7354` |

Then set `MIRROR_BURN_POT` in the app's environment and send the pot its first USDG. The fork test runs it against the deployed `BuybackBurner`: `forge test --match-contract MirrorBurnPotForkTest -vv`.

## Splitters on Base

Creator APIs paid in USDC on Base are paid to the creator's splitter there, from the same `BurnSplitterFactory`, deployed on Base unchanged. A flush sends 95% of USDC to the creator and 5% to Autonomo's Base Safe, which refills the mirror burn pot above. Official APIs on Base are still paid straight to the Safe. `test/BaseSplitter.t.sol` checks this on a fork of Base: `BASE_RPC_URL=https://mainnet.base.org forge test --match-contract BaseSplitterForkTest -vv`.

Deploy it on Base from [Remix](https://remix.ethereum.org) with [`flat/BurnSplitter.flat.sol`](flat/BurnSplitter.flat.sol), contract `BurnSplitterFactory`, same compiler settings:

| Constructor value | What it is |
| --- | --- |
| `autonomo_` | `0x0000000000000000000000000000000000000000` (there's no $AUTONOMO on Base) |
| `usdg_` | USDC on Base, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (the token 5% is taken from) |
| `buyback_` | Autonomo's Base Safe, `0x92a99FBD386F87277b6009BFF4C56728Ec5f7354` (where the 5% goes) |

Then set `BASE_SPLITTER_FACTORY` in the app's environment: every API then offers USDC on Base. The burn keeper flushes Base splitters with the same key, so send it a little ETH on Base first.

## Rewards vesting

**`AutonomoRewardsVesting`** holds the $AUTONOMO set aside for rewards and releases it in a straight line between its start and its end. It is OpenZeppelin's `VestingWallet` (v5.1.0) with two guards on who receives:

- Ownership can't be given up. Released tokens go to the owner, so with no owner they would be stuck for good.
- Handing over to a new owner takes two steps: the new owner has to accept.

Anyone can call `release(token)`; it only ever pays the owner, the Rewards Safe. Nobody, the owner included, can take tokens out ahead of the schedule. Tokens sent in after the start vest on the same schedule, so part of them is releasable at once: refills go to the Rewards Safe, never to this contract.

It has no pieces of its own to configure, so it is deployed from [Remix](https://remix.ethereum.org) with the single file [`flat/AutonomoRewardsVesting.flat.sol`](flat/AutonomoRewardsVesting.flat.sol), which is this contract and the OpenZeppelin files it uses. Compiler 0.8.26, optimizer on with 10000 runs, EVM version cancun: the same file and settings verify it on the explorer.

Deployed on Robinhood Chain at [`0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277`](https://robinhoodchain.blockscout.com/address/0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277), paying the Rewards Safe `0x26FB8dc4550893e832e3238637dd93D2B6beB6B4` (2 of 2) from December 1, 2026 to May 30, 2027. `owner()`, `start()`, `end()` and `releasable(token)` read all of it back.

| Constructor value | What it is |
| --- | --- |
| `beneficiary` | The Rewards Safe |
| `startTimestamp` | When vesting starts, in Unix seconds (Dec 1, 2026 00:00 UTC is `1796083200`) |
| `durationSeconds` | How long it runs (180 days is `15552000`) |
