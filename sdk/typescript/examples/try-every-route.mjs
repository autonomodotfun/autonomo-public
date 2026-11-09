// Try every way the SDK pays, one small call at a time, on the New Launches API (0.01 USDG or 100 $AUTONOMO a call).
//
//   node try-every-route.mjs quote               free: the API it would use and every price it takes
//   node try-every-route.mjs usdg                pay in USDG from the wallet
//   node try-every-route.mjs autonomo            pay in $AUTONOMO from the wallet (first time: one Permit2 approval)
//   node try-every-route.mjs gloam-shield 0.05   move 0.05 USDG into the Gloam agent's private balance
//   node try-every-route.mjs gloam-balance       show that private balance
//   node try-every-route.mjs gloam               pay privately through Gloam
//   node try-every-route.mjs gloam-retry <header>  finish a Gloam call that was paid but not answered, without paying again
//   node try-every-route.mjs borro               borrow what the wallet is short from a Borro credit line, then pay
//
// Set in the terminal, never in a file you share or commit:
//   AUTONOMO_WALLET_KEY   usdg and autonomo: the wallet that pays. borro: the agent wallet set on the credit line
//   BORRO_CREDIT_LINE     the Borro credit line's address (borro)
// Gloam needs no wallet key here: it reads its own key and limits from ~/.gloam/agent.env. Every paid command is capped
// at 0.02 USDG or 150 $AUTONOMO a call and 0.10 USDG or 500 $AUTONOMO a day, and prints the receipt with its transaction link.
import { Autonomo, AutonomoError } from "autonomo-sdk";

const QUERY = "newest launches";
const limits = { perCall: { usdg: "0.02", autonomo: "150" }, daily: { usdg: "0.10", autonomo: "500" } };
const [route, arg] = process.argv.slice(2);

function need(name) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.log(`Set ${name} first, in this terminal.`);
    process.exit(1);
  }
  return v;
}

function show({ data, receipt: r }) {
  console.log(`\nPaid ${r.amount} ${r.token} by route "${r.route}" for ${r.api.name}`);
  console.log(`Payer:    ${r.payer}`);
  console.log(`Paid to:  ${r.payTo}`);
  if (r.explorer) console.log(`Payment:  ${r.explorer}`);
  for (const t of r.borrowTxs) console.log(`Borrow:   ${t}`);
  if (r.approveTx) console.log(`Approval: ${r.approveTx}`);
  console.log(`Spent today: ${r.spentToday}`);
  console.log(`\nAnswer starts: ${JSON.stringify(data).slice(0, 300)}`);
}

/** Starts Gloam's own MCP server on this machine and runs `work` with a function that calls its tools. */
async function withGloam(work) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const npx = ["npx", "-y", "@gloamtrade/mcp"];
  const [command, ...args] = process.platform === "win32" ? ["cmd", "/c", ...npx] : npx; // npx is a script on Windows
  const gloam = new Client({ name: "autonomo-try-every-route", version: "1.0.0" });
  await gloam.connect(new StdioClientTransport({ command, args }));
  const call = async (name, args) => {
    // A private payment builds its proofs on this machine and can take a few minutes: wait up to 5, not 60 seconds.
    const out = await gloam.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    const text = out.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return { status: "text", message: text };
    }
  };
  try {
    return await work(call);
  } finally {
    await gloam.close();
  }
}

const wallet = () => new Autonomo({ privateKey: need("AUTONOMO_WALLET_KEY"), payWith: route, limits });

try {
  if (route === "quote") {
    const q = await new Autonomo().quote(QUERY);
    console.log(`${q.api.name}: ${q.url}`);
    for (const o of q.offers) console.log(`  ${o.amount} ${o.token}${o.private ? " (private, through Gloam)" : ""}`);
  } else if (route === "usdg" || route === "autonomo") {
    show(await wallet().call(QUERY));
  } else if (route === "borro") {
    const account = need("BORRO_CREDIT_LINE");
    show(await new Autonomo({ privateKey: need("AUTONOMO_WALLET_KEY"), payWith: "usdg", borro: { account }, limits }).call(QUERY));
  } else if (route === "gloam-shield") {
    const amount = Number(arg ?? "0.05");
    console.log(JSON.stringify(await withGloam((call) => call("gloam_execute_shield", { amount, network: "robinhood-mainnet" })), null, 2));
  } else if (route === "gloam-balance") {
    console.log(JSON.stringify(await withGloam((call) => call("gloam_list_notes", {})), null, 2));
  } else if (route === "gloam-retry") {
    // Presents the payment Gloam already made instead of paying again.
    if (!arg) {
      console.log("Pass the paymentHeader from the earlier result: node try-every-route.mjs gloam-retry <header>");
      process.exit(1);
    }
    const { url } = await new Autonomo().quote(QUERY);
    const r = await withGloam((call) => call("gloam_fetch_paid", { url, paymentHeader: arg, prefer: "gloam-cashout" }));
    console.log(r.status === "ok" ? `Answered with the earlier payment: ${String(r.body ?? "").slice(0, 300)}` : `Not answered yet: ${JSON.stringify(r).slice(0, 500)}`);
  } else if (route === "gloam") {
    show(await withGloam((call) => new Autonomo({ gloam: { fetchPaid: (a) => call("gloam_fetch_paid", a) }, limits }).call(QUERY, { private: true })));
  } else {
    console.log("Use one of: quote, usdg, autonomo, gloam-shield <amount>, gloam-balance, gloam, gloam-retry <header>, borro");
  }
} catch (e) {
  if (!(e instanceof AutonomoError)) throw e;
  console.log(`\nNot paid (${e.code}): ${e.message}`);
}
