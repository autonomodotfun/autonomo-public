// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProviderBond} from "../src/ProviderBond.sol";
import {Robinhood} from "../script/Robinhood.sol";

// Runs the bond against the real $AUTONOMO on Robinhood Chain, with the proposed settings.
// Skipped unless ROBINHOOD_RPC_URL is set.
contract ProviderBondForkTest is Test {
    address constant OWNER = address(0x5AFE01);
    address constant SLASHER = address(0x51A5);
    address constant PROVIDER = address(0xBEEF);
    address constant PAYER = address(0xFA7E);
    address constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint128 constant MIN_BOND = 460_000e18; // $100 at $0.00022 a token

    function test_realTokenBondSlashAndExit() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        IERC20 autonomo = IERC20(Robinhood.AUTONOMO);
        ProviderBond bond = new ProviderBond(autonomo, OWNER, SLASHER, MIN_BOND, 14 days, 3 days, 2_000, 5_000);

        // A plain wallet gets tokens from the pool, on this local copy only.
        vm.prank(Robinhood.POOL_MANAGER);
        autonomo.transfer(PROVIDER, MIN_BOND);

        // Deposit: the approval and the pull both work, and every token arrives.
        vm.startPrank(PROVIDER);
        autonomo.approve(address(bond), MIN_BOND);
        bond.deposit(MIN_BOND);
        vm.stopPrank();
        assertEq(autonomo.balanceOf(address(bond)), MIN_BOND, "the deposit is taxed");
        assertEq(bond.activeBond(PROVIDER), MIN_BOND);
        assertTrue(bond.isBonded(PROVIDER));

        // One slash at the cap: 20% of the bond, half to the payer, half to the dead address.
        uint256 slashed = MIN_BOND * 2_000 / 10_000;
        uint256 burnedBefore = autonomo.balanceOf(BURN);
        vm.prank(SLASHER);
        uint256 id = bond.proposeSlash(PROVIDER, slashed, PAYER, keccak256("evidence"));
        vm.warp(block.timestamp + 3 days);
        bond.executeSlash(id);
        assertEq(autonomo.balanceOf(PAYER), slashed / 2, "the refund is taxed");
        assertEq(autonomo.balanceOf(BURN) - burnedBefore, slashed / 2, "the burn is taxed");
        assertFalse(bond.isBonded(PROVIDER));

        // The provider leaves with everything that is left, before a second slash is possible.
        uint256 left = MIN_BOND - slashed;
        vm.prank(PROVIDER);
        bond.requestWithdraw(left);
        vm.warp(block.timestamp + 14 days);
        vm.prank(SLASHER);
        vm.expectRevert(ProviderBond.TooSoon.selector);
        bond.proposeSlash(PROVIDER, 1, PAYER, bytes32(0));
        vm.prank(PROVIDER);
        bond.withdraw();
        assertEq(autonomo.balanceOf(PROVIDER), left, "the withdrawal is taxed");
        assertEq(autonomo.balanceOf(address(bond)), 0);
        assertEq(bond.totalBonded(), 0);
    }
}
