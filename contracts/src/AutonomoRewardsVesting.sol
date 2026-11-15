// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// Holds the $AUTONOMO set aside for rewards and releases it in a straight line between the start and the end.
///
/// It is OpenZeppelin's VestingWallet (v5.1.0), unchanged in how it vests, with two guards on who receives:
///   - Ownership can't be given up. Released tokens go to the owner, so with no owner they would be stuck for good.
///   - Handing over to a new owner takes two steps: the new owner has to accept, so a mistyped address can't take it.
///
/// Anyone can call release(token); it only ever pays the owner (the Rewards Safe). Nobody, the owner included, can
/// take tokens out ahead of the schedule. Tokens sent in after the start vest on the same schedule, so part of
/// them is releasable at once: refills belong in the Rewards Safe, never here.
contract AutonomoRewardsVesting is VestingWallet, Ownable2Step {
    error RenounceDisabled();

    constructor(address beneficiary, uint64 startTimestamp, uint64 durationSeconds)
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
    {}

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) onlyOwner {
        super.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) {
        super._transferOwnership(newOwner);
    }
}
