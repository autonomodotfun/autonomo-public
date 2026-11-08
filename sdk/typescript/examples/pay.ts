// Pay from the agent's own wallet: USDG first, then $AUTONOMO.
import { Autonomo } from "autonomo-sdk";

const autonomo = new Autonomo({
  privateKey: process.env.AUTONOMO_WALLET_KEY,
  limits: { perCall: { usdg: "0.02" }, daily: { usdg: "0.50" } },
});

const { data, receipt } = await autonomo.call("is this token safe", {
  input: "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49",
});
console.log(data);
console.log(receipt.route, receipt.amount, receipt.token, receipt.explorer);
