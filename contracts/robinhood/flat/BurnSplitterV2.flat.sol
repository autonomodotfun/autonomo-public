// SPDX-License-Identifier: MIT
// BurnSplitterV2 and BurnSplitterFactoryV2 in one file, for Remix and explorer verification.
// Compile with Solidity 0.8.26, optimizer on with 10000 runs, EVM version cancun. Deploy BurnSplitterFactoryV2.
// Not deployed yet. Not audited.
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

// src/BurnSplitterV2.sol

/// The part of the ERC-8004 identity registry the splitter reads.
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

/// Same split as BurnSplitter v1: 5% of USDG to the BuybackBurner, 5% of $AUTONOMO to the dead address, the rest to
/// the recipient. Other tokens go to the recipient in full. Anyone can flush; nothing can be changed after deployment.
///
/// New in v2: the splitter can be declared as an agent's wallet in the ERC-8004 identity registry, so the payments it
/// receives count for that agent (Priors Score v2). The registry asks the new wallet to approve one EIP-712 message,
/// AgentWalletSet(agentId, newWallet, owner, deadline), through ERC-1271.
///
/// The splitter approves that one message and nothing else. It never validates signatures in general: USDG and Permit2
/// accept ERC-1271 approvals for transfers, so a splitter that said yes to its recipient's signatures would let the
/// recipient sign funds out before the split and skip the burn.
///
/// How a declaration works:
///   1. The recipient calls approveAgentWallet(agentId, deadline). The splitter builds the exact registry digest itself,
///      with its own address, the agent's current owner and the deadline, and stores it.
///   2. Between deadline - 5 minutes and the deadline, the agent's owner calls the registry's
///      setAgentWallet(agentId, splitter, deadline, sig) with any bytes as sig (for example 0x).
///   3. The registry asks isValidSignature(digest, sig). The splitter says yes to that digest, until the deadline.
/// Only the recipient can approve, so nobody else can attach this splitter to their own agent.
contract BurnSplitterV2 {
    using SafeTransfer for address;

    uint256 public constant BURN_BPS = 500; // 5%
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes4 internal constant MAGIC = 0x1626ba7e; // IERC1271.isValidSignature.selector
    bytes4 internal constant NOPE = 0xffffffff;
    bytes32 public constant AGENT_WALLET_SET_TYPEHASH =
        keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    address public immutable recipient;
    address public immutable autonomo;
    address public immutable usdg;
    address public immutable buyback;
    address public immutable registry;

    /// The one registry message this splitter currently approves, and until when. Zero when none.
    bytes32 public approvedDigest;
    uint256 public approvedUntil;

    event Flushed(address indexed token, uint256 toRecipient, uint256 toBurn);
    event AgentWalletApproved(uint256 indexed agentId, address indexed owner, uint256 deadline, bytes32 digest);
    event AgentWalletApprovalCleared();

    error NotRecipient();
    error BadDeadline();
    error UnexpectedDomain();

    constructor(address recipient_, address autonomo_, address usdg_, address buyback_, address registry_) {
        recipient = recipient_;
        autonomo = autonomo_;
        usdg = usdg_;
        buyback = buyback_;
        registry = registry_;
    }

    // ------------------------------------------------------------------ split (unchanged from v1)

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

    // ------------------------------------------------------------------ ERC-8004 declaration

    /// Approves the registry message that declares this splitter as `agentId`'s wallet, valid until `deadline`.
    /// The owner is read from the registry now: if the agent changes hands before the declaration, the digest won't
    /// match and the declaration fails, so approve again for the new owner.
    /// The deadline can be up to 1 day ahead, so a Safe recipient has time to sign. The registry itself only accepts
    /// the call in the last 5 minutes before the deadline.
    function approveAgentWallet(uint256 agentId, uint256 deadline) external returns (bytes32 digest) {
        if (msg.sender != recipient) revert NotRecipient();
        if (deadline < block.timestamp || deadline > block.timestamp + 1 days) revert BadDeadline();
        address owner = IIdentityRegistry(registry).ownerOf(agentId);
        digest = agentWalletDigest(agentId, owner, deadline);
        approvedDigest = digest;
        approvedUntil = deadline;
        emit AgentWalletApproved(agentId, owner, deadline, digest);
    }

    /// Withdraws the approval before it is used or expires.
    function clearAgentWalletApproval() external {
        if (msg.sender != recipient) revert NotRecipient();
        delete approvedDigest;
        delete approvedUntil;
        emit AgentWalletApprovalCleared();
    }

    /// ERC-1271. Yes only for the one approved registry message, until its deadline. The signature bytes are ignored.
    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        if (hash != bytes32(0) && hash == approvedDigest && block.timestamp <= approvedUntil) return MAGIC;
        return NOPE;
    }

    /// The exact digest the registry builds in setAgentWallet for this splitter.
    function agentWalletDigest(uint256 agentId, address owner, uint256 deadline) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, address(this), owner, deadline));
        return keccak256(abi.encodePacked("\x19\x01", _registryDomainSeparator(), structHash));
    }

    function _registryDomainSeparator() internal view returns (bytes32) {
        (bytes1 fields, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            IIdentityRegistry(registry).eip712Domain();
        // name, version, chainId and verifyingContract only (OpenZeppelin EIP712). Anything else: refuse rather than guess.
        if (fields != hex"0f" || chainId != block.chainid || verifyingContract != registry) revert UnexpectedDomain();
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract));
    }
}

/// Deploys one BurnSplitterV2 per recipient at an address known in advance, like the v1 factory.
contract BurnSplitterFactoryV2 {
    address public immutable autonomo;
    address public immutable usdg;
    address public immutable buyback;
    address public immutable registry;

    event SplitterDeployed(address indexed recipient, address splitter);

    error ZeroAddress();
    error ZeroRecipient();
    error DeployFailed();

    constructor(address autonomo_, address usdg_, address buyback_, address registry_) {
        if (autonomo_ == address(0) || usdg_ == address(0) || buyback_ == address(0) || registry_ == address(0)) {
            revert ZeroAddress();
        }
        autonomo = autonomo_;
        usdg = usdg_;
        buyback = buyback_;
        registry = registry_;
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

    function flush(address recipient, address[] calldata tokens) external returns (address splitter) {
        splitter = deploy(recipient);
        for (uint256 i; i < tokens.length; i++) {
            BurnSplitterV2(splitter).flush(tokens[i]);
        }
    }

    function _salt(address recipient) private pure returns (bytes32) {
        return bytes32(uint256(uint160(recipient)));
    }

    function _initCode(address recipient) private view returns (bytes memory) {
        return abi.encodePacked(type(BurnSplitterV2).creationCode, abi.encode(recipient, autonomo, usdg, buyback, registry));
    }
}

