// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title Autonomo Provider Bond
/// @notice API creators lock AUTONOMO as a bond. A bonded API gets priority on Autonomo. If the API takes
///         payments and does not deliver, part of the bond is slashed: a share refunds the payer, the rest
///         is burned.
/// @dev    One bond per provider wallet (the seller wallet of the API).
///         Trust model, v1: the slasher decides slashes and the owner can replace the slasher, so the
///         owner is the party providers trust. Limits enforced here, that even the owner cannot lift:
///           - each slash is capped at maxSlashBps of the bond (never above 50%)
///           - after a slash runs, the same provider cannot be slashed again for 30 days, which is longer
///             than the longest cooldown: a provider who asks to withdraw after a slash can always get
///             the rest out before a second one
///           - every slash waits disputeWindow before it can run, and the owner can cancel it meanwhile
///           - at least half of every slash is burned, so slashing can never mostly pay the slasher
///           - there is no function to take bonded tokens out other than withdraw (provider) and slash
contract ProviderBond is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    // Hard limits the owner can never go past.
    uint64 public constant MIN_COOLDOWN = 7 days;
    uint64 public constant MAX_COOLDOWN = 21 days; // always shorter than SLASH_INTERVAL
    uint64 public constant MIN_DISPUTE_WINDOW = 1 days;
    uint64 public constant MAX_DISPUTE_WINDOW = 6 days; // always shorter than the shortest cooldown
    uint16 public constant MAX_SLASH_BPS_CAP = 5_000; // one slash can never take more than 50% of a bond
    uint16 public constant MAX_REFUND_BPS = 5_000; // at least 50% of every slash is burned
    uint64 public constant EXECUTION_GRACE = 7 days; // an unexecuted slash expires after this
    uint64 public constant SLASH_INTERVAL = 30 days; // minimum time between two slashes of one provider

    IERC20 public immutable token;

    struct Bond {
        uint128 amount; // tokens locked
        uint128 pendingWithdraw; // part of `amount` the provider asked to take out
        uint64 withdrawReadyAt; // when pendingWithdraw can be withdrawn
    }

    struct Slash {
        address provider;
        uint64 proposedAt;
        uint16 refundBps; // refund share fixed when the slash is proposed
        address payer; // who gets the refund share (address(0) = burn everything)
        uint128 amount;
        uint64 executableAt;
        bytes32 reason; // hash or short code of the evidence, published off-chain
    }

    mapping(address => Bond) public bonds;
    mapping(uint256 => Slash) public slashes;
    mapping(address => uint256) public openSlashOf; // provider => open slash id (0 = none)
    mapping(address => uint64) public nextSlashAt; // provider => earliest time a new slash can be proposed
    uint256 public nextSlashId = 1;
    uint256 public totalBonded;

    address public slasher;
    uint128 public minBond;
    uint64 public cooldown;
    uint64 public disputeWindow;
    uint16 public maxSlashBps;
    uint16 public refundBps;

    event Deposited(address indexed provider, uint256 amount, uint256 newBond);
    event WithdrawRequested(address indexed provider, uint256 amount, uint256 readyAt);
    event WithdrawCancelled(address indexed provider);
    event Withdrawn(address indexed provider, uint256 amount);
    event SlashProposed(uint256 indexed id, address indexed provider, address indexed payer, uint256 amount, bytes32 reason, uint256 executableAt);
    event SlashCancelled(uint256 indexed id, address indexed provider);
    event SlashExecuted(uint256 indexed id, address indexed provider, uint256 refunded, uint256 burned);
    event SlasherSet(address indexed slasher);
    event ParamsSet(uint128 minBond, uint64 cooldown, uint64 disputeWindow, uint16 maxSlashBps, uint16 refundBps);

    error ZeroAmount();
    error ZeroAddress();
    error AmountTooHigh();
    error NothingPending();
    error NotReady();
    error SlashOpen();
    error NoSlash();
    error NotSlasher();
    error NotAllowed();
    error TooSoon();
    error BadParams();
    error RenounceDisabled();

    constructor(
        IERC20 token_,
        address owner_,
        address slasher_,
        uint128 minBond_,
        uint64 cooldown_,
        uint64 disputeWindow_,
        uint16 maxSlashBps_,
        uint16 refundBps_
    ) Ownable(owner_) {
        if (address(token_) == address(0) || slasher_ == address(0)) revert ZeroAddress();
        token = token_;
        slasher = slasher_;
        emit SlasherSet(slasher_);
        _setParams(minBond_, cooldown_, disputeWindow_, maxSlashBps_, refundBps_);
    }

    // ------------------------------------------------------------------ provider

    /// @notice Lock tokens as a bond. Needs an approval for `amount` first. Can be called again to add more.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before; // what really arrived
        Bond storage b = bonds[msg.sender];
        b.amount += SafeCast.toUint128(received);
        totalBonded += received;
        emit Deposited(msg.sender, received, b.amount);
    }

    /// @notice Ask to take `amount` out. It stops counting as active bond right away, and can be withdrawn
    ///         after the cooldown. Calling again replaces the previous request and restarts the cooldown.
    function requestWithdraw(uint256 amount) external {
        Bond storage b = bonds[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > b.amount) revert AmountTooHigh();
        b.pendingWithdraw = uint128(amount);
        b.withdrawReadyAt = uint64(block.timestamp) + cooldown;
        emit WithdrawRequested(msg.sender, amount, b.withdrawReadyAt);
    }

    function cancelWithdraw() external {
        Bond storage b = bonds[msg.sender];
        if (b.pendingWithdraw == 0) revert NothingPending();
        b.pendingWithdraw = 0;
        b.withdrawReadyAt = 0;
        emit WithdrawCancelled(msg.sender);
    }

    /// @notice Take out the requested amount once the cooldown is over. Blocked only by a slash that was
    ///         opened BEFORE the cooldown ended. A slash opened later cannot hold this withdrawal back.
    function withdraw() external nonReentrant {
        Bond storage b = bonds[msg.sender];
        if (b.pendingWithdraw == 0) revert NothingPending();
        if (block.timestamp < b.withdrawReadyAt) revert NotReady();
        uint256 id = openSlashOf[msg.sender];
        if (id != 0 && slashes[id].proposedAt < b.withdrawReadyAt) revert SlashOpen();
        uint256 amount = b.pendingWithdraw; // always <= b.amount
        b.amount -= uint128(amount);
        b.pendingWithdraw = 0;
        b.withdrawReadyAt = 0;
        totalBonded -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ slashing

    /// @notice Open a slash against a provider. It can run after the dispute window.
    /// @param payer  wallet that paid and did not get served (gets the refund share). address(0) = burn all.
    /// @param reason hash of the evidence (failed calls, tx hashes), published off-chain.
    function proposeSlash(address provider, uint256 amount, address payer, bytes32 reason) external returns (uint256 id) {
        if (msg.sender != slasher) revert NotSlasher();
        if (amount == 0) revert ZeroAmount();
        if (openSlashOf[provider] != 0) revert SlashOpen();
        if (block.timestamp < nextSlashAt[provider]) revert TooSoon();
        if (amount > (slashable(provider) * maxSlashBps) / BPS) revert AmountTooHigh();
        id = nextSlashId++;
        uint64 executableAt = uint64(block.timestamp) + disputeWindow;
        slashes[id] = Slash({
            provider: provider,
            proposedAt: uint64(block.timestamp),
            refundBps: refundBps,
            payer: payer,
            amount: uint128(amount), // fits: amount <= the provider's bond, which is a uint128
            executableAt: executableAt,
            reason: reason
        });
        openSlashOf[provider] = id;
        emit SlashProposed(id, provider, payer, amount, reason, executableAt);
    }

    /// @notice Cancel an open slash. Owner or slasher any time; anyone once it has expired unexecuted.
    function cancelSlash(uint256 id) external {
        Slash memory s = slashes[id];
        if (s.provider == address(0) || openSlashOf[s.provider] != id) revert NoSlash();
        bool expired = block.timestamp > uint256(s.executableAt) + EXECUTION_GRACE;
        if (msg.sender != owner() && msg.sender != slasher && !expired) revert NotAllowed();
        openSlashOf[s.provider] = 0;
        delete slashes[id];
        emit SlashCancelled(id, s.provider);
    }

    /// @notice Run a slash after its dispute window (and before it expires). Anyone can call.
    function executeSlash(uint256 id) external nonReentrant {
        Slash memory s = slashes[id];
        if (s.provider == address(0) || openSlashOf[s.provider] != id) revert NoSlash();
        if (block.timestamp < s.executableAt || block.timestamp > uint256(s.executableAt) + EXECUTION_GRACE) revert NotReady();

        Bond storage b = bonds[s.provider];
        uint256 amount = s.amount > b.amount ? b.amount : s.amount;
        b.amount -= uint128(amount);
        if (b.pendingWithdraw > b.amount) b.pendingWithdraw = b.amount;
        totalBonded -= amount;
        openSlashOf[s.provider] = 0;
        nextSlashAt[s.provider] = uint64(block.timestamp) + SLASH_INTERVAL;
        delete slashes[id];

        uint256 refund = s.payer == address(0) ? 0 : (amount * s.refundBps) / BPS;
        uint256 burned = amount - refund;
        if (refund > 0) token.safeTransfer(s.payer, refund);
        if (burned > 0) token.safeTransfer(BURN, burned);
        emit SlashExecuted(id, s.provider, refund, burned);
    }

    // ------------------------------------------------------------------ views

    /// @notice Bond that counts for priority: locked tokens minus what the provider asked to take out.
    function activeBond(address provider) public view returns (uint256) {
        Bond memory b = bonds[provider];
        return b.amount - b.pendingWithdraw;
    }

    function isBonded(address provider) external view returns (bool) {
        return minBond > 0 && activeBond(provider) >= minBond;
    }

    /// @notice What a new slash is measured against. A withdrawal that already finished its cooldown is
    ///         out of reach of NEW slashes and cannot be blocked by them, so a provider can't be held
    ///         hostage after waiting. During the cooldown the full bond stays slashable.
    function slashable(address provider) public view returns (uint256) {
        Bond memory b = bonds[provider];
        if (b.pendingWithdraw > 0 && block.timestamp >= b.withdrawReadyAt) return b.amount - b.pendingWithdraw;
        return b.amount;
    }

    // ------------------------------------------------------------------ admin

    function setSlasher(address slasher_) external onlyOwner {
        if (slasher_ == address(0)) revert ZeroAddress();
        slasher = slasher_;
        emit SlasherSet(slasher_);
    }

    /// @notice Change the settings, inside the hard limits. Does not touch withdrawals or slashes already started.
    function setParams(uint128 minBond_, uint64 cooldown_, uint64 disputeWindow_, uint16 maxSlashBps_, uint16 refundBps_) external onlyOwner {
        _setParams(minBond_, cooldown_, disputeWindow_, maxSlashBps_, refundBps_);
    }

    function _setParams(uint128 minBond_, uint64 cooldown_, uint64 disputeWindow_, uint16 maxSlashBps_, uint16 refundBps_) private {
        if (
            minBond_ == 0 || cooldown_ < MIN_COOLDOWN || cooldown_ > MAX_COOLDOWN
                || disputeWindow_ < MIN_DISPUTE_WINDOW || disputeWindow_ > MAX_DISPUTE_WINDOW
                || maxSlashBps_ == 0 || maxSlashBps_ > MAX_SLASH_BPS_CAP || refundBps_ > MAX_REFUND_BPS
        ) revert BadParams();
        minBond = minBond_;
        cooldown = cooldown_;
        disputeWindow = disputeWindow_;
        maxSlashBps = maxSlashBps_;
        refundBps = refundBps_;
        emit ParamsSet(minBond_, cooldown_, disputeWindow_, maxSlashBps_, refundBps_);
    }

    /// @dev Renouncing would freeze the slasher and settings forever. Disabled.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
