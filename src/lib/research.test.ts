// Offline tests for the research agent: no network, no payments, no model.
// Run: npx tsx --conditions=react-server --test src/lib/research.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PayResult } from "@/lib/playground-pay";
import {
  creatorRecordFrom,
  factsFor,
  holdersCheckFrom,
  launchCheckFrom,
  reportFrom,
  researchToken,
  walletCheckFrom,
  type ResearchDeps,
  type ResearchEvent,
} from "@/lib/research";

const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const WHALE = "0x3333333333333333333333333333333333333333";
const LAUNCH_TX = `0x${"ab".repeat(32)}`;

const riskBody = (over: Record<string, unknown> = {}) => ({
  token: TOKEN,
  name: "Test Coin",
  symbol: "TEST",
  risk: { level: "medium", score: 4, flags: [{ severity: "high", text: "Top 10 wallets hold 80%" }] },
  launch: { launchedAt: "2026-11-09T10:00:00.000Z", creator: CREATOR, launchTx: LAUNCH_TX },
  holders: { count: 42, largestPercent: 30, top10Percent: 80, top: [{ address: WHALE, percent: 30 }, { address: CREATOR, percent: 10 }] },
  supply: { creatorPercent: 9.5, launchBlockBuyers: 6, launchBlockBuyersPercent: 22, burnedPercent: 0 },
  trading: { buys24h: 50, sells24h: 70, uniqueBuyers: 120, stillHolding: 42, volumeEth: 3.2 },
  market: { priceUsd: 0.0001, marketCapUsd: 100000, graduated: false, curveProgress: { percent: 40 } },
  explorer: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
  ...over,
});

const txBody = {
  summary: "0x2222…2222 launched $TEST on the Robinhood Chain launchpad. 8 wallets bought TEST in this same transaction for 1 ETH in total (~$3,000.00), a bundled buy.",
  actions: [{ type: "launch", token: TOKEN }, ...Array.from({ length: 8 }, () => ({ type: "buy", token: TOKEN }))],
  time: "2026-11-09T10:00:00.000Z",
  explorer: `https://robinhoodchain.blockscout.com/tx/${LAUNCH_TX}`,
};

const portfolio = (wallet: string, holds: boolean, launches = 0) => ({
  wallet,
  totalUsd: 500,
  eth: { amount: 0.2 },
  tokens: [
    ...(holds ? [{ token: TOKEN, symbol: "TEST", amount: 1000, valueUsd: 10, priceSource: "launchpad-curve" }] : []),
    ...Array.from({ length: launches }, (_, i) => ({ token: `0x${String(i + 4).repeat(40)}`, symbol: `L${i}`, valueUsd: 1, priceSource: "launchpad-curve" })),
  ],
  explorer: `https://robinhoodchain.blockscout.com/address/${wallet}`,
});

const devBody = (over: Record<string, unknown> = {}) => ({
  token: { address: TOKEN, symbol: "TEST" },
  creator: { address: CREATOR, launchTx: LAUNCH_TX },
  flags: [
    { severity: "warn", text: "The creator sold 9.50% of the supply" },
    { severity: "warn", text: "The creator launched 4 other tokens on the launchpad" },
  ],
  supply: { holdsPercent: 0, boughtPercent: 9.5, soldPercent: 9.5, pooledPercent: 0, burnedPercent: 0, lockedPercent: 0, sentPercent: 0 },
  fees: { claimedEth: 0.42, pendingEth: 0.01 },
  funding: { funder: WHALE, funderIsService: false, funderLaunches: { count: 2 } },
  otherLaunches: { count: 4 },
  explorer: `https://robinhoodchain.blockscout.com/address/${CREATOR}`,
  ...over,
});

const holdersBody = {
  token: { address: TOKEN, symbol: "TEST", holders: 42 },
  flags: [
    { severity: "warn", text: "2 groups of top holders share a first funder and hold 38.6% together: probably the same person, not proven" },
    { severity: "warn", text: "1 top holder got their first ETH from the creator's wallet and hold 12.0%" },
  ],
  summary: { poolLaunchBurnPercent: 12, largestWalletPercent: 30, top10WalletsPercent: 80, snipersBoughtPercent: 24, snipersStillHoldPercent: 15, linkedGroupsPercent: 38.6 },
  topHolders: [{ address: WHALE, percent: 30 }],
  linkedGroups: [{ funder: "a" }, { funder: "b" }],
  snipers: { windowSeconds: 15, count: 9, buyers: [{ otherLaunchesSniped: ["x"] }, { otherLaunchesSniped: [] }] },
  sameBlockBuyers: [{ block: 1 }, { block: 2 }, { block: 3 }],
  repeatSnipersChecked: true,
  explorer: `https://robinhoodchain.blockscout.com/token/${TOKEN}`,
};

const ok = (data: unknown, tx = "0xfeed"): PayResult => ({ ok: true, amount: "100", data, tx, explorer: `https://x/tx/${tx}` });

function fakeDeps(answers: Record<string, PayResult>, summary: string | null = "A short summary.") {
  const paid: string[] = [];
  const deps: ResearchDeps = {
    gateway: async (slug) => ({ name: slug, autonomoAmount: "100" }),
    payAndCall: async (url) => {
      paid.push(url);
      const key = Object.keys(answers).find((k) => url.includes(k));
      return key ? answers[key] : { ok: false, error: "The API answered 500, so no payment was taken." };
    },
    summarize: summary === null ? null : async () => summary,
  };
  return { deps, paid };
}

async function run(deps: ResearchDeps) {
  const events: ResearchEvent[] = [];
  const outcome = await researchToken(TOKEN, (e) => events.push(e), deps);
  return { outcome, events, steps: events.filter((e) => e.type === "step") as Extract<ResearchEvent, { type: "step" }>[] };
}

test("a full report pays six checks in order, then writes a summary from all of them", async () => {
  const facts: string[] = [];
  const { deps, paid } = fakeDeps({
    "/risk/": ok(riskBody(), "0x01"),
    "/dev/": ok(devBody(), "0x02"),
    "/holders/": ok(holdersBody, "0x03"),
    "/tx/": ok(txBody, "0x04"),
    [`/portfolio/${CREATOR}`]: ok(portfolio(CREATOR, false, 4), "0x05"),
    [`/portfolio/${WHALE}`]: ok(portfolio(WHALE, true), "0x06"),
  });
  deps.summarize = async (f) => (facts.push(f), "A short summary.");
  const { outcome, events } = await run(deps);
  assert.equal(paid.length, 6);
  assert.match(paid[0], /\/x\/token-risk\/risk\/0x1111/);
  assert.match(paid[1], /\/x\/dev-wallet\/dev\/0x1111/);
  assert.match(paid[2], /\/x\/holders-bundles\/holders\/0x1111/);
  assert.match(paid[3], /\/x\/tx-explainer\/tx\/0xabab/);
  assert.match(paid[4], /\/x\/wallet-portfolio\/portfolio\/0x2222/);
  assert.match(paid[5], /\/x\/wallet-portfolio\/portfolio\/0x3333/);
  assert.ok(outcome.ok && outcome.receipts.length === 6);

  const dev = events.find((e) => e.type === "dev");
  assert.ok(dev && dev.type === "dev" && dev.record.soldPercent === 9.5 && dev.record.otherLaunches === 4);
  const holders = events.find((e) => e.type === "holders");
  assert.ok(holders && holders.type === "holders" && holders.check.linkedGroups === 2 && holders.check.fundedByCreator);
  const launch = events.find((e) => e.type === "launch");
  assert.ok(launch && launch.type === "launch" && launch.launch.bundled && launch.launch.buysInLaunch === 8);
  const creator = events.find((e) => e.type === "wallet" && e.role === "creator");
  assert.ok(creator && creator.type === "wallet");
  assert.ok(creator.check.flags.some((f) => f.includes("4 other new launchpad tokens")));
  // The tracker says what the creator did, so the wallet's guess from its balance is dropped.
  assert.ok(!creator.check.flags.some((f) => f.includes("no longer holds")));

  const read = JSON.parse(facts[0]);
  assert.equal(read.whatTheCreatorDid.soldPercent, 9.5);
  assert.equal(read.whoHoldsIt.linkedGroupsOfTopHolders, 2);
  assert.ok(events.some((e) => e.type === "summary" && e.text === "A short summary."));
  assert.equal(events.at(-1)?.type, "done");
});

test("without the creator's record, the wallet check still says when the creator holds none", async () => {
  const { deps } = fakeDeps({ "/risk/": ok(riskBody()), "/tx/": ok(txBody), [`/portfolio/${CREATOR}`]: ok(portfolio(CREATOR, false)) });
  const { events, steps } = await run(deps);
  assert.equal(steps.filter((s) => s.step === "dev").at(-1)?.state, "fail");
  const creator = events.find((e) => e.type === "wallet" && e.role === "creator");
  assert.ok(creator && creator.type === "wallet" && creator.check.flags.some((f) => f.includes("no longer holds")));
});

test("past the time budget, the checks not yet started are skipped and the summary still runs", async () => {
  const { deps, paid } = fakeDeps({ "/risk/": ok(riskBody()), "/dev/": ok(devBody()), "/holders/": ok(holdersBody), "/tx/": ok(txBody), "/portfolio/": ok(portfolio(CREATOR, true)) });
  // The clock starts at 30 s and each later read adds 30 s: the creator's record starts at 30 s in and the holders
  // check at 60 s, both inside the 80 s budget; the launch would start at 90 s, so it and the wallets are skipped.
  let clock = 0;
  deps.now = () => (clock += 30_000);
  const { outcome, steps, events } = await run(deps);
  assert.ok(outcome.ok);
  assert.equal(paid.length, 3);
  for (const step of ["launch", "creator", "holder"] as const) {
    const s = steps.filter((x) => x.step === step).at(-1);
    assert.equal(s?.state, "skipped", step);
    assert.match(s?.detail ?? "", /in time/, step);
  }
  assert.ok(events.some((e) => e.type === "summary"));
});

test("a token Token Risk doesn't cover is refunded and pays nothing else", async () => {
  const { deps, paid } = fakeDeps({ "/risk/": { ok: false, error: "The API answered 404, so no payment was taken." } });
  const { outcome, events } = await run(deps);
  assert.deepEqual(outcome, { ok: false, refund: true });
  assert.equal(paid.length, 1);
  const error = events.find((e) => e.type === "error");
  assert.ok(error && error.type === "error" && /No launch found/.test(error.message));
});

test("an unreadable Token Risk answer was paid for, so the free report isn't refunded", async () => {
  const { deps } = fakeDeps({ "/risk/": ok({ nope: true }) });
  const { outcome } = await run(deps);
  assert.deepEqual(outcome, { ok: false, refund: false });
});

test("a failed launch check doesn't stop the wallet checks", async () => {
  const { deps, paid } = fakeDeps({
    "/risk/": ok(riskBody()),
    [`/portfolio/${CREATOR}`]: ok(portfolio(CREATOR, true)),
    [`/portfolio/${WHALE}`]: ok(portfolio(WHALE, true)),
  });
  const { outcome, steps } = await run(deps);
  assert.ok(outcome.ok);
  // Token Risk, the two token checks (which fail here too), the launch and both wallets.
  assert.equal(paid.length, 6);
  assert.equal(steps.find((s) => s.step === "launch" && s.state !== "running")?.state, "fail");
  assert.equal(steps.find((s) => s.step === "holder" && s.state !== "running")?.state, "done");
});

test("once the wallet is resting, later paid checks are skipped instead of tried", async () => {
  const { deps, paid } = fakeDeps({
    "/risk/": ok(riskBody()),
    "/dev/": { ok: false, resting: true, error: "The agent spent today's budget. It's resting until tomorrow." },
  });
  const { outcome, steps } = await run(deps);
  assert.ok(outcome.ok);
  assert.equal(paid.length, 2);
  for (const step of ["holders", "launch", "creator", "holder"] as const) {
    assert.equal(steps.find((s) => s.step === step)?.state, "skipped", step);
  }
});

test("when the largest holder is the creator, it's only checked once", async () => {
  const body = riskBody({ holders: { count: 3, largestPercent: 60, top10Percent: 100, top: [{ address: CREATOR, percent: 60 }] } });
  const { deps, paid } = fakeDeps({
    "/risk/": ok(body),
    "/dev/": ok(devBody()),
    "/holders/": ok(holdersBody),
    "/tx/": ok(txBody),
    [`/portfolio/${CREATOR}`]: ok(portfolio(CREATOR, true)),
  });
  const { steps } = await run(deps);
  assert.equal(paid.length, 5);
  const holder = steps.find((s) => s.step === "holder");
  assert.equal(holder?.state, "skipped");
  assert.match(holder?.detail ?? "", /is the creator/);
});

test("without a model the report still finishes, with the summary skipped", async () => {
  const { deps } = fakeDeps({ "/risk/": ok(riskBody()), "/tx/": ok(txBody), "/portfolio/": ok(portfolio(CREATOR, true)) }, null);
  const { outcome, events, steps } = await run(deps);
  assert.ok(outcome.ok);
  assert.ok(!events.some((e) => e.type === "summary"));
  assert.equal(steps.find((s) => s.step === "summary")?.state, "skipped");
});

test("a failing summary leaves the paid checks standing", async () => {
  const { deps } = fakeDeps({ "/risk/": ok(riskBody()), "/tx/": ok(txBody), "/portfolio/": ok(portfolio(CREATOR, true)) });
  deps.summarize = async () => {
    throw new Error("model down");
  };
  const { outcome, steps } = await run(deps);
  assert.ok(outcome.ok && outcome.receipts.length === 4);
  assert.equal(steps.filter((s) => s.step === "summary").at(-1)?.state, "fail");
});

test("parsers reject answers that aren't what they expect", () => {
  assert.equal(reportFrom({ token: TOKEN, risk: { level: "weird" } }), null);
  assert.equal(launchCheckFrom({ summary: 3 }, TOKEN), null);
  assert.equal(walletCheckFrom({ wallet: CREATOR }, TOKEN, "creator"), null);
  assert.equal(creatorRecordFrom({ creator: { address: "nope" }, supply: { holdsPercent: 1 } }), null);
  assert.equal(creatorRecordFrom({ error: "creator_not_found" }), null);
  assert.equal(holdersCheckFrom({ topHolders: "x", summary: {} }), null);
  assert.equal(holdersCheckFrom({ error: "not_found" }), null);
  const r = reportFrom(riskBody({ holders: { top: [{ address: "not-an-address", percent: 5 }, { address: WHALE, percent: 4 }] } }));
  assert.deepEqual(r?.topHolders, [{ address: WHALE, percent: 4 }]);
  assert.equal(reportFrom(riskBody({ launch: { launchTx: "0x12", creator: "nope" } }))?.launchTx, null);
});

test("the creator's record and the holders check read the APIs' answers", () => {
  const dev = creatorRecordFrom(devBody())!;
  assert.equal(dev.creator, CREATOR);
  assert.equal(dev.soldPercent, 9.5);
  assert.equal(dev.feesClaimedEth, 0.42);
  assert.deepEqual(dev.funder, { address: WHALE, launches: 2 });
  // An exchange or other service funds thousands of wallets, so it isn't named as the funder.
  assert.equal(creatorRecordFrom(devBody({ funding: { funder: WHALE, funderIsService: true } }))!.funder, null);

  const h = holdersCheckFrom(holdersBody)!;
  assert.equal(h.holders, 42);
  assert.equal(h.linkedGroups, 2);
  assert.equal(h.snipers, 9);
  assert.equal(h.sameBlockBuys, 3);
  assert.equal(h.repeatSnipers, 1);
  assert.equal(h.fundedByCreator, true);
  assert.equal(holdersCheckFrom({ ...holdersBody, repeatSnipersChecked: false })!.repeatSnipers, null);
});

test("a creator buy without a bundle is named, and a quiet launch has no flags", () => {
  const one = launchCheckFrom({ summary: "x launched $TEST. x bought 5 TEST for 0.1 ETH.", actions: [{ type: "buy", token: TOKEN }] }, TOKEN);
  assert.deepEqual(one?.flags, ["The creator bought some of the token in the launch transaction"]);
  const none = launchCheckFrom({ summary: "x launched $TEST.", actions: [{ type: "launch", token: TOKEN }] }, TOKEN);
  assert.deepEqual(none?.flags, []);
});

test("the summary's facts carry every check and no receipts", () => {
  const report = reportFrom(riskBody())!;
  const facts = JSON.parse(factsFor(report, launchCheckFrom(txBody, TOKEN), walletCheckFrom(portfolio(CREATOR, false, 4), TOKEN, "creator"), null));
  assert.equal(facts.tokenRisk.verdict, "careful");
  assert.equal(facts.launchTransaction.bundled, true);
  assert.equal(facts.creatorWallet.otherNewLaunches, 4);
  assert.equal(facts.largestHolderWallet, null);
  assert.ok(!JSON.stringify(facts).includes("0xfeed"));
});

test("sample mode: each address story gives the report it promises, with no real receipts", async () => {
  const { sampleDeps } = await import("@/lib/research-sample");
  const story = async (token: string) => {
    const events: ResearchEvent[] = [];
    const outcome = await researchToken(token, (e) => events.push(e), sampleDeps(token));
    const state = (step: string) => events.filter((e) => e.type === "step" && e.step === step).at(-1) as Extract<ResearchEvent, { type: "step" }>;
    return { outcome, events, state };
  };

  const risky = await story(`0x${"1".repeat(40)}`);
  assert.ok(risky.outcome.ok && risky.outcome.receipts.length === 6 && risky.outcome.receipts.every((r) => r.tx === null));
  assert.ok(risky.events.some((e) => e.type === "launch" && e.launch.bundled));
  assert.ok(risky.events.some((e) => e.type === "holders" && e.check.linkedGroups === 2));

  const high = await story(`0x${"1".repeat(39)}8`);
  assert.equal(high.state("launch").state, "fail");
  assert.ok(high.events.some((e) => e.type === "dev" && e.record.soldPercent === 9.5 && e.record.holdsPercent === 0));

  const ordinary = await story(`0x${"1".repeat(39)}f`);
  assert.equal(ordinary.state("holder").state, "skipped");
  assert.ok(ordinary.events.some((e) => e.type === "report" && e.report.verdict === "okay"));

  const none = await story(`0x${"0".repeat(40)}`);
  assert.deepEqual(none.outcome, { ok: false, refund: true });
});

test("sample mode never runs in production, and needs asking for when the Playground wallet is set", async () => {
  const { researchSampleMode } = await import("@/lib/research-sample");
  const env = process.env as Record<string, string | undefined>;
  const before = { node: env.NODE_ENV, key: env.PLAYGROUND_AGENT_PRIVATE_KEY };
  try {
    delete env.PLAYGROUND_AGENT_PRIVATE_KEY;
    env.NODE_ENV = "development";
    assert.equal(researchSampleMode(), true);
    env.NODE_ENV = "production";
    assert.equal(researchSampleMode(), false);
    assert.equal(researchSampleMode(true), false);
    env.NODE_ENV = "development";
    env.PLAYGROUND_AGENT_PRIVATE_KEY = `0x${"1".repeat(64)}`;
    assert.equal(researchSampleMode(), false);
    assert.equal(researchSampleMode(true), true);
  } finally {
    env.NODE_ENV = before.node;
    if (before.key === undefined) delete env.PLAYGROUND_AGENT_PRIVATE_KEY;
    else env.PLAYGROUND_AGENT_PRIVATE_KEY = before.key;
  }
});
