// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {BurnSplitterV2, BurnSplitterFactoryV2} from "../src/BurnSplitterV2.sol";
import {IERC20} from "shared/Interfaces.sol";
import {Robinhood} from "../script/Robinhood.sol";

interface IRegistry {
    function register() external returns (uint256);
    function ownerOf(uint256) external view returns (address);
    function getAgentWallet(uint256) external view returns (address);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function transferFrom(address from, address to, uint256 id) external;
}

interface IUSDG {
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes memory signature) external;
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Runs against a fork of Robinhood Chain: the real ERC-8004 registry, USDG, $AUTONOMO and BuybackBurner.
/// Skipped unless ROBINHOOD_RPC_URL is set. Tokens are dealt on the fork, so no live balance is needed.
contract BurnSplitterV2ForkTest is Test {
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant USDG = Robinhood.USDG;
    address constant AUTONOMO = Robinhood.AUTONOMO;
    address constant BUYBACK = 0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    BurnSplitterFactoryV2 factory;
    BurnSplitterV2 splitter;
    address seller = makeAddr("seller");      // splitter recipient (the Safe for official APIs)
    address agentOwner = makeAddr("owner");   // owns the seller agent (the creator wallet)
    address stranger = makeAddr("stranger");
    uint256 agentId;
    bool forked;

    modifier onFork() {
        if (!forked) return;
        _;
    }

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        factory = new BurnSplitterFactoryV2(AUTONOMO, USDG, BUYBACK, REGISTRY);
        splitter = BurnSplitterV2(factory.deploy(seller));
        vm.prank(agentOwner);
        agentId = IRegistry(REGISTRY).register();
    }

    function _approve(uint256 deadline) internal {
        vm.prank(seller);
        splitter.approveAgentWallet(agentId, deadline);
    }

    function _declare(uint256 deadline) internal {
        vm.prank(agentOwner);
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), deadline, "");
    }

    // ---------------------------------------------------------------- declaration

    function test_declare_end_to_end_on_the_real_registry() public onFork {
        uint256 deadline = block.timestamp + 10 minutes;
        _approve(deadline);                              // e.g. a Safe signs this ahead of time
        vm.warp(deadline - 4 minutes);                   // registry only takes the last 5 minutes
        _declare(deadline);
        assertEq(IRegistry(REGISTRY).getAgentWallet(agentId), address(splitter));
    }

    function test_registry_refuses_outside_its_5_minute_window() public onFork {
        uint256 deadline = block.timestamp + 10 minutes;
        _approve(deadline);
        vm.prank(agentOwner); vm.expectRevert(bytes("deadline too far"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), deadline, "");
        vm.warp(deadline + 1);
        vm.prank(agentOwner); vm.expectRevert(bytes("expired"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), deadline, "");
    }

    function test_without_approval_the_declaration_fails() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        vm.prank(agentOwner); vm.expectRevert(bytes("invalid wallet sig"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), deadline, "");
    }

    function test_only_the_recipient_can_approve() public onFork {
        vm.prank(agentOwner); vm.expectRevert(BurnSplitterV2.NotRecipient.selector);
        splitter.approveAgentWallet(agentId, block.timestamp + 1 hours);
        vm.prank(stranger); vm.expectRevert(BurnSplitterV2.NotRecipient.selector);
        splitter.approveAgentWallet(agentId, block.timestamp + 1 hours);
    }

    function test_a_stranger_cannot_attach_the_splitter_to_their_agent() public onFork {
        _approve(block.timestamp + 4 minutes);           // approval is for OUR agent
        vm.prank(stranger);
        uint256 theirs = IRegistry(REGISTRY).register();
        vm.prank(stranger); vm.expectRevert(bytes("invalid wallet sig"));
        IRegistry(REGISTRY).setAgentWallet(theirs, address(splitter), block.timestamp + 4 minutes, "");
    }

    function test_other_deadline_fails() public onFork {
        _approve(block.timestamp + 4 minutes);
        vm.prank(agentOwner); vm.expectRevert(bytes("invalid wallet sig"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), block.timestamp + 3 minutes, "");
    }

    function test_agent_changing_hands_breaks_the_approval_and_clears_the_wallet() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        _approve(deadline);
        _declare(deadline);
        address newOwner = makeAddr("newOwner");
        vm.prank(agentOwner); IRegistry(REGISTRY).transferFrom(agentOwner, newOwner, agentId);
        assertEq(IRegistry(REGISTRY).getAgentWallet(agentId), address(0));   // registry clears it on transfer
        // the old approval was for the old owner: re-declaring with it fails
        uint256 d2 = block.timestamp + 4 minutes;
        vm.prank(newOwner); vm.expectRevert(bytes("invalid wallet sig"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), d2, "");
        // approve again: works for the new owner
        vm.prank(seller); splitter.approveAgentWallet(agentId, d2);
        vm.prank(newOwner); IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), d2, "");
        assertEq(IRegistry(REGISTRY).getAgentWallet(agentId), address(splitter));
    }

    function test_clear_approval() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        _approve(deadline);
        vm.prank(seller); splitter.clearAgentWalletApproval();
        vm.prank(agentOwner); vm.expectRevert(bytes("invalid wallet sig"));
        IRegistry(REGISTRY).setAgentWallet(agentId, address(splitter), deadline, "");
    }

    function test_deadline_bounds() public onFork {
        vm.startPrank(seller);
        vm.expectRevert(BurnSplitterV2.BadDeadline.selector);
        splitter.approveAgentWallet(agentId, block.timestamp - 1);
        vm.expectRevert(BurnSplitterV2.BadDeadline.selector);
        splitter.approveAgentWallet(agentId, block.timestamp + 1 days + 1);
        splitter.approveAgentWallet(agentId, block.timestamp + 1 days);
        vm.stopPrank();
    }

    function test_says_no_to_everything_else_and_after_the_deadline() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        _approve(deadline);
        bytes32 d = splitter.approvedDigest();
        assertEq(splitter.isValidSignature(d, ""), bytes4(0x1626ba7e));
        assertEq(splitter.isValidSignature(keccak256("anything"), ""), bytes4(0xffffffff));
        assertEq(splitter.isValidSignature(bytes32(0), ""), bytes4(0xffffffff));
        vm.warp(deadline + 1);
        assertEq(splitter.isValidSignature(d, ""), bytes4(0xffffffff));
    }

    function test_approving_a_nonexistent_agent_reverts() public onFork {
        vm.prank(seller); vm.expectRevert();
        splitter.approveAgentWallet(type(uint256).max, block.timestamp + 1 hours);
    }

    /// Documents a limit: the recipient can attach the same splitter to a second agent later. Both stay declared and
    /// Priors would share the credit between them. The contract can't stop it; the rule is "one agent per splitter".
    function test_recipient_can_attach_a_second_agent_so_keep_one() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        _approve(deadline); _declare(deadline);
        address owner2 = makeAddr("owner2");
        vm.prank(owner2); uint256 agent2 = IRegistry(REGISTRY).register();
        vm.prank(seller); splitter.approveAgentWallet(agent2, deadline);
        vm.prank(owner2); IRegistry(REGISTRY).setAgentWallet(agent2, address(splitter), deadline, "");
        assertEq(IRegistry(REGISTRY).getAgentWallet(agentId), address(splitter));
        assertEq(IRegistry(REGISTRY).getAgentWallet(agent2), address(splitter));
    }

    // ---------------------------------------------------------------- the attack the design blocks

    function _fundSplitter(uint256 amount) internal {
        deal(USDG, address(splitter), amount);
    }

    function test_usdg_cannot_be_signed_out_of_the_splitter() public onFork {
        _fundSplitter(1e6);
        _approve(block.timestamp + 4 minutes);            // even while an approval is live
        vm.prank(seller);
        vm.expectRevert();
        IUSDG(USDG).transferWithAuthorization(address(splitter), seller, 1e6, 0, block.timestamp + 1 hours, bytes32(uint256(1)), hex"1234");
        vm.prank(seller);
        vm.expectRevert();
        IUSDG(USDG).permit(address(splitter), seller, 1e6, block.timestamp + 1 hours, hex"1234");
        assertEq(IUSDG(USDG).balanceOf(address(splitter)), 1e6);
    }

    // ---------------------------------------------------------------- split, same as v1

    function test_flush_usdg_95_to_seller_5_to_buyback() public onFork {
        _fundSplitter(1e6);
        uint256 bb = IERC20(USDG).balanceOf(BUYBACK);
        splitter.flush(USDG);
        assertEq(IERC20(USDG).balanceOf(seller), 950_000);
        assertEq(IERC20(USDG).balanceOf(BUYBACK) - bb, 50_000);
    }

    function test_flush_autonomo_95_to_seller_5_burned() public onFork {
        deal(AUTONOMO, address(splitter), 1000e18);
        uint256 dead = IERC20(AUTONOMO).balanceOf(DEAD);
        splitter.flush(AUTONOMO);
        assertEq(IERC20(AUTONOMO).balanceOf(seller), 950e18);
        assertEq(IERC20(AUTONOMO).balanceOf(DEAD) - dead, 50e18);
    }

    function test_declared_splitter_still_splits_and_payments_land_there() public onFork {
        uint256 deadline = block.timestamp + 4 minutes;
        _approve(deadline); _declare(deadline);
        _fundSplitter(2e6);
        factory.flush(seller, _one(USDG));
        assertEq(IERC20(USDG).balanceOf(seller), 1_900_000);
    }

    // ---------------------------------------------------------------- factory

    function test_factory_address_known_in_advance_and_idempotent() public onFork {
        address r = makeAddr("creator");
        address predicted = factory.splitterOf(r);
        assertEq(predicted.code.length, 0);
        assertEq(factory.deploy(r), predicted);
        assertEq(factory.deploy(r), predicted);
        assertEq(BurnSplitterV2(predicted).recipient(), r);
        assertEq(BurnSplitterV2(predicted).registry(), REGISTRY);
        vm.expectRevert(BurnSplitterFactoryV2.ZeroRecipient.selector);
        factory.deploy(address(0));
    }

    function _one(address t) internal pure returns (address[] memory a) { a = new address[](1); a[0] = t; }
}

/// What a careless splitter would look like: it says yes to any signature.
contract NaiveSplitter {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) { return 0x1626ba7e; }
}

/// Shows the attack is real: USDG does ask contract wallets through ERC-1271, so a splitter that approves in general
/// gets drained with a junk signature. BurnSplitterV2 blocks exactly this (test_usdg_cannot_be_signed_out_of_the_splitter).
contract NaiveSplitterAttackTest is Test {
    address constant USDG = Robinhood.USDG;

    function test_naive_splitter_is_drained() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        NaiveSplitter naive = new NaiveSplitter();
        deal(USDG, address(naive), 1e6);
        address thief = makeAddr("thief");
        vm.prank(thief);
        IUSDG(USDG).transferWithAuthorization(address(naive), thief, 1e6, 0, block.timestamp + 1 hours, bytes32(uint256(7)), hex"1234");
        assertEq(IUSDG(USDG).balanceOf(thief), 1e6);      // all of it, nothing burned
    }
}
