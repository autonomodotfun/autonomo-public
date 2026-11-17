// SPDX-License-Identifier: MIT
// BurnSplitter and BurnSplitterFactory in one file, for reading and explorer verification.
// Compile with Solidity 0.8.26, optimizer on with 10000 runs, EVM version cancun.
// Deployed on Robinhood Chain on Nov 4, 2026: BurnSplitterFactory at 0x70a76f1E4bB8e8Ffa2A8451beB93c1900C45bbD8.
pragma solidity =0.8.26;

// ../shared/Interfaces.sol

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

// src/BurnSplitter.sol

/// Where one API creator's payments arrive. Flushing sends 5% of $AUTONOMO to the dead address and 5% of USDG to the
/// buyback contract, which buys $AUTONOMO with it and burns that; everything else goes to the creator. Other tokens
/// go to the creator in full. Anyone can flush; nothing here can be changed after deployment.
contract BurnSplitter {
    using SafeTransfer for address;

    uint256 public constant BURN_BPS = 500; // 5%
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable recipient;
    address public immutable autonomo;
    address public immutable usdg;
    address public immutable buyback;

    event Flushed(address indexed token, uint256 toRecipient, uint256 toBurn);

    constructor(address recipient_, address autonomo_, address usdg_, address buyback_) {
        recipient = recipient_;
        autonomo = autonomo_;
        usdg = usdg_;
        buyback = buyback_;
    }

    function flush(address token) public returns (uint256 toRecipient, uint256 toBurn) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) return (0, 0);
        if (token == autonomo || token == usdg) {
            toBurn = balance * BURN_BPS / 10_000;
            if (toBurn > 0) token.safeTransfer(token == autonomo ? DEAD : buyback, toBurn);
        }
        toRecipient = balance - toBurn;
        token.safeTransfer(recipient, toRecipient);
        emit Flushed(token, toRecipient, toBurn);
    }
}

/// Deploys one BurnSplitter per creator at an address known in advance, so gateways can be paid there before it exists.
contract BurnSplitterFactory {
    address public immutable autonomo;
    address public immutable usdg;
    address public immutable buyback;

    event SplitterDeployed(address indexed recipient, address splitter);

    error ZeroRecipient();
    error DeployFailed();

    constructor(address autonomo_, address usdg_, address buyback_) {
        autonomo = autonomo_;
        usdg = usdg_;
        buyback = buyback_;
    }

    function splitterOf(address recipient) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _salt(recipient), keccak256(_initCode(recipient)))
        );
        return address(uint160(uint256(hash)));
    }

    function deploy(address recipient) public returns (address splitter) {
        if (recipient == address(0)) revert ZeroRecipient();
        splitter = splitterOf(recipient);
        if (splitter.code.length > 0) return splitter;
        bytes memory code = _initCode(recipient);
        bytes32 salt = _salt(recipient);
        assembly {
            splitter := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (splitter == address(0)) revert DeployFailed();
        emit SplitterDeployed(recipient, splitter);
    }

    /// Deploys the creator's splitter if needed and flushes each token.
    function flush(address recipient, address[] calldata tokens) external returns (address splitter) {
        splitter = deploy(recipient);
        for (uint256 i; i < tokens.length; i++) {
            BurnSplitter(splitter).flush(tokens[i]);
        }
    }

    function _salt(address recipient) private pure returns (bytes32) {
        return bytes32(uint256(uint160(recipient)));
    }

    function _initCode(address recipient) private view returns (bytes memory) {
        return abi.encodePacked(type(BurnSplitter).creationCode, abi.encode(recipient, autonomo, usdg, buyback));
    }
}
