# Contracts

Autonomo's on-chain contracts, one folder per chain. Each folder is its own [Foundry](https://getfoundry.sh) project, with the
Solidity sources (`src`), tests (`test`), deploy scripts where there are any (`script`), and a one-file copy of each
contract (`flat`) for deploying from [Remix](https://remix.ethereum.org) or verifying on an explorer.

```
contracts/
  robinhood/   Robinhood Chain: burn splitters, buyback, mirror burn pot, rewards vesting   → robinhood/README.md
  base/        Base: the splitters for creator APIs paid in USDC on Base                   → base/README.md
  shared/      Interfaces.sol: the few ERC-20 and Uniswap v4 pieces the contracts use
  lib/         forge-std and OpenZeppelin, installed once for both (not committed)
```

## Deployed

| Contract | Chain | Address | Source | One-file copy |
| --- | --- | --- | --- | --- |
| `BurnSplitterFactory` (and each `BurnSplitter`) | Robinhood Chain | [`0x70a76f1E4bB8e8Ffa2A8451beB93c1900C45bbD8`](https://robinhoodchain.blockscout.com/address/0x70a76f1E4bB8e8Ffa2A8451beB93c1900C45bbD8) | [`robinhood/src/BurnSplitter.sol`](robinhood/src/BurnSplitter.sol) | [`BurnSplitter.flat.sol`](robinhood/flat/BurnSplitter.flat.sol) |
| `BurnSplitterFactoryV2` (and each `BurnSplitterV2`) | Robinhood Chain | [`0x8691b73eBE4064FbAaeF05Ea893cD2e5584b2C37`](https://robinhoodchain.blockscout.com/address/0x8691b73eBE4064FbAaeF05Ea893cD2e5584b2C37) | [`robinhood/src/BurnSplitterV2.sol`](robinhood/src/BurnSplitterV2.sol) | [`BurnSplitterV2.flat.sol`](robinhood/flat/BurnSplitterV2.flat.sol) |
| `BuybackBurner` | Robinhood Chain | [`0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464`](https://robinhoodchain.blockscout.com/address/0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464) | [`robinhood/src/BuybackBurner.sol`](robinhood/src/BuybackBurner.sol) | [`BuybackBurner.flat.sol`](robinhood/flat/BuybackBurner.flat.sol) |
| `MirrorBurnPot` | Robinhood Chain | [`0xa93d4029fd4D6BFe2a1E739f50B4d38e1D8e777A`](https://robinhoodchain.blockscout.com/address/0xa93d4029fd4D6BFe2a1E739f50B4d38e1D8e777A) | [`robinhood/src/MirrorBurnPot.sol`](robinhood/src/MirrorBurnPot.sol) | [`MirrorBurnPot.flat.sol`](robinhood/flat/MirrorBurnPot.flat.sol) |
| `AutonomoRewardsVesting` | Robinhood Chain | [`0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277`](https://robinhoodchain.blockscout.com/address/0xF8795F9F5F92Fec042d94A8D879770C0bdE9D277) | [`robinhood/src/AutonomoRewardsVesting.sol`](robinhood/src/AutonomoRewardsVesting.sol) | [`AutonomoRewardsVesting.flat.sol`](robinhood/flat/AutonomoRewardsVesting.flat.sol) |
| `BaseSplitterFactory` (and each `BaseSplitter`) | Base | [`0xd15fe8Df1074De6B65fbDb888cEd73531c2100d6`](https://base.blockscout.com/address/0xd15fe8Df1074De6B65fbDb888cEd73531c2100d6) | [`base/src/BaseSplitter.sol`](base/src/BaseSplitter.sol) | [`BaseSplitter.flat.sol`](base/flat/BaseSplitter.flat.sol) |

`BurnSplitterFactoryV2` replaces `BurnSplitterFactory` for new payments once the app switches to it, and the v1 splitters
keep being flushed. See [`robinhood/README.md`](robinhood/README.md#burnsplitter-v2-declarable-as-an-agent-wallet).

All six deployed contracts show verified source on Blockscout. Built from these folders, each one's code matches what's on-chain, apart
from the metadata stamp at its end, which records file names and paths. All use Solidity 0.8.26, optimizer on with
10000 runs, EVM version cancun.

## Build and test

Install the libraries once, from this folder:

```bash
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
```

Then build and test each chain from its own folder:

```bash
cd robinhood && forge test
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test -vv
cd ../base && BASE_RPC_URL=https://mainnet.base.org forge test -vv
```

Fork tests run against the real tokens, pools and deployed contracts, and are skipped without the RPC address.

To make a one-file copy, run `forge flatten src/<File>.sol -o flat/<File>.flat.sol` in that chain's folder. The
copies already in `flat` are the exact files the deployed contracts were verified from, so leave those as they are.
