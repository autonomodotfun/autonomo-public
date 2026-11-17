// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BurnSplitter, BurnSplitterFactory} from "../src/BurnSplitter.sol";

contract MockToken {
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

contract BurnSplitterTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant CREATOR = address(0xC0FFEE);
    address constant BUYBACK = address(0xB0B);

    MockToken autonomo = new MockToken();
    MockToken usdg = new MockToken();
    MockToken other = new MockToken();
    BurnSplitterFactory factory = new BurnSplitterFactory(address(autonomo), address(usdg), BUYBACK);

    function test_addressIsKnownBeforeDeployment() public {
        address predicted = factory.splitterOf(CREATOR);
        assertEq(predicted.code.length, 0);
        assertEq(factory.deploy(CREATOR), predicted);
        assertGt(predicted.code.length, 0);
        // Deploying again returns the same splitter.
        assertEq(factory.deploy(CREATOR), predicted);
    }

    function test_burnsFivePercentOfAutonomo() public {
        address splitter = factory.splitterOf(CREATOR);
        autonomo.mint(splitter, 100e18); // paid before the splitter exists
        address[] memory tokens = new address[](1);
        tokens[0] = address(autonomo);
        factory.flush(CREATOR, tokens);
        assertEq(autonomo.balanceOf(DEAD), 5e18);
        assertEq(autonomo.balanceOf(CREATOR), 95e18);
        assertEq(autonomo.balanceOf(splitter), 0);
    }

    function test_sendsFivePercentOfUsdgToBuyback() public {
        address splitter = factory.deploy(CREATOR);
        usdg.mint(splitter, 10_000); // 0.01 USDG
        BurnSplitter(splitter).flush(address(usdg));
        assertEq(usdg.balanceOf(BUYBACK), 500);
        assertEq(usdg.balanceOf(CREATOR), 9_500);
    }

    function test_otherTokensGoToTheCreatorInFull() public {
        address splitter = factory.deploy(CREATOR);
        other.mint(splitter, 500);
        BurnSplitter(splitter).flush(address(other));
        assertEq(other.balanceOf(CREATOR), 500);
        assertEq(other.balanceOf(BUYBACK), 0);
    }

    function test_flushWithNothingDoesNothing() public {
        address splitter = factory.deploy(CREATOR);
        (uint256 kept, uint256 burnt) = BurnSplitter(splitter).flush(address(autonomo));
        assertEq(kept + burnt, 0);
    }

    function test_rejectsZeroRecipient() public {
        vm.expectRevert(BurnSplitterFactory.ZeroRecipient.selector);
        factory.deploy(address(0));
    }

    function testFuzz_splitAddsUp(uint128 amount) public {
        address splitter = factory.deploy(CREATOR);
        autonomo.mint(splitter, amount);
        (uint256 kept, uint256 burnt) = BurnSplitter(splitter).flush(address(autonomo));
        assertEq(kept + burnt, amount);
        assertEq(burnt, uint256(amount) * 500 / 10_000);
    }

    function test_eachCreatorGetsTheirOwnSplitter() public view {
        assertTrue(factory.splitterOf(CREATOR) != factory.splitterOf(address(0xBEEF)));
    }
}
