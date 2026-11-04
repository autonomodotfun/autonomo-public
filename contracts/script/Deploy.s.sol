// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {BurnSplitterFactory} from "../src/BurnSplitter.sol";
import {IPoolManager} from "../src/Interfaces.sol";
import {Robinhood} from "./Robinhood.sol";

/// Deploys the BuybackBurner and the BurnSplitterFactory that pays into it.
///   BURN_OWNER    Can change the keeper, nothing else (the Autonomo Safe).
///   BURN_KEEPER   Triggers buybacks (the facilitator wallet, which already pays gas).
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("BURN_OWNER");
        address keeper = vm.envAddress("BURN_KEEPER");
        vm.startBroadcast();
        BuybackBurner buyback = new BuybackBurner(
            IPoolManager(Robinhood.POOL_MANAGER),
            Robinhood.USDG,
            Robinhood.AUTONOMO,
            Robinhood.usdgPool(),
            Robinhood.autonomoPool(),
            owner,
            keeper
        );
        BurnSplitterFactory factory = new BurnSplitterFactory(Robinhood.AUTONOMO, Robinhood.USDG, address(buyback));
        vm.stopBroadcast();
        console.log("BUYBACK_BURNER=%s", address(buyback));
        console.log("BURN_SPLITTER_FACTORY=%s", address(factory));
    }
}
