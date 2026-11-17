// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BaseSplitter, BaseSplitterFactory} from "../src/BaseSplitter.sol";
import {IERC20} from "shared/Interfaces.sol";

// The splitters for creator APIs paid in USDC on Base: 95% to the creator, 5% to Autonomo's Base Safe, which refills
// the mirror burn pot on Robinhood Chain. Against Base's real USDC; skipped unless BASE_RPC_URL is set.
contract BaseSplitterForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_SAFE = 0x92a99FBD386F87277b6009BFF4C56728Ec5f7354;
    address constant CREATOR = address(0xC0FFEE);

    BaseSplitterFactory factory;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        factory = new BaseSplitterFactory(USDC, BASE_SAFE);
    }

    function _usdc() private pure returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = USDC;
    }

    function test_usdcSplits95To5() public {
        if (!forked) return;
        address splitter = factory.splitterOf(CREATOR);
        assertEq(splitter.code.length, 0, "known before it exists");
        deal(USDC, splitter, 1_000_000); // 1 USDC of payments
        uint256 safeBefore = IERC20(USDC).balanceOf(BASE_SAFE);

        vm.prank(address(0xBEEF)); // anyone can flush
        factory.flush(CREATOR, _usdc());

        assertEq(IERC20(USDC).balanceOf(CREATOR), 950_000);
        assertEq(IERC20(USDC).balanceOf(BASE_SAFE) - safeBefore, 50_000);
        assertEq(IERC20(USDC).balanceOf(splitter), 0);
        assertEq(BaseSplitter(splitter).recipient(), CREATOR);
        assertEq(BaseSplitter(splitter).usdc(), USDC);
        assertEq(BaseSplitter(splitter).reserve(), BASE_SAFE);
    }

    function test_flushEmitsWhatWentWhere() public {
        if (!forked) return;
        address splitter = factory.splitterOf(CREATOR);
        deal(USDC, splitter, 200_000);
        factory.deploy(CREATOR);
        vm.expectEmit(true, false, false, true, splitter);
        emit BaseSplitter.Flushed(USDC, 190_000, 10_000);
        BaseSplitter(splitter).flush(USDC);
    }

    function test_secondFlushAndDustAreSafe() public {
        if (!forked) return;
        factory.flush(CREATOR, _usdc()); // empty: deploys, moves nothing
        address splitter = factory.splitterOf(CREATOR);
        assertGt(splitter.code.length, 0);

        deal(USDC, splitter, 19); // too small for a 5% share: all of it goes to the creator
        factory.flush(CREATOR, _usdc());
        assertEq(IERC20(USDC).balanceOf(CREATOR), 19);
    }

    function test_otherTokensGoToTheCreatorInFull() public {
        if (!forked) return;
        address weth = 0x4200000000000000000000000000000000000006;
        address splitter = factory.splitterOf(CREATOR);
        deal(weth, splitter, 1 ether);
        address[] memory tokens = new address[](1);
        tokens[0] = weth;
        factory.flush(CREATOR, tokens);
        assertEq(IERC20(weth).balanceOf(CREATOR), 1 ether);
    }
}

// Checks that need no fork.
contract BaseSplitterFactoryTest is Test {
    function test_refusesEmptyAddresses() public {
        vm.expectRevert(BaseSplitterFactory.ZeroAddress.selector);
        new BaseSplitterFactory(address(0), address(1));
        vm.expectRevert(BaseSplitterFactory.ZeroAddress.selector);
        new BaseSplitterFactory(address(1), address(0));
    }

    function test_refusesAnEmptyRecipient() public {
        BaseSplitterFactory factory = new BaseSplitterFactory(address(1), address(2));
        vm.expectRevert(BaseSplitterFactory.ZeroRecipient.selector);
        factory.deploy(address(0));
    }

    function test_sameAddressEveryTime() public {
        BaseSplitterFactory factory = new BaseSplitterFactory(address(1), address(2));
        address predicted = factory.splitterOf(address(0xC0FFEE));
        assertEq(factory.deploy(address(0xC0FFEE)), predicted);
        assertEq(factory.deploy(address(0xC0FFEE)), predicted, "a second deploy returns the same splitter");
    }
}
