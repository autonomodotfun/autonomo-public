# Base contracts

The splitters for creator APIs paid in USDC on Base. Build and test from this folder; see [`../README.md`](../README.md)
for installing the libraries and the full list of addresses.

## Splitters on Base

Creator APIs paid in USDC on Base are paid to the creator's **`BaseSplitter`** there, deployed by the **`BaseSplitterFactory`** at an address known in advance. A flush sends 95% of the USDC to the creator and 5% to the `reserve`, Autonomo's Base Safe, which refills the mirror burn pot on Robinhood Chain (see [`../robinhood/README.md`](../robinhood/README.md#mirror-burn-for-base-payments)). Nothing is burned on Base, which has no $AUTONOMO. Other tokens go to the creator in full; anyone can flush; nothing can be changed. Official APIs on Base are paid straight to the Safe.

It is `BurnSplitter`'s logic with names that say what happens on Base (`usdc`, `reserve`, `Flushed(token, toRecipient, toReserve)`), and `splitterOf` and `flush` are the same calls, so the app uses one interface for both. `test/BaseSplitter.t.sol` checks it on a fork of Base: `BASE_RPC_URL=https://mainnet.base.org forge test -vv`.

Deployed on Nov 17, 2026 from Remix with [`flat/BaseSplitter.flat.sol`](flat/BaseSplitter.flat.sol), contract `BaseSplitterFactory`, at [`0xd15fe8Df1074De6B65fbDb888cEd73531c2100d6`](https://base.blockscout.com/address/0xd15fe8Df1074De6B65fbDb888cEd73531c2100d6). Compiler 0.8.26, optimizer on with 10000 runs, EVM version cancun.

| Constructor value | What it is |
| --- | --- |
| `usdc_` | USDC on Base, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `reserve_` | Autonomo's Base Safe, `0x92a99FBD386F87277b6009BFF4C56728Ec5f7354` (where the 5% goes) |

The app reads it from `BASE_SPLITTER_FACTORY`: with it set, creator APIs can offer USDC on Base. The burn keeper flushes Base splitters with the same key as on Robinhood Chain, so it needs a little ETH on Base.
