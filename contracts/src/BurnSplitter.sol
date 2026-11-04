// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20, SafeTransfer} from "./Interfaces.sol";

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
