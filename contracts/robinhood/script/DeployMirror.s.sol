// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MirrorBurnPot} from "../src/MirrorBurnPot.sol";

/// Deploys the MirrorBurnPot next to the BuybackBurner already on Robinhood Chain, burning 5% of Base payments.
///   MIRROR_OWNER   Can take USDG back out of the pot or hand over ownership (the official payment Safe).
/// The keeper isn't set here: the pot uses the BuybackBurner's keeper.
contract DeployMirror is Script {
    address constant BUYBACK_BURNER = 0x4d0D18a0EcbA457a4A8DB093553EaDEC37D08464;

    function run() external {
        address owner = vm.envAddress("MIRROR_OWNER");
        vm.startBroadcast();
        MirrorBurnPot pot = new MirrorBurnPot(BUYBACK_BURNER, 500, owner);
        vm.stopBroadcast();
        console.log("MIRROR_BURN_POT=%s", address(pot));
    }
}
