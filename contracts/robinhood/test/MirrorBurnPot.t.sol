// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MirrorBurnPot} from "../src/MirrorBurnPot.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {IERC20} from "shared/Interfaces.sol";
import {Robinhood} from "../script/Robinhood.sol";

contract MockUsdg {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockBurner {
    address public usdg;
    address public keeper;

    constructor(address usdg_, address keeper_) {
        usdg = usdg_;
        keeper = keeper_;
    }

    function setKeeper(address keeper_) external {
        keeper = keeper_;
    }
}

contract MirrorBurnPotTest is Test {
    address constant OWNER = address(0x0A11CE);
    address constant KEEPER = address(0x4EE9);

    MockUsdg usdg;
    MockBurner burner;
    MirrorBurnPot pot;

    function setUp() public {
        usdg = new MockUsdg();
        burner = new MockBurner(address(usdg), KEEPER);
        pot = new MirrorBurnPot(address(burner), 500, OWNER);
        usdg.mint(address(pot), 100e6); // 100 USDG float
    }

    function test_readsTokenAndKeeperFromTheBurner() public view {
        assertEq(pot.usdg(), address(usdg));
        assertEq(pot.keeper(), KEEPER);
        assertEq(pot.owner(), OWNER);
    }

    function test_mirrorsFivePercent() public {
        // $20 of Base payments: $1 may be burned.
        vm.prank(KEEPER);
        pot.mirror(1e6, 20e6);
        assertEq(usdg.balanceOf(address(burner)), 1e6);
        assertEq(pot.mirrored(), 1e6);
        assertEq(pot.paidElsewhere(), 20e6);
        assertEq(pot.owedFor(20e6), 0);
    }

    function test_cannotSendMoreThanOwed() public {
        vm.prank(KEEPER);
        vm.expectRevert(abi.encodeWithSelector(MirrorBurnPot.MoreThanOwed.selector, 1e6, 1e6 + 1));
        pot.mirror(1e6 + 1, 20e6);
    }

    function test_partialSendsCarryOver() public {
        vm.startPrank(KEEPER);
        pot.mirror(4e5, 20e6); // pot was short: 0.4 of the 1 owed
        assertEq(pot.owedFor(20e6), 6e5);
        pot.mirror(6e5 + 5e5, 30e6); // the rest, plus 5% of the next $10
        vm.stopPrank();
        assertEq(pot.mirrored(), 15e5);
        assertEq(usdg.balanceOf(address(burner)), 15e5);
    }

    function test_totalCannotGoDown() public {
        vm.startPrank(KEEPER);
        pot.mirror(1e6, 20e6);
        vm.expectRevert(abi.encodeWithSelector(MirrorBurnPot.TotalWentDown.selector, 20e6, 19e6));
        pot.mirror(1, 19e6);
        vm.stopPrank();
    }

    function test_onlyTheKeeperMirrors() public {
        vm.expectRevert(MirrorBurnPot.NotKeeper.selector);
        pot.mirror(1e6, 20e6);
        vm.prank(OWNER);
        vm.expectRevert(MirrorBurnPot.NotKeeper.selector);
        pot.mirror(1e6, 20e6);
    }

    function test_followsTheBurnersKeeper() public {
        address next = address(0xBEEF);
        burner.setKeeper(next);
        vm.prank(KEEPER);
        vm.expectRevert(MirrorBurnPot.NotKeeper.selector);
        pot.mirror(1e6, 20e6);
        vm.prank(next);
        pot.mirror(1e6, 20e6);
    }

    function test_rejectsZero() public {
        vm.prank(KEEPER);
        vm.expectRevert(MirrorBurnPot.ZeroAmount.selector);
        pot.mirror(0, 20e6);
    }

    function test_onlyOwnerWithdraws_andOnlyToItself() public {
        vm.prank(KEEPER);
        vm.expectRevert(MirrorBurnPot.NotOwner.selector);
        pot.withdraw(1e6);
        vm.prank(OWNER);
        pot.withdraw(30e6);
        assertEq(usdg.balanceOf(OWNER), 30e6);
        assertEq(usdg.balanceOf(address(pot)), 70e6);
    }

    function test_ownerHandoverNeedsAcceptance() public {
        address next = address(0xB0B);
        vm.prank(OWNER);
        pot.setOwner(next);
        assertEq(pot.owner(), OWNER);
        vm.expectRevert(MirrorBurnPot.NotPendingOwner.selector);
        pot.acceptOwner();
        vm.prank(next);
        pot.acceptOwner();
        assertEq(pot.owner(), next);
        assertEq(pot.pendingOwner(), address(0));
    }

    function test_constructorChecks() public {
        vm.expectRevert(MirrorBurnPot.ZeroOwner.selector);
        new MirrorBurnPot(address(burner), 500, address(0));
        vm.expectRevert(MirrorBurnPot.BadBps.selector);
        new MirrorBurnPot(address(burner), 0, OWNER);
        vm.expectRevert(MirrorBurnPot.BadBps.selector);
        new MirrorBurnPot(address(burner), 10_001, OWNER);
    }

    function testFuzz_neverMoreThanTheShare(uint64 a, uint64 b, uint64 sendA, uint64 sendB) public {
        uint256 first = a;
        uint256 second = first + b;
        usdg.mint(address(pot), type(uint128).max);
        vm.startPrank(KEEPER);
        uint256 s1 = bound(sendA, 0, pot.owedFor(first));
        if (s1 > 0) pot.mirror(s1, first);
        uint256 s2 = bound(sendB, 0, pot.owedFor(second));
        if (s2 > 0) pot.mirror(s2, second);
        vm.stopPrank();
        assertLe(pot.mirrored(), (second * 500) / 10_000);
    }
}

// Against the BuybackBurner already deployed on Robinhood Chain. Skipped unless ROBINHOOD_RPC_URL is set.
contract MirrorBurnPotForkTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant BUYBACK = 0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464;
    address constant OWNER = address(0x0A11CE);
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
    }

    function test_potToBuybackToBurn() public {
        if (!forked) return;
        BuybackBurner buyback = BuybackBurner(BUYBACK);
        MirrorBurnPot pot = new MirrorBurnPot(BUYBACK, 500, OWNER);
        assertEq(pot.usdg(), Robinhood.USDG);
        address keeper = buyback.keeper();
        assertEq(pot.keeper(), keeper);

        deal(Robinhood.USDG, address(pot), 10e6);
        uint256 heldBefore = IERC20(Robinhood.USDG).balanceOf(BUYBACK);
        uint256 deadBefore = IERC20(Robinhood.AUTONOMO).balanceOf(DEAD);

        vm.startPrank(keeper);
        pot.mirror(1e6, 20e6); // $20 of Base payments
        uint256 burned = buyback.buyAndBurn(heldBefore + 1e6, 1);
        vm.stopPrank();

        assertEq(IERC20(Robinhood.USDG).balanceOf(address(pot)), 9e6);
        assertGt(burned, 0);
        assertEq(IERC20(Robinhood.AUTONOMO).balanceOf(DEAD) - deadBefore, burned);
        emit log_named_decimal_uint("AUTONOMO burned for 1 USDG mirrored", burned, 18);
    }
}
