// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "../src/Interfaces.sol";

/// Robinhood Chain (4663) addresses the burn contracts are deployed with.
library Robinhood {
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant AUTONOMO = 0xE83C85E1eaD16FCFe85401E2b337Fb4FB5B5cC96;

    /// ETH/USDG, 0.05%, no hooks: the deepest ETH/USDG pool on the chain.
    /// Pool id 0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982.
    function usdgPool() internal pure returns (PoolKey memory) {
        return PoolKey(address(0), USDG, 500, 10, address(0));
    }

    /// $AUTONOMO's launch pool, whose hook takes the swap fee.
    /// Pool id 0x0785dca2d20352f173f88dd63a0d052ce017a7ba729f5d2a78fdb77a535f7195.
    function autonomoPool() internal pure returns (PoolKey memory) {
        return PoolKey(address(0), AUTONOMO, 0, 200, 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044);
    }
}
