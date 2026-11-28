// Ask Autonomo's router for a service and pay the API it picks. Plain HTTP, and one signature for each try.
// Needs Node 18 or newer and one package, for signing: npm install viem
// Run: AUTONOMO_WALLET_KEY=0x... node route.mjs token-risk token=0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROUTER = process.env.AUTONOMO_ROUTER || "https://autonomo.fun";
// The dollars this wallet pays with. To pay USDC on Base instead, set NETWORK to "eip155:8453".
const NETWORK = process.env.PAY_NETWORK || "eip155:4663";
const DOLLARS = {
  "eip155:4663": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG on Robinhood Chain
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
};
const MAX_PRICE = 0.5; // dollars. Never sign for more than this.
const MAX_TRIES = 3; // APIs to pay in turn before giving up. A try that fails is never charged.
const MAX_WAIT = 120; // seconds to wait for an API that says it isn't ready yet

const [service, ...inputs] = process.argv.slice(2);
if (!service || !process.env.AUTONOMO_WALLET_KEY) {
  console.error("Usage: AUTONOMO_WALLET_KEY=0x... node route.mjs <service> [name=value ...]");
  process.exit(1);
}
const account = privateKeyToAccount(process.env.AUTONOMO_WALLET_KEY);
const decode = (header) => JSON.parse(Buffer.from(header, "base64").toString("utf8"));
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const sleep = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));

// The request: the service in the path, its inputs in the query. It is sent unchanged every time.
const query = new URLSearchParams(inputs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
const url = `${ROUTER}/route/${encodeURIComponent(service)}?${query}`;

/** Signs a payment for one price list. The same steps as paying an API directly. */
async function sign(required) {
  const offer = required.accepts.find(
    (o) =>
      o.scheme === "exact" &&
      o.network === NETWORK &&
      o.asset.toLowerCase() === DOLLARS[NETWORK].toLowerCase() &&
      o.extra?.name, // a name here means one signature is enough
  );
  if (!offer) throw new Error(`The API the router picked has no one-signature price on ${NETWORK}`);
  const price = Number(offer.amount) / 1e6; // USDG and USDC both count in millionths of a dollar
  if (price > MAX_PRICE) throw new Error(`The price is $${price}, over the limit of $${MAX_PRICE}`);
  const authorization = {
    from: account.address,
    to: getAddress(offer.payTo),
    value: offer.amount,
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + offer.maxTimeoutSeconds),
    nonce: "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"), // new for every payment
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
  const payment = {
    x402Version: required.x402Version,
    payload: { authorization, signature },
    extensions: required.extensions, // copied back as it came
    resource: required.resource, // copied back as it came
    accepted: offer, // the option you chose, unchanged
  };
  return { header: encode(payment), price };
}

/** An answer's body: JSON when it is JSON, otherwise its text. */
async function read(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const show = (body) => (typeof body === "string" ? body : JSON.stringify(body));

// 1. Ask. With no payment the router picks an API and answers 402: that API's price list, as when you call it
//    directly, and a route id. Anything else is final: 400 an input is missing, 404 no such service, 503 no API can
//    serve it right now, 429 too many requests.
const first = await fetch(url);
if (first.status !== 402) {
  console.error(first.status, show(await read(first)));
  process.exit(1);
}
let step = {
  required: decode(first.headers.get("payment-required")),
  routeId: first.headers.get("x-autonomo-route-id"),
  api: first.headers.get("x-autonomo-routed-to"),
};

for (let tries = 1; ; tries++) {
  // 2. Sign for the API that was picked, and ask again with the payment and the route id.
  //    A route id works once and for 60 seconds, so pay right after you get it.
  const { header, price } = await sign(step.required);
  const res = await fetch(url, { headers: { "PAYMENT-SIGNATURE": header, "X-Autonomo-Route-Id": step.routeId } });
  const body = await read(res);

  // 3. An answer the router checked. Only now has the payment gone through.
  if (res.status === 200) {
    console.log(res.status, show(body));
    const receipt = res.headers.get("payment-response");
    const bonded = res.headers.get("x-autonomo-bonded") === "true" ? ", which has a bond locked" : "";
    console.log(`Answered by ${res.headers.get("x-autonomo-routed-to")}${bonded}. Paid $${price}.${receipt ? ` Transaction: ${decode(receipt).transaction}` : ""}`);
    process.exit(0);
  }

  // 4. The API failed (502) or isn't ready yet (503), and nothing was charged. The answer says what to pay next:
  //    another API, or the same one after a wait. It needs a new signature, because each API is paid at its own address.
  const next = (res.status === 502 || res.status === 503) && body?.next?.route_id ? body.next : null;
  const wait = res.status === 503 ? Number(body?.retry_after_seconds ?? res.headers.get("retry-after") ?? 0) : 0;
  if (next && tries < MAX_TRIES && wait <= MAX_WAIT) {
    console.error(`${step.api}: ${body.error}`);
    if (wait > 0) await sleep(wait);
    step = { required: next, routeId: next.route_id, api: next.routed_to };
    continue;
  }

  // 5. Anything else ends it, with nothing charged: the payment was refused (402), the wallet is paused (403), no
  //    API is left to try (502), or there were too many requests (429).
  const refused = res.headers.get("payment-response");
  const reason = (refused && decode(refused).errorReason) || body?.error || show(body) || "no reason given";
  console.error(res.status === 402 ? `Not paid: ${reason}` : `${res.status} ${reason}`);
  process.exit(1);
}
