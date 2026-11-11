#!/usr/bin/env node
// Autonomo CLI: the SDK from a terminal, for people and for agents that run shell commands.
//
//   npx autonomo-sdk find "wallet holdings"            look, free
//   npx autonomo-sdk risk 0x… --dry-run                the price, without paying
//   AUTONOMO_WALLET_KEY=0x… npx autonomo-sdk risk 0x…  pay and print the answer
//   npx autonomo-sdk risk 0x… --private                pay from a private Gloam balance instead
//
// The answer goes to stdout and everything else (the receipt, questions, errors) to stderr, so `autonomo … | jq`
// works. The wallet key is only ever read from AUTONOMO_WALLET_KEY, never from a flag, so it stays out of shell
// history. The SDK's per-call cap and daily budget apply to every paid call. With --private the payment is made by
// Gloam's own server, started on this machine with its own key and limits (see gloam.ts); no wallet key is needed.

import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatUnits } from "viem";
import { startGloam, type GloamSession } from "./gloam.js";
import { Autonomo, AutonomoError, DEFAULT_LIMITS, TOKENS, VERSION, fileStore, type Api, type CallOptions, type Limits, type SpendStore, type TokenName } from "./index.js";

/** Everything the CLI touches outside itself, so tests can swap it. */
export type Io = {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** True when a person is at the terminal, so a paid call asks first. */
  interactive: boolean;
  confirm: (question: string) => Promise<boolean>;
  fetch?: typeof fetch;
  spendStore?: SpendStore;
  /** Starts Gloam's server for --private. The default runs `npx -y @gloamtrade/mcp`. */
  startGloam?: () => Promise<GloamSession>;
};

export const EXIT = { ok: 0, failed: 1, usage: 2, overLimit: 3, cannotPay: 4, refused: 5, notFound: 6 } as const;

const HELP = `Autonomo CLI ${VERSION}: find and pay for APIs on autonomo.fun

Usage
  autonomo find [words] [input]     List APIs, best matches first. Free.
  autonomo quote <words> [input]    The API a call would use and its prices. Free.
  autonomo call <words> [input]     Find the right API, pay for one call, print the answer.
  autonomo spend                    Today's spending against your limits.

Shortcuts for the official APIs
  autonomo price [token address]    $AUTONOMO's price, or any launchpad token's
  autonomo launches [how many]      Newest token launches
  autonomo risk <token address>     Rug-risk check
  autonomo tx <transaction hash>    A transaction in plain words
  autonomo portfolio <wallet>       What a wallet holds
  autonomo read <https link>        A web page's text
  autonomo offers <what you need>   Matching offers on Ostrapad

Options
  --max <usdg>              Most to pay for one call (default ${DEFAULT_LIMITS.perCall.usdg})
  --daily <usdg>            Most to spend per UTC day (default ${DEFAULT_LIMITS.daily.usdg})
  --max-autonomo <amount>   The same two limits when paying in $AUTONOMO
  --daily-autonomo <amount> (defaults ${DEFAULT_LIMITS.perCall.autonomo} and ${DEFAULT_LIMITS.daily.autonomo})
  --pay-with <token>        usdg, autonomo or auto (default: USDG, then $AUTONOMO)
  --borro <credit line>     Borrow from this Borro line when the wallet is short of USDG
  --private                 Pay from your private Gloam balance, so the payment doesn't link to a wallet
  --retry-header <header>   With --private: finish a call Gloam paid for but the API didn't answer, without paying again
  --slug <api> --path <p>   With call or quote: use this API and path, skipping the search
  --dry-run                 Show the price instead of paying
  --yes                     Don't ask before paying
  --json                    One JSON object on stdout: { data, receipt }
  --help, --version

Wallet
  Set AUTONOMO_WALLET_KEY to the private key of a wallet made just for the agent, holding only what it may spend.
  find, quote, spend and --dry-run need no wallet.

Private payments
  --private starts Gloam's own server on this machine (npx @gloamtrade/mcp) and has it pay in USDG. It needs no
  AUTONOMO_WALLET_KEY: Gloam uses its own key and limits from ~/.gloam/agent.env, and that key is never read by
  this command. Deposit USDG into Gloam's private balance first. The price includes Gloam's fee, counts against
  --max and --daily, and paying can take a few minutes. Setup: autonomo.fun/docs/sdk#pay-privately-with-gloam

Exit codes
  0 done   1 failed   2 bad usage   3 over a limit   4 can't pay   5 payment refused   6 no such API`;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT = /^\d+(\.\d+)?$/;
const GLOAM_SETUP = "Gloam needs its own key and limits in ~/.gloam/agent.env: autonomo.fun/docs/sdk#pay-privately-with-gloam";

class UsageError extends Error {}
const usage = (message: string): never => {
  throw new UsageError(message);
};

/** Each shortcut names its API and builds the path, so nothing is searched. */
const SHORTCUTS: Record<string, (args: string[]) => { slug: string; path: string }> = {
  price: ([token]) => {
    if (token === undefined) return { slug: "token-price", path: "/price/autonomo" };
    if (!ADDRESS.test(token)) usage("price takes a token contract address (0x and 40 hex characters), or nothing for $AUTONOMO.");
    return { slug: "token-lookup", path: `/price/${token}` };
  },
  launches: ([count = "10"]) => {
    if (!/^\d{1,3}$/.test(count) || Number(count) < 1) usage("launches takes how many to show, e.g. autonomo launches 5.");
    return { slug: "new-launches", path: `/launches?limit=${Number(count)}` };
  },
  risk: ([token]) => {
    if (!token || !ADDRESS.test(token)) usage("risk takes a token contract address: autonomo risk 0x…");
    return { slug: "token-risk", path: `/risk/${token}` };
  },
  tx: ([hash]) => {
    if (!hash || !TX_HASH.test(hash)) usage("tx takes a transaction hash (0x and 64 hex characters).");
    return { slug: "tx-explainer", path: `/tx/${hash}` };
  },
  portfolio: ([wallet]) => {
    if (!wallet || !ADDRESS.test(wallet)) usage("portfolio takes a wallet address: autonomo portfolio 0x…");
    return { slug: "wallet-portfolio", path: `/portfolio/${wallet}` };
  },
  read: ([link]) => {
    if (!link || !/^https:\/\/\S+$/i.test(link)) usage("read takes an https:// link.");
    return { slug: "page-reader", path: `/page?url=${encodeURIComponent(link)}` };
  },
  offers: (words) => {
    const q = words.join(" ").trim();
    if (!q) usage('offers takes what you need done: autonomo offers "summarize a document"');
    return { slug: "ostrapad-offer-finder", path: `/offers?q=${encodeURIComponent(q)}` };
  },
};

const price = (api: Api) => {
  const parts = [api.price.usdg !== undefined && `${api.price.usdg} USDG`, api.price.autonomo !== undefined && `${api.price.autonomo} AUTONOMO`].filter(Boolean);
  return parts.join(" or ") || "see quote";
};

function exitFor(e: unknown): number {
  if (e instanceof UsageError) return EXIT.usage;
  if (!(e instanceof AutonomoError)) return EXIT.failed;
  if (e.code === "over_limit") return EXIT.overLimit;
  // cannot_pay covers both a limit and an empty wallet; the limit ones say "cap" or "budget".
  if (e.code === "cannot_pay") return /per-call cap|budget/.test(e.message) && !/the wallet holds/.test(e.message) ? EXIT.overLimit : EXIT.cannotPay;
  if (e.code === "no_wallet" || e.code === "bad_key" || e.code === "no_gloam" || e.code === "no_private_option") return EXIT.cannotPay;
  if (e.code === "payment_refused" || e.code === "paid_not_served") return EXIT.refused;
  if (e.code === "not_found") return EXIT.notFound;
  return EXIT.failed;
}

/** Runs one command and returns its exit code. `argv` is what follows the program name. */
export async function run(argv: string[], io: Io): Promise<number> {
  let json = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        max: { type: "string" },
        daily: { type: "string" },
        "max-autonomo": { type: "string" },
        "daily-autonomo": { type: "string" },
        "pay-with": { type: "string" },
        borro: { type: "string" },
        private: { type: "boolean" },
        "retry-header": { type: "string" },
        slug: { type: "string" },
        path: { type: "string" },
        "dry-run": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        key: { type: "string" },
        "private-key": { type: "string" },
      },
    });
    json = Boolean(values.json);
    if (values.key !== undefined || values["private-key"] !== undefined) {
      usage("The wallet key isn't taken as a flag, so it stays out of your shell history. Set AUTONOMO_WALLET_KEY instead.");
    }
    if (values.version) return io.out(VERSION), EXIT.ok;
    const [command, ...rest] = positionals;
    if (values.help || command === undefined || command === "help") return io.out(HELP), EXIT.ok;

    const amount = (flag: "max" | "daily" | "max-autonomo" | "daily-autonomo") => {
      const v = values[flag];
      if (v !== undefined && !AMOUNT.test(v)) usage(`--${flag} takes an amount in whole tokens, e.g. --${flag} 0.05.`);
      return v;
    };
    const limits: Limits = {
      perCall: { usdg: amount("max") ?? DEFAULT_LIMITS.perCall.usdg, autonomo: amount("max-autonomo") ?? DEFAULT_LIMITS.perCall.autonomo },
      daily: { usdg: amount("daily") ?? DEFAULT_LIMITS.daily.usdg, autonomo: amount("daily-autonomo") ?? DEFAULT_LIMITS.daily.autonomo },
    };
    const payWith = values["pay-with"] ?? "auto";
    if (payWith !== "usdg" && payWith !== "autonomo" && payWith !== "auto") usage("--pay-with takes usdg, autonomo or auto.");
    const borro = values.borro ?? io.env.AUTONOMO_BORRO_ACCOUNT;
    if (borro !== undefined && !ADDRESS.test(borro)) usage("--borro takes the credit line's address.");
    const retryHeader = values["retry-header"];
    if (values.private && (values["pay-with"] !== undefined || values.borro !== undefined)) {
      usage("--private pays in USDG from your Gloam balance, so it can't be combined with --pay-with or --borro.");
    }
    if (retryHeader !== undefined && !values.private) usage("--retry-header goes with --private: it finishes a call Gloam already paid for.");
    if (retryHeader !== undefined && !retryHeader.trim()) usage("--retry-header takes the paymentHeader from the earlier result.");

    const store = io.spendStore ?? fileStore();
    const client = (withWallet: boolean) =>
      new Autonomo({
        privateKey: withWallet ? io.env.AUTONOMO_WALLET_KEY || undefined : undefined,
        payWith: payWith as TokenName | "auto",
        limits,
        borro: borro ? { account: borro } : undefined,
        spendStore: store,
        fetch: io.fetch,
      });
    const print = (value: unknown) => io.out(typeof value === "string" ? value : JSON.stringify(value, null, 2));

    if (command === "find") {
      const [words = "", input] = rest;
      let apis: Api[];
      if (input !== undefined) {
        apis = await client(false).find(words, input);
      } else {
        // Browsing: with no input to fit, show every API whose text matches, including the ones that need an input.
        const terms = words.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
        const hits = (a: Api) => terms.filter((w) => `${a.slug} ${a.name} ${a.description}`.toLowerCase().includes(w)).length;
        apis = (await client(false).find()).filter((a) => terms.length === 0 || hits(a) > 0).sort((x, y) => hits(y) - hits(x));
      }
      if (json) return print(apis), EXIT.ok;
      if (apis.length === 0) return io.err(`No API matches "${words}". Run autonomo find to see them all.`), EXIT.notFound;
      for (const a of apis) io.out(`${a.slug}  ${price(a)}${a.verified ? "  verified" : ""}\n  ${a.name}: ${a.description}\n  ${a.path}`);
      return EXIT.ok;
    }

    if (command === "spend") {
      const day = new Date().toISOString().slice(0, 10);
      const spent = await store.get(day);
      const row = (t: TokenName) => ({ spent: formatUnits(spent[t] ?? 0n, TOKENS[t].decimals), daily: limits.daily![t]!, perCall: limits.perCall![t]! });
      const report = { day, wallet: client(true).address, usdg: row("usdg"), autonomo: row("autonomo") };
      if (json) return print(report), EXIT.ok;
      io.out(`Today (${day}, UTC)`);
      io.out(`  USDG      ${report.usdg.spent} of ${report.usdg.daily} spent, up to ${report.usdg.perCall} a call`);
      io.out(`  AUTONOMO  ${report.autonomo.spent} of ${report.autonomo.daily} spent, up to ${report.autonomo.perCall} a call`);
      io.out(`  Wallet    ${report.wallet ?? "none set (AUTONOMO_WALLET_KEY)"}`);
      return EXIT.ok;
    }

    // Everything else is a call: a shortcut, or `call` / `quote` with words.
    let words = "";
    let opts: CallOptions;
    const quoteOnly = command === "quote" || Boolean(values["dry-run"]);
    if (command === "call" || command === "quote") {
      if (values.slug) {
        opts = { slug: values.slug, path: values.path, input: rest[0] };
      } else {
        if (values.path) usage("--path needs --slug, the API it belongs to.");
        if (!rest[0]) usage(`${command} takes what you need in words: autonomo ${command} "is this token safe" 0x…`);
        if (rest.length > 2) usage(`Put the words in quotes: autonomo ${command} "is this token safe" 0x…`);
        words = rest[0];
        opts = { input: rest[1] };
      }
    } else if (Object.hasOwn(SHORTCUTS, command)) {
      if (values.slug || values.path) usage(`${command} already names its API. Use call with --slug and --path instead.`);
      opts = SHORTCUTS[command](rest);
    } else {
      return usage(`Unknown command "${command}". Run autonomo --help.`);
    }

    if (quoteOnly) {
      const q = await client(false).quote(words, opts);
      if (json) return print(q), EXIT.ok;
      io.out(`${q.api.name} (${q.api.slug})\n  ${q.url}`);
      for (const o of q.offers) io.out(`  ${o.amount} ${o.token}${o.private ? "  private, through Gloam" : ""}`);
      return EXIT.ok;
    }

    if (values.private) {
      // Gloam's server is only started once a payment is really going to be made, and always stopped afterwards.
      let session: GloamSession | undefined;
      const gloam = async (notice: string) => {
        if (session) return session;
        if (!json) io.err(notice);
        try {
          return (session = await (io.startGloam ?? (() => startGloam(io.env, undefined, VERSION)))());
        } catch (e) {
          throw new AutonomoError(`${e instanceof Error ? e.message : String(e)} ${GLOAM_SETUP}`, "no_gloam");
        }
      };
      try {
        const autonomo = new Autonomo({
          limits,
          spendStore: store,
          fetch: io.fetch,
          gloam: { fetchPaid: async (args) => (await gloam("Paying privately through Gloam. This can take a few minutes…")).fetchPaid(args) },
        });
        if (retryHeader !== undefined) {
          const q = await autonomo.quote(words, opts);
          const r = await (await gloam("Asking Gloam to present the earlier payment…")).fetchPaid({ url: q.url, paymentHeader: retryHeader.trim(), prefer: "gloam-cashout" });
          if (r.status !== "ok") {
            throw new AutonomoError(`Not answered yet: ${r.message ?? r.error ?? r.code ?? r.status}. Nothing more was paid; try again with the same --retry-header.`, "paid_not_served");
          }
          let data: unknown = r.body ?? "";
          try {
            data = JSON.parse(String(data));
          } catch {
            // Plain text is fine.
          }
          if (json) return print({ data, receipt: null }), EXIT.ok;
          print(data);
          io.err(`Answered by ${q.api.name} with the earlier payment. Nothing more was paid.`);
          return EXIT.ok;
        }
        if (io.interactive && !values.yes) {
          const q = await autonomo.quote(words, opts);
          const offer = q.offers.find((o) => o.private);
          if (!offer) throw new AutonomoError(`${q.api.name} doesn't offer private payment.`, "no_private_option");
          const question = `${q.api.name} costs ${offer.amount} ${offer.token} privately through Gloam, its fee included. Pay from your Gloam balance? [y/N] `;
          if (!(await io.confirm(question))) return io.err("Not paid."), EXIT.ok;
        }
        const { data, receipt } = await autonomo.call(words, { ...opts, private: true });
        if (json) return print({ data, receipt }), EXIT.ok;
        print(data);
        io.err(`Paid ${receipt.amount} ${receipt.token} privately through Gloam to ${receipt.api.name}. Today: ${receipt.spentToday}.`);
        if (receipt.explorer) io.err(receipt.explorer);
        return EXIT.ok;
      } finally {
        await session?.close().catch(() => {});
      }
    }

    const autonomo = client(true);
    if (!autonomo.address) {
      throw new AutonomoError("No wallet set. Put the agent wallet's private key in AUTONOMO_WALLET_KEY, or add --dry-run to see the price.", "no_wallet");
    }
    if (io.interactive && !values.yes) {
      const q = await autonomo.quote(words, opts);
      const prices = q.offers.filter((o) => !o.private).map((o) => `${o.amount} ${o.token}`).join(" or ");
      if (!(await io.confirm(`${q.api.name} costs ${prices}. Pay from ${autonomo.address}? [y/N] `))) return io.err("Not paid."), EXIT.ok;
    }
    const { data, receipt } = await autonomo.call(words, opts);
    if (json) return print({ data, receipt }), EXIT.ok;
    print(data);
    io.err(`Paid ${receipt.amount} ${receipt.token} to ${receipt.api.name}${receipt.route === "borro" ? " on Borro credit" : ""}. Today: ${receipt.spentToday}.`);
    if (receipt.explorer) io.err(receipt.explorer);
    return EXIT.ok;
  } catch (e) {
    const code = e instanceof AutonomoError ? e.code : e instanceof UsageError || (e as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS") ? "usage" : "failed";
    const message = e instanceof Error ? e.message : String(e);
    io.err(json ? JSON.stringify({ error: { code, message } }) : code === "usage" ? `${message}\nRun autonomo --help for the commands.` : message);
    return code === "usage" ? EXIT.usage : exitFor(e);
  }
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const code = await run(process.argv.slice(2), {
    env: process.env,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    confirm: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^y(es)?$/i.test((await rl.question(question)).trim());
      } finally {
        rl.close();
      }
    },
  });
  process.exitCode = code;
}
