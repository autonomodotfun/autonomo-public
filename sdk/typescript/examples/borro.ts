// Borrow what the wallet is short from a Borro credit line, then pay.
import { Autonomo } from "autonomo-sdk";

const autonomo = new Autonomo({
  privateKey: process.env.AUTONOMO_WALLET_KEY,
  payWith: "usdg",
  borro: { account: process.env.BORRO_CREDIT_LINE! },
});

const { data, receipt } = await autonomo.call("explain this transaction", {
  input: "0x0f1635d41a8fbbde7d61ad39e045e067780b921329112c16955bc26ad3423041",
});
console.log(data);
console.log(receipt.route, receipt.borrowTxs, receipt.explorer); // "borro" when it borrowed, "usdg" when it didn't need to
