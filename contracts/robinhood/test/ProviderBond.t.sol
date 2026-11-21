// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProviderBond} from "../src/ProviderBond.sol";

contract Tok is ERC20 {
    constructor() ERC20("AUTONOMO", "AUTONOMO") { _mint(msg.sender, 1_000_000_000e18); }
}

contract ProviderBondTest is Test {
    Tok tok;
    ProviderBond bond;
    address owner = address(0xA11CE);
    address slasher = address(0x51A5);
    address prov = address(0xBEEF);
    address prov2 = address(0xCAFE);
    address payer = address(0xFA7E);
    address rando = address(0xBAD);
    address constant BURN = 0x000000000000000000000000000000000000dEaD;

    uint128 constant MIN = 100_000e18;
    uint64 constant COOLDOWN = 14 days;
    uint64 constant WINDOW = 3 days;

    function setUp() public {
        tok = new Tok();
        bond = new ProviderBond(IERC20(address(tok)), owner, slasher, MIN, COOLDOWN, WINDOW, 2_000, 5_000);
        tok.transfer(prov, 1_000_000e18);
        tok.transfer(prov2, 1_000_000e18);
        vm.prank(prov); tok.approve(address(bond), type(uint256).max);
        vm.prank(prov2); tok.approve(address(bond), type(uint256).max);
    }

    function _dep(address p, uint256 a) internal { vm.prank(p); bond.deposit(a); }

    function test_deposit_and_bonded() public {
        assertFalse(bond.isBonded(prov));
        _dep(prov, 50_000e18);
        assertFalse(bond.isBonded(prov));
        _dep(prov, 50_000e18);
        assertTrue(bond.isBonded(prov));
        assertEq(bond.activeBond(prov), 100_000e18);
        assertEq(bond.totalBonded(), 100_000e18);
        assertEq(tok.balanceOf(address(bond)), 100_000e18);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(prov); vm.expectRevert(ProviderBond.ZeroAmount.selector); bond.deposit(0);
    }

    function test_withdraw_flow() public {
        _dep(prov, 200_000e18);
        vm.prank(prov); bond.requestWithdraw(150_000e18);
        assertEq(bond.activeBond(prov), 50_000e18);       // stops counting right away
        assertFalse(bond.isBonded(prov));
        vm.prank(prov); vm.expectRevert(ProviderBond.NotReady.selector); bond.withdraw();
        vm.warp(block.timestamp + COOLDOWN - 1);
        vm.prank(prov); vm.expectRevert(ProviderBond.NotReady.selector); bond.withdraw();
        vm.warp(block.timestamp + 1);
        uint256 before = tok.balanceOf(prov);
        vm.prank(prov); bond.withdraw();
        assertEq(tok.balanceOf(prov) - before, 150_000e18);
        assertEq(bond.totalBonded(), 50_000e18);
        vm.prank(prov); vm.expectRevert(ProviderBond.NothingPending.selector); bond.withdraw();
    }

    function test_request_more_than_bond_reverts() public {
        _dep(prov, 100_000e18);
        vm.prank(prov); vm.expectRevert(ProviderBond.AmountTooHigh.selector); bond.requestWithdraw(100_000e18 + 1);
    }

    function test_cancel_withdraw() public {
        _dep(prov, 100_000e18);
        vm.prank(prov); bond.requestWithdraw(100_000e18);
        vm.prank(prov); bond.cancelWithdraw();
        assertTrue(bond.isBonded(prov));
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(prov); vm.expectRevert(ProviderBond.NothingPending.selector); bond.withdraw();
    }

    function test_cannot_withdraw_someone_elses_bond() public {
        _dep(prov, 100_000e18);
        vm.prank(rando); vm.expectRevert(ProviderBond.AmountTooHigh.selector); bond.requestWithdraw(1);
    }

    function test_slash_split_refund_and_burn() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "evidence");
        vm.expectRevert(ProviderBond.NotReady.selector); bond.executeSlash(id);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(rando); bond.executeSlash(id);
        assertEq(tok.balanceOf(payer), 10_000e18);
        assertEq(tok.balanceOf(BURN), 10_000e18);
        assertEq(bond.activeBond(prov), 80_000e18);
        assertEq(bond.totalBonded(), 80_000e18);
        assertEq(tok.balanceOf(address(bond)), 80_000e18);
        assertEq(bond.openSlashOf(prov), 0);
        vm.expectRevert(ProviderBond.NoSlash.selector); bond.executeSlash(id);   // cannot run twice
    }

    function test_slash_no_payer_burns_all() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 10_000e18, address(0), "x");
        vm.warp(block.timestamp + WINDOW);
        bond.executeSlash(id);
        assertEq(tok.balanceOf(BURN), 10_000e18);
    }

    function test_slash_cap_and_one_at_a_time() public {
        _dep(prov, 100_000e18);
        vm.startPrank(slasher);
        vm.expectRevert(ProviderBond.AmountTooHigh.selector); bond.proposeSlash(prov, 20_000e18 + 1, payer, "x");
        bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.expectRevert(ProviderBond.SlashOpen.selector); bond.proposeSlash(prov, 1e18, payer, "x");
        vm.stopPrank();
    }

    function test_only_slasher_proposes() public {
        _dep(prov, 100_000e18);
        vm.prank(rando); vm.expectRevert(ProviderBond.NotSlasher.selector); bond.proposeSlash(prov, 1e18, rando, "x");
        vm.prank(owner); vm.expectRevert(ProviderBond.NotSlasher.selector); bond.proposeSlash(prov, 1e18, owner, "x");
    }

    function test_owner_can_cancel_slash_rando_cannot() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.prank(rando); vm.expectRevert(ProviderBond.NotAllowed.selector); bond.cancelSlash(id);
        vm.prank(prov); vm.expectRevert(ProviderBond.NotAllowed.selector); bond.cancelSlash(id);
        vm.prank(owner); bond.cancelSlash(id);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(ProviderBond.NoSlash.selector); bond.executeSlash(id);
        assertEq(bond.activeBond(prov), 100_000e18);
    }

    function test_withdraw_blocked_while_slash_open_then_free() public {
        _dep(prov, 100_000e18);
        vm.prank(prov); bond.requestWithdraw(100_000e18);
        vm.warp(block.timestamp + COOLDOWN - 1 days);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x"); // still slashable during cooldown
        vm.warp(block.timestamp + 1 days);
        vm.prank(prov); vm.expectRevert(ProviderBond.SlashOpen.selector); bond.withdraw();
        vm.warp(block.timestamp + 2 days);
        bond.executeSlash(id);
        uint256 before = tok.balanceOf(prov);
        vm.prank(prov); bond.withdraw();
        assertEq(tok.balanceOf(prov) - before, 80_000e18);   // pending was trimmed to what is left
        assertEq(bond.totalBonded(), 0);
        assertEq(tok.balanceOf(address(bond)), 0);
    }

    function test_matured_withdrawal_is_out_of_reach() public {
        _dep(prov, 100_000e18);
        vm.prank(prov); bond.requestWithdraw(100_000e18);
        vm.warp(block.timestamp + COOLDOWN);
        assertEq(bond.slashable(prov), 0);
        vm.prank(slasher); vm.expectRevert(ProviderBond.AmountTooHigh.selector); bond.proposeSlash(prov, 1, payer, "x");
        vm.prank(prov); bond.withdraw();
        assertEq(tok.balanceOf(prov), 1_000_000e18);
    }

    function test_expired_slash_cannot_run_and_anyone_can_clear() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.warp(block.timestamp + WINDOW + 7 days + 1);
        vm.expectRevert(ProviderBond.NotReady.selector); bond.executeSlash(id);
        vm.prank(rando); bond.cancelSlash(id);
        assertEq(bond.openSlashOf(prov), 0);
        assertEq(bond.activeBond(prov), 100_000e18);
    }

    function test_slash_does_not_touch_other_providers() public {
        _dep(prov, 100_000e18); _dep(prov2, 300_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.warp(block.timestamp + WINDOW);
        bond.executeSlash(id);
        assertEq(bond.activeBond(prov2), 300_000e18);
        assertEq(tok.balanceOf(address(bond)), 380_000e18);
    }

    function test_params_bounds_and_access() public {
        vm.prank(rando); vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        bond.setParams(MIN, COOLDOWN, WINDOW, 2_000, 5_000);
        vm.startPrank(owner);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(MIN, 6 days, WINDOW, 2_000, 5_000);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(MIN, 22 days, WINDOW, 2_000, 5_000);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(MIN, COOLDOWN, 7 days, 2_000, 5_000);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(MIN, COOLDOWN, WINDOW, 5_001, 5_000);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(MIN, COOLDOWN, WINDOW, 2_000, 5_001);
        vm.expectRevert(ProviderBond.BadParams.selector); bond.setParams(0, COOLDOWN, WINDOW, 2_000, 5_000);
        bond.setParams(200_000e18, 21 days, 2 days, 1_000, 0);
        vm.expectRevert(ProviderBond.RenounceDisabled.selector); bond.renounceOwnership();
        vm.expectRevert(ProviderBond.ZeroAddress.selector); bond.setSlasher(address(0));
        vm.stopPrank();
        vm.prank(rando); vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
        bond.setSlasher(rando);
    }

    function test_ownership_two_step() public {
        vm.prank(owner); bond.transferOwnership(rando);
        assertEq(bond.owner(), owner);
        vm.prank(rando); bond.acceptOwnership();
        assertEq(bond.owner(), rando);
    }

    /// A slash opened after a partial withdrawal matured must not block it, and only hits the active part.
    function test_partial_matured_withdrawal_cannot_be_held_hostage() public {
        _dep(prov, 200_000e18);
        vm.prank(prov); bond.requestWithdraw(100_000e18);
        vm.warp(block.timestamp + COOLDOWN);
        assertEq(bond.slashable(prov), 100_000e18);
        vm.startPrank(slasher);
        vm.expectRevert(ProviderBond.AmountTooHigh.selector); bond.proposeSlash(prov, 20_000e18 + 1, payer, "x");
        uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.stopPrank();
        uint256 before = tok.balanceOf(prov);
        vm.prank(prov); bond.withdraw();                       // not blocked
        assertEq(tok.balanceOf(prov) - before, 100_000e18);
        vm.warp(block.timestamp + WINDOW);
        bond.executeSlash(id);                                 // the slash still runs on what is left
        assertEq(bond.activeBond(prov), 80_000e18);
        assertEq(tok.balanceOf(address(bond)), 80_000e18);
    }

    /// The core promise: after one slash, a provider who asks to leave gets the rest out before a second slash.
    function test_at_most_one_slash_before_exit() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.prank(prov); bond.requestWithdraw(100_000e18);         // provider reacts
        vm.warp(block.timestamp + WINDOW);
        bond.executeSlash(id);
        vm.prank(slasher); vm.expectRevert(ProviderBond.TooSoon.selector); bond.proposeSlash(prov, 1e18, payer, "y");
        vm.warp(block.timestamp + COOLDOWN);                      // cooldown over, still inside the 30 days
        vm.prank(slasher); vm.expectRevert(ProviderBond.TooSoon.selector); bond.proposeSlash(prov, 1e18, payer, "y");
        uint256 before = tok.balanceOf(prov);
        vm.prank(prov); bond.withdraw();
        assertEq(tok.balanceOf(prov) - before, 80_000e18);        // lost one slash, nothing more
        assertEq(tok.balanceOf(address(bond)), 0);
    }

    /// Worst delay a dishonest slasher can cause: a slash opened one second before the cooldown ends and
    /// never executed blocks the withdrawal until it expires (window + 7 days), then nothing can block it.
    function test_withdrawal_can_be_delayed_ten_days_at_most() public {
        _dep(prov, 200_000e18);
        vm.prank(prov); bond.requestWithdraw(100_000e18);
        uint256 ready = block.timestamp + COOLDOWN;
        vm.warp(ready - 1);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 40_000e18, payer, "x");
        vm.warp(ready + WINDOW + 7 days - 1);
        vm.prank(prov); vm.expectRevert(ProviderBond.SlashOpen.selector); bond.withdraw();
        vm.prank(prov); vm.expectRevert(ProviderBond.NotAllowed.selector); bond.cancelSlash(id);
        vm.warp(ready + WINDOW + 7 days);                       // expired
        vm.prank(prov); bond.cancelSlash(id);                   // the provider clears it himself
        vm.prank(slasher); bond.proposeSlash(prov, 20_000e18, payer, "again");   // only on the active half
        uint256 before = tok.balanceOf(prov);
        vm.prank(prov); bond.withdraw();                        // and it cannot block the withdrawal
        assertEq(tok.balanceOf(prov) - before, 100_000e18);
    }

    function test_cancelled_slash_does_not_start_the_interval() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.prank(slasher); bond.cancelSlash(id);
        vm.prank(slasher); bond.proposeSlash(prov, 10_000e18, payer, "fixed");
    }

    function test_repeated_slashes_each_capped_on_what_is_left() public {
        _dep(prov, 100_000e18);
        uint256 left = 100_000e18;
        for (uint256 i; i < 3; i++) {
            uint256 cap = left * 2_000 / 10_000;
            vm.prank(slasher); uint256 id = bond.proposeSlash(prov, cap, address(0), "x");
            vm.warp(block.timestamp + WINDOW);
            bond.executeSlash(id);
            left -= cap;
            vm.prank(slasher); vm.expectRevert(ProviderBond.TooSoon.selector); bond.proposeSlash(prov, 1, address(0), "x");
            vm.warp(block.timestamp + 30 days);
        }
        assertEq(bond.activeBond(prov), 51_200e18);
        assertEq(tok.balanceOf(address(bond)), 51_200e18);
    }

    function test_refund_share_is_fixed_at_proposal() public {
        _dep(prov, 100_000e18);
        vm.prank(slasher); uint256 id = bond.proposeSlash(prov, 20_000e18, payer, "x");
        vm.prank(owner); bond.setParams(MIN, COOLDOWN, WINDOW, 2_000, 0);   // changed after the proposal
        vm.warp(block.timestamp + WINDOW);
        bond.executeSlash(id);
        assertEq(tok.balanceOf(payer), 10_000e18);
    }

    /// Whatever the order of actions, the contract always holds exactly what the bonds say.
    function testFuzz_accounting(uint96 d1, uint96 d2, uint96 w, uint96 sl, bool exec, bool viaPayer) public {
        d1 = uint96(bound(d1, 1e18, 500_000e18)); d2 = uint96(bound(d2, 1e18, 500_000e18));
        _dep(prov, d1); _dep(prov2, d2);
        w = uint96(bound(w, 1, d1));
        vm.prank(prov); bond.requestWithdraw(w);
        uint256 cap = (bond.slashable(prov) * 2_000) / 10_000;
        if (cap > 0) {
            sl = uint96(bound(sl, 1, cap));
            vm.prank(slasher); uint256 id = bond.proposeSlash(prov, sl, viaPayer ? payer : address(0), "x");
            vm.warp(block.timestamp + WINDOW);
            if (exec) bond.executeSlash(id); else { vm.prank(owner); bond.cancelSlash(id); }
        }
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(prov); bond.withdraw();
        (uint128 a1,,) = bond.bonds(prov); (uint128 a2,,) = bond.bonds(prov2);
        assertEq(bond.totalBonded(), uint256(a1) + a2);
        assertEq(tok.balanceOf(address(bond)), bond.totalBonded());
        assertEq(tok.balanceOf(prov) + a1 + tok.balanceOf(payer) + tok.balanceOf(BURN), 1_000_000e18);
        assertGe(tok.balanceOf(BURN), tok.balanceOf(payer));   // at least half of every slash is burned
    }
}
