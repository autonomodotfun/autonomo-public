// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// The few parts of ERC-20 and Uniswap v4 the burn contracts use, so they build without outside packages.

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// Uniswap v4 pool key. A currency of address(0) is native ETH.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    /// Returns a BalanceDelta: amount0 in the upper 128 bits, amount1 in the lower 128, positive when owed to the caller.
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// Transfers that also work with tokens that return nothing.
library SafeTransfer {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || (ret.length == 0 && token.code.length == 0)) {
            revert TransferFailed();
        }
    }
}
