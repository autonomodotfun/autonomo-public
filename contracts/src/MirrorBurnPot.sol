// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20, SafeTransfer} from "./Interfaces.sol";

interface IBuybackBurner {
    function keeper() external view returns (address);
    function usdg() external view returns (address);
}

/// The mirror burn for payments made on other chains (Base, in USDC). Those payments can't be burned where they land,
/// so this pot holds a float of USDG on Robinhood Chain and burns the same share of them here: the keeper sends USDG
/// from the pot to the BuybackBurner, which buys $AUTONOMO with it and burns it, as it does for payments on this chain.
///
/// Each send states the running total of those payments (`paidElsewhere`, in USDC's 6 decimals, which USDG shares).
/// That total can only go up, and everything ever sent can't exceed `burnBps` of it, so the public record always shows
/// what the burns were for. The keeper is the BuybackBurner's own keeper, read from it, so replacing that keeper
/// replaces this one too.
///
/// The USDG can only go two places: to the BuybackBurner, when the keeper asks, or back to the owner. A compromised
/// keeper can at worst burn the float early, and only up to `burnBps` of a total it claims. Anyone can refill the pot by
/// sending USDG to it.
contract MirrorBurnPot {
    using SafeTransfer for address;

    address public immutable usdg;
    address public immutable buybackBurner;
    /// The share of payments elsewhere that's burned, in basis points (500 = 5%, as on Robinhood Chain).
    uint256 public immutable burnBps;

    address public owner;
    address public pendingOwner;
    /// Running total of the payments elsewhere that the sends so far are for.
    uint256 public paidElsewhere;
    /// Everything sent to the BuybackBurner so far.
    uint256 public mirrored;

    event Mirrored(uint256 usdgSent, uint256 paidElsewhere, uint256 mirroredTotal);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnerProposed(address indexed owner);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error NotPendingOwner();
    error NotKeeper();
    error ZeroOwner();
    error ZeroAmount();
    error BadBps();
    error TotalWentDown(uint256 was, uint256 given);
    error MoreThanOwed(uint256 owed, uint256 asked);

    constructor(address buybackBurner_, uint256 burnBps_, address owner_) {
        if (owner_ == address(0)) revert ZeroOwner();
        if (burnBps_ == 0 || burnBps_ > 10_000) revert BadBps();
        buybackBurner = buybackBurner_;
        usdg = IBuybackBurner(buybackBurner_).usdg();
        burnBps = burnBps_;
        owner = owner_;
        emit OwnerSet(owner_);
    }

    function keeper() public view returns (address) {
        return IBuybackBurner(buybackBurner).keeper();
    }

    /// What may still be sent for a running total of `paidElsewhere_`.
    function owedFor(uint256 paidElsewhere_) public view returns (uint256) {
        uint256 due = (paidElsewhere_ * burnBps) / 10_000;
        return due > mirrored ? due - mirrored : 0;
    }

    /// Sends `amount` of USDG to the BuybackBurner for payments elsewhere that now total `paidElsewhere_`.
    function mirror(uint256 amount, uint256 paidElsewhere_) external {
        if (msg.sender != keeper()) revert NotKeeper();
        if (amount == 0) revert ZeroAmount();
        if (paidElsewhere_ < paidElsewhere) revert TotalWentDown(paidElsewhere, paidElsewhere_);
        uint256 owed = owedFor(paidElsewhere_);
        if (amount > owed) revert MoreThanOwed(owed, amount);
        paidElsewhere = paidElsewhere_;
        mirrored += amount;
        usdg.safeTransfer(buybackBurner, amount);
        emit Mirrored(amount, paidElsewhere_, mirrored);
    }

    /// Takes USDG back out of the pot, to the owner.
    function withdraw(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        usdg.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
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
}
