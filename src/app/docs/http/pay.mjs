// Pay an x402 API over plain HTTP: ask for the price, sign once, ask again with the payment.
// Needs Node 18 or newer and one package, for signing: npm install viem
// Run: AUTONOMO_WALLET_KEY=0x... node pay.mjs "https://autonomo.fun/x/gas-now/gas"
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// The dollars this wallet pays with. To pay USDC on Base instead, set NETWORK to "eip155:8453".
const NETWORK = process.env.PAY_NETWORK || "eip155:4663";
const DOLLARS = {
  "eip155:4663": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG on Robinhood Chain
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
};
const MAX_PRICE = 0.5; // dollars. Never sign for more than this.

const url = process.argv[2];
if (!url || !process.env.AUTONOMO_WALLET_KEY) {
  console.error('Usage: AUTONOMO_WALLET_KEY=0x... node pay.mjs "<api url>"');
  process.exit(1);
}
const account = privateKeyToAccount(process.env.AUTONOMO_WALLET_KEY);
const decode = (header) => JSON.parse(Buffer.from(header, "base64").toString("utf8"));
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

// 1. Ask. With no payment the API answers 402 and puts its price list in the PAYMENT-REQUIRED header.
const first = await fetch(url);
if (first.status !== 402) {
  console.log(first.status, await first.text());
  process.exit(first.ok ? 0 : 1);
}
const required = decode(first.headers.get("payment-required"));

// 2. Choose the option that is the token above, on the network above.
const offer = required.accepts.find(
  (o) =>
    o.scheme === "exact" &&
    o.network === NETWORK &&
    o.asset.toLowerCase() === DOLLARS[NETWORK].toLowerCase() &&
    o.extra?.name, // a name here means one signature is enough
);
if (!offer) throw new Error(`This API has no one-signature price on ${NETWORK}`);
const price = Number(offer.amount) / 1e6; // USDG and USDC both count in millionths of a dollar
if (price > MAX_PRICE) throw new Error(`The price is $${price}, over the limit of $${MAX_PRICE}`);

// 3. Sign a transfer of exactly that amount to exactly that address.
// It is a signature, not a transaction, so the wallet pays no gas.
const authorization = {
  from: account.address,
  to: getAddress(offer.payTo),
  value: offer.amount,
  validAfter: "0",
  validBefore: String(Math.floor(Date.now() / 1000) + offer.maxTimeoutSeconds),
  // 32 random bytes, new for every payment
  nonce: "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
};
const signature = await account.signTypedData({
  domain: {
    name: offer.extra.name,
    version: offer.extra.version,
    chainId: Number(offer.network.split(":")[1]),
    verifyingContract: getAddress(offer.asset),
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  },
});

// 4. Ask again, the same request, with the payment in the PAYMENT-SIGNATURE header.
const payment = {
  x402Version: required.x402Version,
  payload: { authorization, signature },
  extensions: required.extensions, // copied back as it came
  resource: required.resource, // copied back as it came
  accepted: offer, // the option you chose, unchanged
};
const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": encode(payment) } });

// 5. Read the answer. A paid call carries a receipt in the PAYMENT-RESPONSE header.
if (paid.status === 402) {
  const again = paid.headers.get("payment-required");
  const failed = paid.headers.get("payment-response");
  const reason = (failed && decode(failed).errorReason) || (again && decode(again).error) || "no reason given";
  console.error(`Not paid: ${reason}`);
  process.exit(1);
}
console.log(paid.status, await paid.text());
const receipt = paid.headers.get("payment-response");
if (receipt) console.log(`Paid $${price}. Transaction: ${decode(receipt).transaction}`);
