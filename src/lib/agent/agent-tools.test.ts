// Offline tests for the Ask agent's tools and the Telegram bot's routing: no network, no payments.
// Run: npx tsx --conditions=react-server --test src/lib/agent/agent-tools.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS, UNTRUSTED_TEXT_TOOLS } from "@/lib/agent/agent-tools";
import { exampleQuestion, gatewayPath, intentKeywords } from "@/lib/agent/playground";

const TOKEN = "0x41b57f6273b5a78cf9125ce6800f415738e0bba0";
const wallet = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;

/** A Holders & Bundles answer as big as the API makes them: 30 holders, many groups, 40 snipers. */
function bigHoldersAnswer() {
  return {
    token: { address: TOKEN, name: "Test", symbol: "TEST", holders: 2400 },
    creator: wallet(999),
    flags: [
      { severity: "warn", text: "12 wallets bought 31.0% of the supply in the first 15 seconds and still hold 18.2%" },
      { severity: "warn", text: "3 groups of top holders share a first funder and hold 22.4% together: probably the same person, not proven" },
    ],
    summary: { poolLaunchBurnPercent: 41.2, unknownContractsPercent: 3, largestWalletPercent: 6.1, top10WalletsPercent: 33.4, snipersBoughtPercent: 31, snipersStillHoldPercent: 18.2, linkedGroupsPercent: 22.4 },
    topHolders: Array.from({ length: 30 }, (_, i) => ({ address: wallet(i + 1), percent: 6 - i * 0.1, kind: "wallet", firstFunder: wallet(500 + (i % 4)), label: null })),
    linkedGroups: Array.from({ length: 9 }, (_, i) => ({ funder: wallet(500 + i), wallets: [wallet(i + 1), wallet(i + 2), wallet(i + 3)], percent: 4.2 })),
    servicesIgnored: [],
    snipers: {
      windowSeconds: 15,
      count: 40,
      boughtPercent: 31,
      stillHoldPercent: 18.2,
      windowFullyRead: true,
      buyers: Array.from({ length: 40 }, (_, i) => ({ address: wallet(700 + i), tx: `0x${"ab".repeat(32)}`, secondsAfterLaunch: i % 15, boughtPercent: 0.8, stillHoldsPercent: 0.4, otherLaunchesSniped: [wallet(800 + i)] })),
    },
    sameBlockBuyers: Array.from({ length: 8 }, (_, i) => ({ block: 1000 + i, wallets: [wallet(700 + i), wallet(701 + i), wallet(702 + i)] })),
    repeatSnipersChecked: true,
    explorer: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
    note: "Read from public on-chain data. Not financial advice.",
  };
}

test("a full Holders & Bundles answer is shortened to fit, keeping the flags, the summary and the largest holders", () => {
  const full = bigHoldersAnswer();
  assert.ok(JSON.stringify(full).length > 8_000, "the sample is big enough to have been cut before");
  const short = AGENT_TOOLS.holders_bundles.forModel!(full) as ReturnType<typeof bigHoldersAnswer> & Record<string, unknown>;
  assert.ok(JSON.stringify(short).length < 8_000, `fits under the cut: ${JSON.stringify(short).length} characters`);
  assert.deepEqual(short.flags, full.flags);
  assert.deepEqual(short.summary, full.summary);
  assert.equal(short.topHolders.length, 10);
  assert.equal(short.topHolders[0].address, full.topHolders[0].address);
  assert.equal(short.topHoldersNotShown, 20);
  assert.equal(short.linkedGroupsNotShown, 4);
  assert.equal((short.snipers as unknown as { buyersNotShown: number }).buyersNotShown, 35);
  assert.equal(short.snipers.count, 40, "the totals stay whole");
  assert.equal(short.sameBlockBuyersNotShown, 5);
});

test("anything that isn't a Holders & Bundles answer passes through the trim unchanged", () => {
  const error = { error: "not_found", message: "No token found at this address on Robinhood Chain." };
  assert.equal(AGENT_TOOLS.holders_bundles.forModel!(error), error);
  assert.equal(AGENT_TOOLS.holders_bundles.forModel!("text"), "text");
});

test("a page's long lists are cut for the model, with a count of what was left out, and its text is whole", () => {
  const page = {
    url: "https://demo.xyz/", title: "Demo", text: "word ".repeat(500).trim(), words: 500,
    headings: Array.from({ length: 40 }, (_, i) => ({ level: 2, text: `Heading ${i}` })),
    links: { count: 80, outside: 3, accounts: { x: ["https://x.com/demo"] }, emails: [], list: Array.from({ length: 80 }, (_, i) => ({ url: `https://demo.xyz/p${i}`, kind: "site" })) },
    addresses: { count: 30, list: Array.from({ length: 30 }, (_, i) => ({ address: `0x${String(i).padStart(40, "0")}`, in: ["link"] })) },
    flags: [{ code: "several_addresses", severity: "info", text: "…" }],
  };
  const short = AGENT_TOOLS.page_reader.forModel!(page) as typeof page & { links: { listNotShown: number }; addresses: { listNotShown: number } };
  assert.equal(short.text, page.text);
  assert.equal(short.links.list.length, 20);
  assert.equal(short.links.listNotShown, 60);
  assert.deepEqual(short.links.accounts, page.links.accounts, "the accounts are kept whole");
  assert.equal(short.links.count, 80);
  assert.equal(short.addresses.list.length, 10);
  assert.equal(short.addresses.listNotShown, 20);
  assert.equal(short.headings.length, 15);
  assert.deepEqual(short.flags, page.flags);
  const error = { error: "page_error", message: "The page answered 404." };
  assert.equal(AGENT_TOOLS.page_reader.forModel!(error), error);
  // An answer from before these lists existed passes through with empty ones.
  const old = AGENT_TOOLS.page_reader.forModel!({ url: "https://a.b/", text: "hello" }) as { links: { list: unknown[] } };
  assert.deepEqual(old.links.list, []);
});

test("only the two long answers are trimmed, and the two outside checks are treated as untrusted text", () => {
  assert.deepEqual(Object.entries(AGENT_TOOLS).filter(([, t]) => t.forModel).map(([n]) => n), ["holders_bundles", "page_reader"]);
  assert.ok(UNTRUSTED_TEXT_TOOLS.has("endpoint_health") && UNTRUSTED_TEXT_TOOLS.has("website_check"));
});

test("each new API's example question routes to that API, with the path it needs", () => {
  const cases: [string, string, string][] = [
    ["dev-wallet", "dev", "/dev/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
    ["holders-bundles", "holders", "/holders/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
    ["payment-check", "payment", "/payment/0x01295eba2c428270708417f658d9a4a2f0fb08bfecd1d1229e0b0752c7bfd612"],
    ["gas-now", "gas", "/gas"],
    ["endpoint-health", "endpoint", `/endpoint?url=${encodeURIComponent("https://autonomo.fun/x/token-lookup")}`],
    ["website-check", "website", `/site?url=${encodeURIComponent("autonomo.fun")}`],
    ["token-lookup", "lookup", "/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
  ];
  for (const [slug, keyword, path] of cases) {
    const question = exampleQuestion(slug, slug);
    assert.ok(intentKeywords(question).includes(keyword), `${slug}: "${question}" → ${intentKeywords(question).join(", ")}`);
    assert.equal(gatewayPath(slug, question), path, slug);
  }
});

test("the $AUTONOMO price goes to Token Lookup with its address; the retired Token Price is not used", () => {
  for (const q of ["What's the current price of $AUTONOMO?", "price of autonomo", `Price of token ${TOKEN}`]) {
    assert.ok(intentKeywords(q).includes("lookup"), `"${q}" → ${intentKeywords(q).join(", ")}`);
  }
  assert.equal(gatewayPath("token-lookup", "How much is $AUTONOMO?"), "/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96");
  assert.equal(AGENT_TOOLS.token_price, undefined);
  assert.ok(!Object.values(AGENT_TOOLS).some((t) => t.slug === "token-price"));
  assert.equal(AGENT_TOOLS.token_lookup.path({ address: "0xE83C85E1EAD16FCFE85401E2B337FB4FB5B5CC96" }), "/price/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96");
});

test("a safety question about a token still goes to the risk check, not the website check", () => {
  const words = intentKeywords(`Is ${TOKEN} safe?`);
  assert.ok(words.includes("risk"), words.join(", "));
  assert.ok(!words.includes("website"), words.join(", "));
});
