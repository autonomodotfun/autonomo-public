// Offline tests for the Ask agent's tools and the Telegram bot's routing: no network, no payments.
// Run: npx tsx --conditions=react-server --test src/lib/agent-tools.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS, UNTRUSTED_TEXT_TOOLS } from "@/lib/agent-tools";
import { exampleQuestion, gatewayPath, intentKeywords } from "@/lib/playground";

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

test("only Holders & Bundles is trimmed, and the two outside checks are treated as untrusted text", () => {
  assert.deepEqual(Object.entries(AGENT_TOOLS).filter(([, t]) => t.forModel).map(([n]) => n), ["holders_bundles"]);
  assert.ok(UNTRUSTED_TEXT_TOOLS.has("endpoint_health") && UNTRUSTED_TEXT_TOOLS.has("website_check"));
});

test("each new API's example question routes to that API, with the path it needs", () => {
  const cases: [string, string, string][] = [
    ["dev-wallet", "dev", "/dev/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
    ["holders-bundles", "holders", "/holders/0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"],
    ["payment-check", "payment", "/payment/0x01295eba2c428270708417f658d9a4a2f0fb08bfecd1d1229e0b0752c7bfd612"],
    ["gas-now", "gas", "/gas"],
    ["endpoint-health", "endpoint", `/endpoint?url=${encodeURIComponent("https://autonomo.fun/x/token-price")}`],
    ["website-check", "website", `/site?url=${encodeURIComponent("autonomo.fun")}`],
  ];
  for (const [slug, keyword, path] of cases) {
    const question = exampleQuestion(slug, slug);
    assert.ok(intentKeywords(question).includes(keyword), `${slug}: "${question}" → ${intentKeywords(question).join(", ")}`);
    assert.equal(gatewayPath(slug, question), path, slug);
  }
});

test("a safety question about a token still goes to the risk check, not the website check", () => {
  const words = intentKeywords(`Is ${TOKEN} safe?`);
  assert.ok(words.includes("risk"), words.join(", "));
  assert.ok(!words.includes("website"), words.join(", "));
});
