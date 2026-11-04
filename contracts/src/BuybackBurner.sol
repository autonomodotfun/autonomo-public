// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20, IPoolManager, IUnlockCallback, PoolKey, SafeTransfer, SwapParams} from "./Interfaces.sol";

/// Buys $AUTONOMO with the USDG it holds and sends it to the dead address, in one Uniswap v4 unlock:
/// USDG -> ETH in the ETH/USDG pool, then ETH -> $AUTONOMO in the token's pool. The bought tokens go straight from the
/// pool to the dead address and never pass through this contract.
///
/// Nobody can withdraw the USDG. The owner can only change the keeper or hand over ownership, which the new owner has to
/// accept, so a wrong address can't lose it. The pools and tokens are fixed at deployment.
/// Only the keeper can swap, with a minimum output it quotes off-chain. That limits what a sandwich in a thin pool can
/// take from a buyback but doesn't rule one out, since a pool moved before the quote skews the quote too. A compromised
/// keeper could force a poor price and profit from it, but can't withdraw the USDG; whatever it buys is still burned.
contract BuybackBurner is IUnlockCallback {
    using SafeTransfer for address;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    // TickMath limits, one step inside, so a swap can run to any price.
    uint160 internal constant MIN_SQRT_PRICE_LIMIT = 4295128739 + 1;
    uint160 internal constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342 - 1;

    IPoolManager public immutable poolManager;
    address public immutable usdg;
    address public immutable autonomo;
    // Both pools pair native ETH (currency0, address(0)) with the token (currency1).
    uint24 public immutable usdgPoolFee;
    int24 public immutable usdgPoolTickSpacing;
    address public immutable usdgPoolHooks;
    uint24 public immutable autonomoPoolFee;
    int24 public immutable autonomoPoolTickSpacing;
    address public immutable autonomoPoolHooks;

    address public owner;
    address public pendingOwner;
    address public keeper;

    event BoughtAndBurned(uint256 usdgIn, uint256 ethIn, uint256 autonomoBurned);
    event Burned(uint256 autonomoBurned);
    event KeeperSet(address indexed keeper);
    event OwnerProposed(address indexed owner);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroOwner();
    error NotKeeper();
    error NotPoolManager();
    error BadPools();
    error ZeroAmount();
    error TooLittleOut(uint256 out, uint256 minOut);
    error PartialFill();

    constructor(
        IPoolManager poolManager_,
        address usdg_,
        address autonomo_,
        PoolKey memory usdgPool,
        PoolKey memory autonomoPool,
        address owner_,
        address keeper_
    ) {
        if (owner_ == address(0)) revert ZeroOwner();
        if (
            usdgPool.currency0 != address(0) || usdgPool.currency1 != usdg_ || autonomoPool.currency0 != address(0)
                || autonomoPool.currency1 != autonomo_ || usdg_ == address(0) || autonomo_ == address(0)
        ) revert BadPools();
        poolManager = poolManager_;
        usdg = usdg_;
        autonomo = autonomo_;
        usdgPoolFee = usdgPool.fee;
        usdgPoolTickSpacing = usdgPool.tickSpacing;
        usdgPoolHooks = usdgPool.hooks;
        autonomoPoolFee = autonomoPool.fee;
        autonomoPoolTickSpacing = autonomoPool.tickSpacing;
        autonomoPoolHooks = autonomoPool.hooks;
        owner = owner_;
        keeper = keeper_;
        emit OwnerSet(owner_);
        emit KeeperSet(keeper_);
    }

    function usdgPoolKey() public view returns (PoolKey memory) {
        return PoolKey(address(0), usdg, usdgPoolFee, usdgPoolTickSpacing, usdgPoolHooks);
    }

    function autonomoPoolKey() public view returns (PoolKey memory) {
        return PoolKey(address(0), autonomo, autonomoPoolFee, autonomoPoolTickSpacing, autonomoPoolHooks);
    }

    /// Swaps `usdgIn` of the held USDG for $AUTONOMO and burns it. Reverts if fewer than `minOut` tokens would be burned.
    function buyAndBurn(uint256 usdgIn, uint256 minOut) external returns (uint256 burned) {
        if (msg.sender != keeper) revert NotKeeper();
        if (usdgIn == 0) revert ZeroAmount();
        (uint256 ethIn, uint256 out) = abi.decode(poolManager.unlock(abi.encode(usdgIn)), (uint256, uint256));
        if (out < minOut) revert TooLittleOut(out, minOut);
        emit BoughtAndBurned(usdgIn, ethIn, out);
        return out;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 usdgIn = abi.decode(data, (uint256));

        // USDG (currency1) in, ETH (currency0) out.
        int256 d1 = poolManager.swap(
            usdgPoolKey(), SwapParams(false, -int256(usdgIn), MAX_SQRT_PRICE_LIMIT), ""
        );
        if (-_amount1(d1) != int256(usdgIn) || _amount0(d1) <= 0) revert PartialFill();
        uint256 ethIn = uint256(int256(_amount0(d1)));

        // ETH (currency0) in, $AUTONOMO (currency1) out.
        int256 d2 = poolManager.swap(
            autonomoPoolKey(), SwapParams(true, -int256(ethIn), MIN_SQRT_PRICE_LIMIT), ""
        );
        if (-_amount0(d2) != int256(ethIn) || _amount1(d2) <= 0) revert PartialFill();
        uint256 out = uint256(int256(_amount1(d2)));

        // The ETH nets to zero between the two swaps. Pay the USDG and send the tokens to the dead address.
        poolManager.sync(usdg);
        usdg.safeTransfer(address(poolManager), usdgIn);
        poolManager.settle();
        poolManager.take(autonomo, DEAD, out);
        return abi.encode(ethIn, out);
    }

    /// Burns any $AUTONOMO sent here. Anyone can call it.
    function burnHeld() external returns (uint256 amount) {
        amount = IERC20(autonomo).balanceOf(address(this));
        if (amount == 0) return 0;
        autonomo.safeTransfer(DEAD, amount);
        emit Burned(amount);
    }

    function setKeeper(address keeper_) external {
        if (msg.sender != owner) revert NotOwner();
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// Proposes a new owner, who takes over by calling acceptOwner. Proposing address(0) cancels it.
    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = owner_;
        emit OwnerProposed(owner_);
    }

    function acceptOwner() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerSet(msg.sender);
    }

    function _amount0(int256 delta) private pure returns (int128) {
        return int128(delta >> 128);
    }

    function _amount1(int256 delta) private pure returns (int128) {
        return int128(delta);
    }
}
