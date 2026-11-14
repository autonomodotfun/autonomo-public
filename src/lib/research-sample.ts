import "server-only";
import type { PayResult } from "@/lib/playground-pay";
import { playgroundPaymentsEnabled } from "@/lib/playground-pay";
import type { ResearchDeps } from "@/lib/research";

// Sample mode for the research agent, for working on its page locally. It exists only in development, so it can
// never run on the live site. It is on when the page is opened with ?sample=1 (/playground?mode=research&sample=1),
// or by itself when the Playground wallet isn't set up. Nothing is paid and no API or model is called, whatever keys
// are in .env.local: each "payment" waits a moment and returns made-up data in the shape the official APIs answer with.
//
// The pasted address picks the story, by its last character, so every state of the page can be seen:
//   0-5  a risky token: bundled launch, a creator with other launches, a fresh-looking largest holder
//   6-a  a high-risk token where the launch check fails and the creator has sold out
//   b-f  an ordinary token whose largest holder is its creator, so one wallet check is skipped
//   an address of all zeros: no launch found, so no report

export function researchSampleMode(asked = false) {
  return process.env.NODE_ENV !== "production" && (asked || !playgroundPaymentsEnabled());
}

/** Sample prices for the page, since a local database usually has no gateways. */
export const SAMPLE_PRICE = "100";

type Story = "risky" | "high" | "ordinary" | "none";

function storyFor(token: string): Story {
  if (/^0x0{40}$/i.test(token)) return "none";
  const last = parseInt(token.slice(-1), 16);
  return last <= 5 ? "risky" : last <= 10 ? "high" : "ordinary";
}

const fill = (digit: string) => `0x${digit.repeat(40)}`;
const CREATOR = fill("c");
const WHALE = fill("d");
const LAUNCH_TX = `0x${"ab".repeat(32)}`;
const EXPLORER = "https://robinhoodchain.blockscout.com";

function riskAnswer(token: string, story: Exclude<Story, "none">) {
  const risky = story !== "ordinary";
  return {
    token,
    name: story === "ordinary" ? "Sample Steady" : "Sample Frog",
    symbol: story === "ordinary" ? "STEADY" : "SFROG",
    risk: {
      level: story === "high" ? "high" : story === "risky" ? "medium" : "low",
      score: story === "high" ? 7 : story === "risky" ? 4 : 1,
      flags: risky
        ? [
            { severity: "high", text: "Top 10 wallets hold 81% of circulating supply" },
            { severity: "medium", text: "6 wallets bought in the launch block (22% of supply)" },
            { severity: "info", text: "More sells than buys in the last 24 hours" },
          ]
        : [{ severity: "info", text: "No major red flags in holder or trading data" }],
    },
    launch: { launchedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), creator: CREATOR, launchTx: LAUNCH_TX },
    holders: {
      count: risky ? 42 : 310,
      largestPercent: risky ? 30.4 : 6.1,
      top10Percent: risky ? 81 : 28,
      top:
        story === "ordinary"
          ? [{ address: CREATOR, percent: 6.1 }, { address: fill("4"), percent: 4.2 }, { address: fill("5"), percent: 3.9 }]
          : [{ address: WHALE, percent: 30.4 }, { address: CREATOR, percent: 10.1 }, { address: fill("4"), percent: 8.2 }, { address: fill("5"), percent: 6 }],
    },
    supply: { creatorPercent: risky ? 9.5 : 5.8, launchBlockBuyers: risky ? 6 : 1, launchBlockBuyersPercent: risky ? 22 : 2, burnedPercent: 0 },
    trading: { buys24h: risky ? 50 : 420, sells24h: risky ? 76 : 300, uniqueBuyers: risky ? 120 : 480, stillHolding: risky ? 42 : 310, volumeEth: risky ? 3.21 : 18.4 },
    market: { priceUsd: 0.0000412, marketCapUsd: 41200, graduated: story === "ordinary", curveProgress: { percent: 38 } },
    explorer: `${EXPLORER}/token/${token}`,
  };
}

function txAnswer(token: string, story: Story) {
  const bundled = story === "risky";
  return {
    summary: bundled
      ? "0xcccc…cccc launched $SFROG (Sample Frog) on the Robinhood Chain launchpad. 6 wallets bought SFROG in this same transaction for 0.9 ETH in total (~$2,940.00), a bundled buy."
      : "0xcccc…cccc launched $STEADY (Sample Steady) on the Robinhood Chain launchpad.",
    actions: [{ type: "launch", token }, ...Array.from({ length: bundled ? 6 : 0 }, () => ({ type: "buy", token }))],
    time: new Date(Date.now() - 5 * 3600_000).toISOString(),
    explorer: `${EXPLORER}/tx/${LAUNCH_TX}`,
  };
}

function devAnswer(token: string, story: Exclude<Story, "none">) {
  const s = {
    risky: { holds: 10.1, bought: 12, sold: 1.9, pooled: 0, burned: 0, locked: 0, sent: 0, claimed: 0.21, pending: 0.03, other: 5, funderLaunches: 3 },
    high: { holds: 0, bought: 9.5, sold: 9.5, pooled: 0, burned: 0, locked: 0, sent: 0, claimed: 0.48, pending: 0, other: 2, funderLaunches: 0 },
    ordinary: { holds: 6.1, bought: 8, sold: 0, pooled: 0, burned: 1.9, locked: 0, sent: 0, claimed: 0.05, pending: 0.01, other: 0, funderLaunches: 0 },
  }[story];
  const flags = [
    ...(s.sold ? [{ severity: "warn", text: `The creator sold ${s.sold.toFixed(2)}% of the supply` }] : []),
    ...(s.burned ? [{ severity: "good", text: `The creator burned ${s.burned.toFixed(2)}% of the supply` }] : []),
    ...(s.holds >= 5 ? [{ severity: "info", text: `The creator still holds ${s.holds.toFixed(2)}% of the supply` }] : []),
    { severity: "info", text: `The creator has claimed ${s.claimed.toFixed(4)} ETH in creator fees` },
    ...(s.other ? [{ severity: "warn", text: `The creator launched ${s.other} other tokens on the launchpad` }] : []),
    ...(s.funderLaunches ? [{ severity: "warn", text: `The wallet that first funded the creator has launched ${s.funderLaunches} tokens itself: a probable link, not proof` }] : []),
  ];
  return {
    token: { address: token, name: story === "ordinary" ? "Sample Steady" : "Sample Frog", symbol: story === "ordinary" ? "STEADY" : "SFROG" },
    creator: { address: CREATOR, foundFrom: "launchpad launch event", launchTx: LAUNCH_TX, launchedAt: null },
    flags,
    supply: { holdsPercent: s.holds, boughtPercent: s.bought, mintedPercent: 0, receivedPercent: 0, soldPercent: s.sold, pooledPercent: s.pooled, burnedPercent: s.burned, lockedPercent: s.locked, sentPercent: s.sent },
    fees: { claimedEth: s.claimed, pendingEth: s.pending, claims: [] },
    funding: { funder: fill("f"), eth: 0.5, funderIsService: false, funderLaunches: { count: s.funderLaunches, tokens: [] } },
    otherLaunches: { count: s.other, tokens: [] },
    explorer: `${EXPLORER}/address/${CREATOR}`,
  };
}

function holdersAnswer(token: string, story: Exclude<Story, "none">) {
  const risky = story !== "ordinary";
  const flags = risky
    ? [
        { severity: "warn", text: "9 wallets bought 24.0% of the supply in the first 15 seconds and still hold 15.2%" },
        { severity: "warn", text: "2 groups of top holders share a first funder and hold 38.6% together: probably the same person, not proven" },
        { severity: "info", text: "Several wallets bought in the same block at launch, 2 times: typical of a bundled buy" },
        { severity: "warn", text: "The ten largest wallets hold 81.0% of the supply" },
      ]
    : [{ severity: "info", text: "The largest wallet holds 6.1% of the supply" }];
  return {
    token: { address: token, symbol: story === "ordinary" ? "STEADY" : "SFROG", holders: risky ? 42 : 310 },
    creator: CREATOR,
    flags,
    summary: {
      poolLaunchBurnPercent: risky ? 12 : 40,
      unknownContractsPercent: 0,
      largestWalletPercent: risky ? 30.4 : 6.1,
      top10WalletsPercent: risky ? 81 : 28,
      snipersBoughtPercent: risky ? 24 : 1.2,
      snipersStillHoldPercent: risky ? 15.2 : 0.4,
      linkedGroupsPercent: risky ? 38.6 : 0,
    },
    topHolders: [{ address: WHALE, percent: risky ? 30.4 : 6.1, kind: "wallet" }],
    linkedGroups: risky ? [{ funder: fill("a") }, { funder: fill("b") }] : [],
    snipers: { windowSeconds: 15, count: risky ? 9 : 1, boughtPercent: risky ? 24 : 1.2, stillHoldPercent: risky ? 15.2 : 0.4, buyers: risky ? [{ address: WHALE, otherLaunchesSniped: [fill("6")] }] : [] },
    sameBlockBuyers: risky ? [{ block: 1 }, { block: 2 }] : [],
    repeatSnipersChecked: true,
    explorer: `${EXPLORER}/token/${token}`,
  };
}

function portfolioAnswer(wallet: string, token: string, story: Story) {
  const isCreator = wallet.toLowerCase() === CREATOR;
  const self = { token, symbol: story === "ordinary" ? "STEADY" : "SFROG", amount: 1000, valueUsd: isCreator ? 3901 : 12500, priceSource: "launchpad-curve" };
  const others = Array.from({ length: 5 }, (_, i) => ({ token: fill(String(i + 6)), symbol: `OLD${i + 1}`, valueUsd: 12 - i * 2, priceSource: "launchpad-curve" }));
  const copy = { token: fill("e"), symbol: "USDG", valueUsd: 0, warning: "Copies a known symbol" };
  let tokens: unknown[];
  if (!isCreator) tokens = wallet.toLowerCase() === WHALE ? [self] : [self, others[0]];
  else if (story === "risky") tokens = [self, ...others, copy];
  else if (story === "high") tokens = others.slice(0, 2);
  else tokens = [self];
  return {
    wallet,
    totalUsd: isCreator ? 812.4 : 12500,
    eth: { amount: wallet.toLowerCase() === WHALE ? 0.0004 : 0.2 },
    tokens,
    explorer: `${EXPLORER}/address/${wallet}`,
  };
}

const SUMMARIES: Record<Exclude<Story, "none">, string> = {
  risky:
    "Sample summary: $SFROG has a risk score of 4, a heuristic, mainly because the top 10 wallets hold 81% of it. Two groups of top holders share a first funder and hold about 39% together, probably the same person though not proven, and snipers still hold 15%. The launch was bundled, and the creator, who has launched 5 other tokens, was funded by a wallet that launches tokens too.",
  high: "Sample summary: $SFROG has a risk score of 7, a heuristic. The creator sold their whole 9.5% and has launched 2 other tokens, while the top 10 wallets hold 81% and two groups of them look linked by one funder, which is probable rather than proven. The launch transaction couldn't be read, so this report doesn't say who bought in it.",
  ordinary:
    "Sample summary: $STEADY has a risk score of 1, a heuristic, with no major warning signs. It has graduated, holders are spread out with the top 10 at 28%, and the largest holder is the creator at about 6%. Nobody else bought in the launch transaction.",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stand-ins for the gateways, the wallet and the model. No request leaves this process. */
export function sampleDeps(token: string): ResearchDeps {
  const story = storyFor(token);
  const answer = (data: unknown): PayResult => ({ ok: true, amount: SAMPLE_PRICE, data, tx: null, explorer: null });
  return {
    gateway: async (slug) => ({
      name:
        {
          "token-risk": "Token Risk",
          "dev-wallet": "Dev Wallet Tracker",
          "holders-bundles": "Holders & Bundles",
          "tx-explainer": "Tx Explainer",
          "wallet-portfolio": "Wallet Portfolio",
        }[slug] ?? slug,
      autonomoAmount: SAMPLE_PRICE,
    }),
    payAndCall: async (url) => {
      await wait(900);
      const path = new URL(url).pathname;
      if (path.includes("/risk/")) {
        return story === "none" ? { ok: false, error: "The API answered 404, so no payment was taken." } : answer(riskAnswer(token, story));
      }
      if (story === "none") return { ok: false, error: "The API answered 404, so no payment was taken." };
      if (path.includes("/dev/")) return answer(devAnswer(token, story));
      if (path.includes("/holders/")) return answer(holdersAnswer(token, story));
      if (path.includes("/tx/")) {
        return story === "high" ? { ok: false, error: "The API answered 502, so no payment was taken." } : answer(txAnswer(token, story));
      }
      return answer(portfolioAnswer(path.split("/").pop() ?? "", token, story));
    },
    summarize: async () => {
      await wait(900);
      return story === "none" ? null : SUMMARIES[story];
    },
  };
}
