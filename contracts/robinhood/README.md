# Robinhood Chain contracts

The burn, the mirror burn for Base payments, the rewards vesting, and the provider bond (not deployed yet). Build and test from this folder; see
[`../README.md`](../README.md) for installing the libraries and the full list of addresses.

## Burn contracts

5% of every API payment through Autonomo is burned, on-chain, on Robinhood Chain.

- **`BurnSplitter`**: one per payee, at an address known before it's deployed. Gateways are paid there. Flushing it sends 5% of $AUTONOMO to `0x000000000000000000000000000000000000dEaD`, 5% of USDG to the `BuybackBurner`, and the rest to the payee. Anyone can flush. Nothing in it can be changed.
- **`BurnSplitterFactory`**: deploys splitters with CREATE2 (`splitterOf(payee)` gives the address) and flushes them.
- **`BuybackBurner`**: swaps the USDG it holds for $AUTONOMO in one Uniswap v4 unlock (USDG → ETH in the 0.05% ETH/USDG pool, ETH → $AUTONOMO in the token's pool) and sends the tokens straight from the pool to the dead address. Nobody can withdraw the USDG. Only the keeper can swap, and it sets a minimum output (the app uses 2% below a simulated quote). That limits what a sandwich can take from a buyback but doesn't rule one out, since a pool moved before the quote skews the quote too. A compromised keeper could force a poor price and profit from it, but can't withdraw the USDG, and whatever it buys is still burned. The owner can only change the keeper or hand over ownership, which the new owner has to accept.

Every burn is an on-chain event: `Flushed(token, toRecipient, toBurn)` on splitters and `BoughtAndBurned(usdgIn, ethIn, autonomoBurned)` on the buyback.

The app (`src/lib/payments/burn.ts`) flushes a payee's splitter once a payment takes it to 1,000 $AUTONOMO or 0.10 USDG, and a daily run (`/api/cron/burn`) flushes anything from 100 $AUTONOMO or 0.10 USDG. It buys back once the buyback holds at least 0.1 USDG, swapping at most 100 USDG per run because the token's pool is thin (100 USDG moves the price by about 1%, 1,000 by about 8%). Anything above that waits for later runs.

Deployed on Nov 4, 2026 with the Foundry script, in block 105635227:

```bash
BURN_OWNER=<Autonomo Safe> BURN_KEEPER=<a dedicated gas-only wallet> forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast --interactives 1 --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

Check that both contracts show verified source on the explorer: the docs send holders there to read the code. If `--verify` can't reach the explorer, verify through its web form with [`flat/BurnSplitter.flat.sol`](flat/BurnSplitter.flat.sol) and [`flat/BuybackBurner.flat.sol`](flat/BuybackBurner.flat.sol). Then set `BUYBACK_BURNER`, `BURN_SPLITTER_FACTORY`, `BURN_START_BLOCK` (the deployment block shown on the explorer) and `BURN_KEEPER_PRIVATE_KEY` in the app's environment.

## BurnSplitter v2: declarable as an agent wallet

**`BurnSplitterV2`** splits exactly like v1: its `flush()` is the same code. What it adds is that it can be declared as an
agent's wallet in the ERC-8004 identity registry ([`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://robinhoodchain.blockscout.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)).
Then the USDG it receives counts for that agent on Priors (Score v2 counts payments into the declared wallet).

The registry asks the new wallet to approve one EIP-712 message, `AgentWalletSet(agentId, newWallet, owner, deadline)`, through
ERC-1271. The splitter approves that one message and nothing else:

| Function | Who | What it does |
| --- | --- | --- |
| `approveAgentWallet(agentId, deadline)` | Recipient only | Builds the registry's exact digest (this splitter, the agent's current owner read from the registry, the deadline) and stores it. The deadline must be within 1 day. |
| `isValidSignature(hash, sig)` | Anyone (the registry) | Yes only for that stored digest, until its deadline. The signature bytes are ignored. Anything else gets `0xffffffff`. |
| `clearAgentWalletApproval()` | Recipient only | Withdraws the approval. |
| `agentWalletDigest(agentId, owner, deadline)` | Anyone | Shows the digest before declaring. |

Why only one message: USDG accepts ERC-1271 approvals for `transferWithAuthorization` and `permit`. A splitter that said yes
to signatures in general could be emptied with a junk signature, skipping the burn. The fork test
`test_naive_splitter_is_drained` shows that happening to a careless splitter, and `test_usdg_cannot_be_signed_out_of_the_splitter`
shows v2 blocking it, even while an approval is live.

**`BurnSplitterFactoryV2`** works like v1's factory (`splitterOf`, `deploy`, `flush`). Its constructor takes, in order:

| Constructor value | What it is |
| --- | --- |
| `autonomo_` | `0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96` |
| `usdg_` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| `buyback_` | The `BuybackBurner`, `0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464` |
| `registry_` | The ERC-8004 identity registry, `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

Deployed on Nov 19, 2026 from Remix with [`flat/BurnSplitterV2.flat.sol`](flat/BurnSplitterV2.flat.sol) (Solidity 0.8.26, optimizer
on with 10000 runs, EVM version cancun), in block 118128151, at
[`0x8691b73eBE4064FbAaeF05Ea893cD2e5584b2C37`](https://robinhoodchain.blockscout.com/address/0x8691b73eBE4064FbAaeF05Ea893cD2e5584b2C37).
Its code matches this folder's build apart from the four constructor addresses and the metadata stamps. The one-file copy is
left as Remix compiled it, so its header still says "Not deployed yet". It is **not audited**.

Switching to it gives every payee a new splitter address, because the factory is new. The app moves all APIs at once when
`BURN_SPLITTER_FACTORY` changes, and `BURN_SPLITTER_FACTORY_PREVIOUS` (set to the v1 factory) keeps the daily run flushing
the v1 splitters and `/burn` counting their past burns.

Declaring a splitter as an agent's wallet:

1. The agent's owner registers the agent on the registry and notes its id.
2. The splitter's recipient calls `approveAgentWallet(agentId, deadline)`. For a Safe, pick a deadline a few hours ahead so
   every signer has time. The `AgentWalletApproved` event must name the agent's owner.
3. In the last 5 minutes before the deadline, the owner calls `setAgentWallet(agentId, splitter, deadline, 0x)` on the
   registry. It refuses earlier ("deadline too far") and after ("expired").
4. `getAgentWallet(agentId)` on the registry returns the splitter.

Limits:

- One agent per splitter. The recipient could approve a second agent later, and both would stay declared. To move to
  another agent, call `unsetAgentWallet` on the old one first.
- If the agent changes hands, the registry clears its wallet and the old approval no longer matches: approve again.
- The registry is upgradeable. If its EIP-712 domain or message changes, declarations fail (never a wrong yes), and a new
  splitter version would be needed.
- Never borrow with a splitter as the loan's `to`: the loan would be split and 5% burned.
- Only USDG on Robinhood Chain counts for the score.

The fork tests run against the real registry, USDG, $AUTONOMO and `BuybackBurner`:
`ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-path test/BurnSplitterV2.t.sol -vv`.

## Mirror burn for Base payments

APIs also take USDC on Base, where there's no $AUTONOMO pool to burn in. So **`MirrorBurnPot`** burns the same 5% on Robinhood Chain instead:

- It holds a float of USDG, refilled by Autonomo. Creator APIs' Base payments keep 5% for Autonomo's Base Safe (see [`../base/README.md`](../base/README.md)), which pays for the refills. Anyone can refill it by sending USDG to it.
- Once a day the keeper calls `mirror(amount, paidElsewhere)`. It sends `amount` to the `BuybackBurner`, which buys and burns with it as usual.
- `paidElsewhere` is the running total of Base payments, in USDC's 6 decimals, which USDG shares. It can only go up, and everything ever sent can't exceed 5% of it. So the `Mirrored(usdgSent, paidElsewhere, mirroredTotal)` events show what each burn was for.
- When the pot runs short, the app sends what it holds. The rest stays owed (`owedFor(total)`) and goes out after the next refill.
- The keeper is the `BuybackBurner`'s own keeper, read from it, so replacing that keeper replaces this one too.
- The USDG can only go to the `BuybackBurner`, or back to the owner (`withdraw`). A compromised keeper can at worst burn the float early. Handing over ownership takes two steps.

Deployed on Nov 17, 2026 from Remix with [`flat/MirrorBurnPot.flat.sol`](flat/MirrorBurnPot.flat.sol), at [`0xa93d4029fd4D6BFe2a1E739f50B4d38e1D8e777A`](https://robinhoodchain.blockscout.com/address/0xa93d4029fd4D6BFe2a1E739f50B4d38e1D8e777A):

| Constructor value | What it is |
| --- | --- |
| `buybackBurner_` | `0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464` |
| `burnBps_` | `500` (5%) |
| `owner_` | The official payment Safe, `0x92a99FBD386F87277b6009BFF4C56728Ec5f7354` |

The app reads it from `MIRROR_BURN_POT`. The fork test runs it against the deployed `BuybackBurner`: `forge test --match-contract MirrorBurnPotForkTest -vv`.

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

## Provider bond

**`ProviderBond`** lets an API creator lock $AUTONOMO as a bond. If a bonded API takes payments and doesn't deliver, part of
the bond is slashed: a share refunds the payer and the rest goes to `0x000000000000000000000000000000000000dEaD`. The
creator gets the rest back after a waiting period. One bond per wallet, for all of that wallet's APIs.

It is **not deployed yet and not audited**. Anyone bonding before an audit takes that risk.

| Function | Who | What it does |
| --- | --- | --- |
| `deposit(amount)` | The creator | Locks tokens, after an approval. Can be called again to add more. |
| `requestWithdraw(amount)` | The creator | That amount stops counting at once, and can be taken out after the cooldown. Calling again replaces the request and restarts the cooldown. |
| `withdraw()` / `cancelWithdraw()` | The creator | Takes the requested amount out once the cooldown is over, or drops the request to stay bonded. |
| `proposeSlash(provider, amount, payer, reason)` | The slasher | Opens a slash. `reason` is a hash of the evidence, published off-chain. A `payer` of `address(0)` burns all of it. |
| `cancelSlash(id)` | Owner or slasher; anyone once it has expired | Drops an open slash. |
| `executeSlash(id)` | Anyone | Runs a slash after its dispute window: the refund share to the payer, the rest burned. |
| `isBonded(provider)` / `activeBond(provider)` | Anyone | Whether the wallet holds at least the minimum, and how much counts (locked tokens minus any requested withdrawal). |
| `setSlasher` / `setParams` | The owner | Replaces the slasher, or changes the settings inside the limits below. |

Limits written into the contract, which the owner can't lift:

- One slash takes at most `maxSlashBps` of a bond, and that setting can never go above 50%.
- At least 50% of every slash is burned.
- One open slash per creator, and 30 days between two slashes of the same creator. The cooldown is 7 to 21 days, so a
  creator who asks to withdraw after a slash gets the rest out before a second slash is possible.
- Every slash waits out the dispute window (1 to 6 days) before it can run, and expires 7 days after that if nobody runs it.
- A withdrawal that has finished its cooldown can't be reduced or blocked by a new slash. A slash opened during the
  cooldown can hold it back until that slash runs, is cancelled or expires.
- Bonded tokens leave only through the creator's `withdraw` or a slash. Handing over ownership takes two steps, and it
  can't be given up.

What it doesn't solve:

- A person decides a slash, not code: the contract can't see whether an API answered. The slasher also names the payer,
  so the owner, who can replace the slasher, is the party creators trust. The limits above bound what that trust can cost:
  one capped slash, then the creator can leave.
- One slash names one payer, and the next slash of that creator is 30 days away. When several payers lost money, the
  slash names an Autonomo refund wallet as the payer. That wallet passes the refund on to each payer in proportion to
  what they lost, publishes the transfers, and keeps none of it.
- A slash that is too small still starts the 30 days.
- A slashed creator still reads as bonded in the contract if what is left is above the minimum. So after a slash the
  site hides the Bonded badge for 30 days, and the slash history stays on the API's page.
- Refunds are in $AUTONOMO, whatever the payer paid with.
- Tokens sent to the contract directly, not through `deposit`, are stuck.
- If the refund transfer to the payer fails, the slash can't run. It has to be cancelled, or it expires.

Its constructor takes, in order:

| Constructor value | What it is | Proposed |
| --- | --- | --- |
| `token_` | $AUTONOMO | `0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96` |
| `owner_` | A Safe used for nothing else. Cancels slashes, replaces the slasher, changes the settings | To come |
| `slasher_` | A separate wallet that proposes slashes, its key kept off the server | To come |
| `minBond_` | The floor `isBonded` applies on-chain, in the token's 18 decimals. The site's Bonded badge asks for about $100 of $AUTONOMO instead, set weekly from the previous week's average price and locked per wallet like Verified (`src/lib/trust/bond.ts`), and never less than this floor | `100000000000000000000000` (100,000 tokens) |
| `cooldown_` | Seconds between asking to withdraw and withdrawing | `1209600` (14 days) |
| `disputeWindow_` | Seconds a slash waits before it can run | `259200` (3 days) |
| `maxSlashBps_` | Most one slash can take | `2000` (20% of the bond) |
| `refundBps_` | Share of a slash that refunds the payer | `5000` (50%, the other half is burned) |

Tests: `forge test --match-path test/ProviderBond.t.sol` runs 24 tests on a stand-in token, one of them with random
deposits, withdrawals and slashes. `ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract ProviderBondForkTest -vv`
runs a bond, a slash and an exit with the real $AUTONOMO. The one-file copy is [`flat/ProviderBond.flat.sol`](flat/ProviderBond.flat.sol).
