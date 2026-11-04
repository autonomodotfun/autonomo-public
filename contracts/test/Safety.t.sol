// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {BurnSplitterFactory} from "../src/BurnSplitter.sol";
import {IPoolManager, PoolKey} from "../src/Interfaces.sol";

contract OwnershipTest is Test {
    address constant OWNER = address(0x0A11CE);
    address constant NEXT = address(0xB0B);
    address constant USDG = address(0x1111);
    address constant AUTONOMO = address(0x2222);

    function _deploy(address owner) private returns (BuybackBurner) {
        return new BuybackBurner(
            IPoolManager(address(0x3333)),
            USDG,
            AUTONOMO,
            PoolKey(address(0), USDG, 500, 10, address(0)),
            PoolKey(address(0), AUTONOMO, 0, 200, address(0)),
            owner,
            address(0x4EE9)
        );
    }

    function test_rejectsZeroOwnerAtDeployment() public {
        vm.expectRevert(BuybackBurner.ZeroOwner.selector);
        _deploy(address(0));
    }

    function test_handoverNeedsTheNewOwnerToAccept() public {
        BuybackBurner b = _deploy(OWNER);
        vm.prank(OWNER);
        b.setOwner(NEXT);
        assertEq(b.owner(), OWNER); // nothing changes until it's accepted
        assertEq(b.pendingOwner(), NEXT);

        vm.prank(NEXT);
        b.acceptOwner();
        assertEq(b.owner(), NEXT);
        assertEq(b.pendingOwner(), address(0));
    }

    function test_aTypoCantLoseOwnership() public {
        BuybackBurner b = _deploy(OWNER);
        vm.startPrank(OWNER);
        b.setOwner(address(0xDEAD)); // nobody can accept this
        assertEq(b.owner(), OWNER);
        b.setOwner(address(0)); // and it can be cancelled
        assertEq(b.pendingOwner(), address(0));
        b.setKeeper(address(0xBEEF)); // the owner still works
        vm.stopPrank();
        assertEq(b.keeper(), address(0xBEEF));
    }

    function test_onlyThePendingOwnerCanAccept() public {
        BuybackBurner b = _deploy(OWNER);
        vm.prank(OWNER);
        b.setOwner(NEXT);
        vm.prank(address(0xBAD));
        vm.expectRevert(BuybackBurner.NotPendingOwner.selector);
        b.acceptOwner();
        vm.prank(OWNER);
        vm.expectRevert(BuybackBurner.NotPendingOwner.selector);
        b.acceptOwner();
    }

    function test_strangerCantStartAHandover() public {
        BuybackBurner b = _deploy(OWNER);
        vm.prank(address(0xBAD));
        vm.expectRevert(BuybackBurner.NotOwner.selector);
        b.setOwner(address(0xBAD));
    }
}

contract DeployCheckTest is Test {
    // create2 can fail on too little gas while the call itself still has enough left to finish. That must not look like
    // a successful deployment at address zero.
    function test_aFailedDeployNeverReportsSuccess() public {
        BurnSplitterFactory factory = new BurnSplitterFactory(address(0x1), address(0x2), address(0x3));
        address creator = address(0xC0FFEE);
        address predicted = factory.splitterOf(creator);
        for (uint256 gas_ = 20_000; gas_ < 700_000; gas_ += 1_000) {
            uint256 snap = vm.snapshotState();
            (bool ok, bytes memory ret) = address(factory).call{gas: gas_}(abi.encodeCall(BurnSplitterFactory.deploy, (creator)));
            if (ok) {
                assertEq(abi.decode(ret, (address)), predicted, "reported success at the wrong address");
                assertGt(predicted.code.length, 0, "reported success with nothing deployed");
            }
            vm.revertToState(snap);
        }
    }
}
