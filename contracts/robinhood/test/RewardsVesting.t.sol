// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AutonomoRewardsVesting} from "../src/AutonomoRewardsVesting.sol";
import {Robinhood} from "../script/Robinhood.sol";

contract MockToken is ERC20 {
    constructor(address to, uint256 amount) ERC20("Mock", "MOCK") {
        _mint(to, amount);
    }
}

contract RewardsVestingTest is Test {
    address constant SAFE = address(0x5AFE01); // stands in for the Rewards Safe
    address constant NEW_SAFE = address(0x5AFE02);
    address constant FUNDER = address(0xF00D);
    address constant ANYONE = address(0xA11E);

    uint64 constant START = 1796083200; // Dec 1, 2026 00:00 UTC
    uint64 constant DURATION = 180 days;
    uint256 constant TOTAL = 10_000_000e18;

    MockToken token;
    AutonomoRewardsVesting vesting;

    function setUp() public {
        vm.warp(START - 10 days);
        token = new MockToken(FUNDER, TOTAL * 2);
        vesting = new AutonomoRewardsVesting(SAFE, START, DURATION);
        vm.prank(FUNDER);
        token.transfer(address(vesting), TOTAL);
    }

    function release() internal {
        vm.prank(ANYONE);
        vesting.release(address(token));
    }

    function test_readsBackWhatItWasDeployedWith() public view {
        assertEq(vesting.owner(), SAFE);
        assertEq(vesting.start(), START);
        assertEq(vesting.duration(), DURATION);
        assertEq(vesting.end(), 1811635200); // May 30, 2027 00:00 UTC
    }

    function test_nothingBeforeTheStart() public {
        assertEq(vesting.releasable(address(token)), 0);
        release();
        assertEq(token.balanceOf(SAFE), 0);
        assertEq(token.balanceOf(address(vesting)), TOTAL);
    }

    function test_releasesInAStraightLineToTheSafeWhoeverCalls() public {
        vm.warp(START + 30 days);
        uint256 due = TOTAL * 30 / 180;
        assertEq(vesting.releasable(address(token)), due);
        release();
        assertEq(token.balanceOf(SAFE), due);
        assertEq(token.balanceOf(ANYONE), 0);

        // Calling again in the same moment sends nothing more.
        release();
        assertEq(token.balanceOf(SAFE), due);
    }

    function test_everythingIsOutAtTheEnd() public {
        vm.warp(START + DURATION);
        release();
        assertEq(token.balanceOf(SAFE), TOTAL);
        assertEq(token.balanceOf(address(vesting)), 0);

        vm.warp(START + DURATION + 400 days);
        assertEq(vesting.releasable(address(token)), 0);
    }

    function testFuzz_neverMoreThanTheSchedule(uint32 elapsed) public {
        vm.warp(uint256(START) + elapsed);
        release();
        uint256 due = elapsed >= DURATION ? TOTAL : TOTAL * elapsed / DURATION;
        assertEq(token.balanceOf(SAFE), due);
        assertEq(token.balanceOf(SAFE) + token.balanceOf(address(vesting)), TOTAL);
    }

    function test_theOwnerCannotTakeTokensEarly() public {
        // The Safe has no call that moves tokens beyond release(), which pays only what has vested.
        vm.warp(START + 1 days);
        vm.prank(SAFE);
        vesting.release(address(token));
        assertEq(token.balanceOf(SAFE), TOTAL / 180);
    }

    function test_ownershipCannotBeGivenUp() public {
        vm.prank(SAFE);
        vm.expectRevert(AutonomoRewardsVesting.RenounceDisabled.selector);
        vesting.renounceOwnership();

        vm.prank(ANYONE);
        vm.expectRevert(AutonomoRewardsVesting.RenounceDisabled.selector);
        vesting.renounceOwnership();
        assertEq(vesting.owner(), SAFE);
    }

    function test_onlyTheSafeCanStartAHandover() public {
        vm.prank(ANYONE);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ANYONE));
        vesting.transferOwnership(ANYONE);
    }

    function test_aHandoverNeedsTheNewOwnerToAccept() public {
        vm.prank(SAFE);
        vesting.transferOwnership(NEW_SAFE);
        assertEq(vesting.owner(), SAFE);
        assertEq(vesting.pendingOwner(), NEW_SAFE);

        vm.prank(ANYONE);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ANYONE));
        vesting.acceptOwnership();

        // Until it is accepted, releases still go to the first Safe.
        vm.warp(START + 60 days);
        release();
        assertEq(token.balanceOf(SAFE), TOTAL * 60 / 180);
        assertEq(token.balanceOf(NEW_SAFE), 0);

        vm.prank(NEW_SAFE);
        vesting.acceptOwnership();
        assertEq(vesting.owner(), NEW_SAFE);

        vm.warp(START + DURATION);
        release();
        assertEq(token.balanceOf(NEW_SAFE), TOTAL - TOTAL * 60 / 180);
    }

    /// Why refills go to the Rewards Safe and never here: tokens sent in late vest on the same schedule.
    function test_tokensSentInLateArePartlyReleasableAtOnce() public {
        vm.warp(START + 90 days);
        release();
        vm.prank(FUNDER);
        token.transfer(address(vesting), 1_000_000e18);
        assertEq(vesting.releasable(address(token)), 500_000e18);
    }
}

// Runs against the real $AUTONOMO on Robinhood Chain. Skipped unless ROBINHOOD_RPC_URL is set.
contract RewardsVestingForkTest is Test {
    address constant SAFE = address(0x5AFE01);
    address constant FUNDER = address(0xF00D);
    uint256 constant TOTAL = 10_000_000e18;

    function test_realTokenArrivesInFullAndVests() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        IERC20 autonomo = IERC20(Robinhood.AUTONOMO);

        uint64 start = uint64(block.timestamp + 10 days);
        AutonomoRewardsVesting vesting = new AutonomoRewardsVesting(SAFE, start, 180 days);

        // A plain wallet gets tokens from the pool, on this local copy only, and sends them as the real transfers will.
        vm.prank(Robinhood.POOL_MANAGER);
        autonomo.transfer(FUNDER, TOTAL);

        vm.prank(FUNDER);
        autonomo.transfer(address(vesting), 1_000e18);
        assertEq(autonomo.balanceOf(address(vesting)), 1_000e18, "a plain transfer is taxed");
        vm.prank(FUNDER);
        autonomo.transfer(address(vesting), TOTAL - 1_000e18);
        assertEq(autonomo.balanceOf(address(vesting)), TOTAL);
        assertEq(vesting.releasable(address(autonomo)), 0);

        vm.warp(start + 30 days);
        vesting.release(address(autonomo));
        assertEq(autonomo.balanceOf(SAFE), TOTAL * 30 / 180);

        vm.warp(start + 180 days);
        vesting.release(address(autonomo));
        assertEq(autonomo.balanceOf(SAFE), TOTAL);
        assertEq(autonomo.balanceOf(address(vesting)), 0);
    }
}
