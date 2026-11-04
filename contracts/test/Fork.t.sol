// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {BurnSplitter, BurnSplitterFactory} from "../src/BurnSplitter.sol";
import {IERC20, IPoolManager, PoolKey} from "../src/Interfaces.sol";
import {Robinhood} from "../script/Robinhood.sol";

// Runs against Robinhood Chain's real tokens and pools. Skipped unless ROBINHOOD_RPC_URL is set.
contract ForkTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant CREATOR = address(0xC0FFEE);
    address constant OWNER = address(0x0A11CE);
    address constant KEEPER = address(0x4EE9);

    BuybackBurner buyback;
    BurnSplitterFactory factory;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        buyback = new BuybackBurner(
            IPoolManager(Robinhood.POOL_MANAGER),
            Robinhood.USDG,
            Robinhood.AUTONOMO,
            Robinhood.usdgPool(),
            Robinhood.autonomoPool(),
            OWNER,
            KEEPER
        );
        factory = new BurnSplitterFactory(Robinhood.AUTONOMO, Robinhood.USDG, address(buyback));
    }

    function test_buysAndBurnsWithUsdg() public {
        if (!forked) return;
        deal(Robinhood.USDG, address(buyback), 5e6); // 5 USDG
        uint256 deadBefore = IERC20(Robinhood.AUTONOMO).balanceOf(DEAD);

        vm.prank(KEEPER);
        uint256 burned = buyback.buyAndBurn(5e6, 1);

        assertGt(burned, 0);
        assertEq(IERC20(Robinhood.AUTONOMO).balanceOf(DEAD) - deadBefore, burned);
        assertEq(IERC20(Robinhood.USDG).balanceOf(address(buyback)), 0);
        assertEq(address(buyback).balance, 0);
        emit log_named_decimal_uint("AUTONOMO burned for 5 USDG", burned, 18);
    }

    function test_respectsMinimumOut() public {
        if (!forked) return;
        deal(Robinhood.USDG, address(buyback), 1e6);
        vm.prank(KEEPER);
        vm.expectRevert();
        buyback.buyAndBurn(1e6, type(uint256).max);
    }

    function test_onlyKeeperCanBuy() public {
        if (!forked) return;
        deal(Robinhood.USDG, address(buyback), 1e6);
        vm.expectRevert(BuybackBurner.NotKeeper.selector);
        buyback.buyAndBurn(1e6, 1);
    }

    function test_ownerCanOnlyChangeTheKeeper() public {
        if (!forked) return;
        vm.expectRevert(BuybackBurner.NotOwner.selector);
        buyback.setKeeper(address(this));
        vm.prank(OWNER);
        buyback.setKeeper(address(this));
        assertEq(buyback.keeper(), address(this));
    }

    function test_realTokensFlowThroughSplitterToBurn() public {
        if (!forked) return;
        address splitter = factory.splitterOf(CREATOR);
        deal(Robinhood.AUTONOMO, splitter, 100e18);
        deal(Robinhood.USDG, splitter, 10_000);
        uint256 deadBefore = IERC20(Robinhood.AUTONOMO).balanceOf(DEAD);

        address[] memory tokens = new address[](2);
        tokens[0] = Robinhood.AUTONOMO;
        tokens[1] = Robinhood.USDG;
        factory.flush(CREATOR, tokens);

        assertEq(IERC20(Robinhood.AUTONOMO).balanceOf(DEAD) - deadBefore, 5e18);
        assertEq(IERC20(Robinhood.AUTONOMO).balanceOf(CREATOR), 95e18);
        assertEq(IERC20(Robinhood.USDG).balanceOf(CREATOR), 9_500);
        assertEq(IERC20(Robinhood.USDG).balanceOf(address(buyback)), 500);
    }

    function test_burnHeldSendsStrayTokensToDead() public {
        if (!forked) return;
        deal(Robinhood.AUTONOMO, address(buyback), 7e18);
        uint256 deadBefore = IERC20(Robinhood.AUTONOMO).balanceOf(DEAD);
        buyback.burnHeld();
        assertEq(IERC20(Robinhood.AUTONOMO).balanceOf(DEAD) - deadBefore, 7e18);
    }
}
