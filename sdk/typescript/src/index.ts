// Autonomo SDK: one call that finds the right paid API on Autonomo, pays for it on Robinhood Chain and returns the
// answer with a receipt.
//
//   const autonomo = new Autonomo({ privateKey });
//   const { data, receipt } = await autonomo.call("is this token safe", { input: "0x…" });
//
// How a call is paid, in order:
//   private: true    Only through Gloam, from a private balance, so the payment doesn't link to the wallet. Never
//                    falls back to a public payment.
//   otherwise        USDG, then $AUTONOMO (or just the one set in payWith), from the wallet, whichever it can afford.
//                    If it can't afford either and a Borro credit line is set, it borrows the USDG it's short and pays.
// Every route checks the per-call cap and the daily budget before anything is signed or sent.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  parseUnits,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const VERSION = "0.1.1";

const NETWORK = "eip155:4663";
const CHAIN_ID = 4663;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001"; // x402's exact-scheme Permit2 proxy
const BORRO_MCP = "https://borro.markets/mcp";

export type TokenName = "usdg" | "autonomo";
type Token = { name: TokenName; symbol: string; address: Hex; decimals: number };
export const TOKENS: Record<TokenName, Token> = {
  usdg: { name: "usdg", symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  autonomo: { name: "autonomo", symbol: "AUTONOMO", address: "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96", decimals: 18 },
};
export const DEFAULT_LIMITS = {
  perCall: { usdg: "0.05", autonomo: "5000" },
  daily: { usdg: "1", autonomo: "10000" },
};

// ---------- Public types ----------

export type Limits = {
  /** Most to pay for one call, in whole tokens, e.g. { usdg: "0.05" }. */
  perCall?: Partial<Record<TokenName, string>>;
  /** Most to spend per UTC day, in whole tokens. Gloam and Borro payments count as USDG. */
  daily?: Partial<Record<TokenName, string>>;
};

/**
 * Runs Gloam's `gloam_fetch_paid` tool (from `npx -y @gloamtrade/mcp`) with these arguments and returns its result:
 * Gloam cashes out exactly the quoted USDG from your private balance through its relay, retries the request with the
 * payment, and answers `{ status: "ok", hash, body, httpStatus, … }`. The SDK holds no Gloam keys.
 */
export type GloamFetchPaid = (args: { url: string; maxAmount: number; prefer: "gloam-cashout" }) => Promise<GloamResult>;
export type GloamResult = { status: string; hash?: string; body?: string; httpStatus?: number; message?: string; error?: string; code?: string; paymentHeader?: string };

/** Where today's spending is kept. The default is a JSON file in ~/.autonomo. */
export type SpendStore = {
  get(day: string): Promise<Partial<Record<TokenName, bigint>>> | Partial<Record<TokenName, bigint>>;
  add(day: string, token: TokenName, amount: bigint): Promise<void> | void;
};

export type AutonomoOptions = {
  /** The agent wallet's private key. Use a wallet just for the agent, holding only what it may spend. */
  privateKey?: Hex | string;
  /** Which token to pay with. "auto" (default) tries USDG, then $AUTONOMO. */
  payWith?: TokenName | "auto";
  limits?: Limits;
  /** Pay privately through Gloam when a call asks for `private: true`. */
  gloam?: { fetchPaid: GloamFetchPaid };
  /** Borrow from a Borro credit line when the wallet is short of USDG. `account` is the line's address. */
  borro?: { account: Hex | string; mcpUrl?: string };
  spendStore?: SpendStore;
  baseUrl?: string;
  rpcUrl?: string;
  fetch?: typeof fetch;
};

export type Api = {
  slug: string;
  name: string;
  description: string;
  path: string;
  price: { usdg?: number; autonomo?: number };
  verified: boolean;
  successRate: number | null;
  paidCalls30d: number;
};

export type CallOptions = {
  /** The value the API needs: a token or wallet address, a transaction hash or a link. Fills the API's path. */
  input?: string;
  /** Call this API, skipping the search. */
  slug?: string;
  /** The exact path to call on that API, e.g. "/risk/0x…". */
  path?: string;
  /** Pay only through Gloam, so the payment doesn't link to this wallet. */
  private?: boolean;
  /** Override payWith for this call. */
  payWith?: TokenName | "auto";
};

export type Route = "usdg" | "autonomo" | "gloam" | "borro";

export type Receipt = {
  api: { slug: string; name: string };
  url: string;
  route: Route;
  amount: string;
  token: string;
  payer: string;
  payTo: string;
  tx: string | null;
  explorer: string | null;
  borrowTxs: string[];
  approveTx: string | null;
  at: string;
  spentToday: string;
};

export type CallResult<T = unknown> = { data: T; receipt: Receipt };

export class AutonomoError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AutonomoError";
  }
}
const fail = (code: string, message: string): never => {
  throw new AutonomoError(message, code);
};

// ---------- x402 shapes ----------

type Accept = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};
type PaymentRequired = { x402Version: number; accepts: Accept[]; resource?: unknown; extensions?: unknown; error?: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = <T>(h: string | null): T | null => {
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
};
const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Finding the right API ----------

type Kind = "tx" | "address" | "url" | "text";
function kindOf(input: string | undefined): Kind | null {
  if (input === undefined) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) return "tx";
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return "address";
  if (/^https?:\/\//i.test(input)) return "url";
  return "text";
}
const placeholders = (path: string) => [...path.matchAll(/<([^>]+)>/g)].map((m) => m[1].toLowerCase());
function fits(path: string, kind: Kind | null): boolean {
  const ph = placeholders(path);
  if (kind === null) return ph.length === 0;
  if (ph.length !== 1) return false;
  const p = ph[0];
  if (kind === "tx") return /transaction|hash/.test(p);
  if (kind === "address") return /address/.test(p);
  if (kind === "url") return /url|link/.test(p);
  return !/address|hash|url|link/.test(p);
}
function fill(path: string, input: string | undefined): string {
  if (input === undefined) return path;
  return path.replace(/<([^>]+)>/, (_, p: string) => (/url-encoded|url|link/i.test(p) ? encodeURIComponent(input) : input));
}

/** Ranks APIs for a query and input: word matches first, then a fitting path, then verified and the track record. */
export function rankApis(apis: Api[], query: string, input?: string): Api[] {
  const words = query.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2);
  const kind = kindOf(input);
  const scored = apis
    .filter((a) => fits(a.path, kind))
    .map((a) => {
      const hay = `${a.slug} ${a.name} ${a.description}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      const trust = (a.verified ? 1 : 0) + (a.successRate ?? 0.5) + Math.min(a.paidCalls30d, 100) / 1000;
      return { a, hits, trust };
    })
    .filter((s) => s.hits > 0 || words.length === 0);
  return scored.sort((x, y) => y.hits - x.hits || y.trust - x.trust).map((s) => s.a);
}

// ---------- Spending ----------

export function fileStore(file = join(homedir(), ".autonomo", "spend.json")): SpendStore {
  const read = (): { date?: string; [k: string]: string | undefined } => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  return {
    get(day) {
      const s = read();
      if (s.date !== day) return {};
      return { usdg: BigInt(s.usdg ?? 0), autonomo: BigInt(s.autonomo ?? 0) };
    },
    add(day, token, amount) {
      const s = read();
      const cur = s.date === day ? s : { date: day };
      cur[token] = (BigInt(cur[token] ?? 0) + amount).toString();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(cur));
    },
  };
}

/** Keeps spending in memory only, for tests or short-lived agents. */
export function memoryStore(): SpendStore {
  const days = new Map<string, Partial<Record<TokenName, bigint>>>();
  return {
    get: (day) => ({ ...(days.get(day) ?? {}) }),
    add: (day, token, amount) => {
      const d = days.get(day) ?? {};
      d[token] = (d[token] ?? 0n) + amount;
      days.set(day, d);
    },
  };
}

// ---------- The client ----------

export class Autonomo {
  private readonly base: string;
  private readonly rpc: string;
  private readonly fetch: typeof fetch;
  private readonly account: PrivateKeyAccount | null;
  private readonly payWith: TokenName | "auto";
  private readonly perCall: Record<TokenName, bigint>;
  private readonly daily: Record<TokenName, bigint>;
  private readonly store: SpendStore;
  private readonly gloam?: { fetchPaid: GloamFetchPaid };
  private readonly borro?: { account: Hex; mcpUrl: string };
  private readonly chain = defineChain({
    id: CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  });

  constructor(opts: AutonomoOptions = {}) {
    this.base = (opts.baseUrl ?? "https://autonomo.fun").replace(/\/+$/, "");
    this.rpc = opts.rpcUrl ?? "https://rpc.mainnet.chain.robinhood.com";
    this.fetch = opts.fetch ?? globalThis.fetch;
    const key = opts.privateKey?.trim();
    if (key !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(key)) fail("bad_key", "privateKey should be 0x followed by 64 hex characters.");
    this.account = key ? privateKeyToAccount(key as Hex) : null;
    this.payWith = opts.payWith ?? "auto";
    const units = (t: TokenName, v: string | undefined, d: string) => parseUnits(v ?? d, TOKENS[t].decimals);
    this.perCall = {
      usdg: units("usdg", opts.limits?.perCall?.usdg, DEFAULT_LIMITS.perCall.usdg),
      autonomo: units("autonomo", opts.limits?.perCall?.autonomo, DEFAULT_LIMITS.perCall.autonomo),
    };
    this.daily = {
      usdg: units("usdg", opts.limits?.daily?.usdg, DEFAULT_LIMITS.daily.usdg),
      autonomo: units("autonomo", opts.limits?.daily?.autonomo, DEFAULT_LIMITS.daily.autonomo),
    };
    this.store = opts.spendStore ?? fileStore();
    this.gloam = opts.gloam;
    if (opts.borro) this.borro = { account: getAddress(opts.borro.account), mcpUrl: opts.borro.mcpUrl ?? BORRO_MCP };
  }

  /** The wallet that pays, or null when no key is set. */
  get address(): Hex | null {
    return this.account?.address ?? null;
  }

  /** Every Autonomo API, or the best matches for a query and input. Free. */
  async find(query = "", input?: string): Promise<Api[]> {
    const res = await this.get(`${this.base}/api/v1/gateways`);
    const body = (await res.json()) as { data: Array<Record<string, any>> };
    const apis: Api[] = body.data.map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description ?? "",
      path: g.usage ?? "/",
      price: g.price ?? {},
      verified: Boolean(g.verified),
      successRate: g.trackRecord?.successRate ?? null,
      paidCalls30d: g.trackRecord?.paidCalls ?? 0,
    }));
    return query || input !== undefined ? rankApis(apis, query, input) : apis;
  }

  /** What a call would cost, without paying. */
  async quote(query: string, opts: CallOptions = {}) {
    const { api, url } = await this.resolve(query, opts);
    const required = await this.priceList(url);
    return {
      api,
      url,
      offers: required.accepts.map((a) => {
        const t = tokenByAsset(a.asset);
        return { scheme: a.scheme, token: t?.symbol ?? a.asset, amount: formatUnits(BigInt(a.amount), t?.decimals ?? 18), private: a.scheme === "gloam-cashout" };
      }),
    };
  }

  /** Finds the right API, pays for one call and returns its answer with a receipt. */
  async call<T = unknown>(query: string, opts: CallOptions = {}): Promise<CallResult<T>> {
    if (!opts.private && !this.account) fail("no_wallet", "No wallet set. Pass privateKey (a wallet just for this agent).");
    const account = this.account as PrivateKeyAccount;
    const { api, url } = await this.resolve(query, opts);
    const required = await this.priceList(url);
    const day = today();
    const spent = await this.store.get(day);

    const pay = async (route: Route, token: Token, amount: bigint, send: () => Promise<{ res: Response; tx: string | null; extra?: Partial<Receipt> }>) => {
      const { res, tx, extra } = await send();
      if (res.status !== 200) {
        const reason = unb64<PaymentRequired>(res.headers.get("payment-required"))?.error;
        let detail = "";
        try {
          const j = (await res.clone().json()) as { message?: string; error?: string };
          detail = j.message ?? j.error ?? "";
        } catch {
          // Not JSON.
        }
        fail("payment_refused", reason ? `Payment refused: ${reason}` : `The API answered ${res.status}${detail ? `: ${detail}` : ""}. You aren't charged unless it settled.`);
      }
      await this.store.add(day, token.name, amount);
      const after = (await this.store.get(day))[token.name] ?? 0n;
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      const receipt: Receipt = {
        api: { slug: api.slug, name: api.name },
        url,
        route,
        amount: formatUnits(amount, token.decimals),
        token: token.symbol,
        payer: route === "gloam" ? "private (Gloam)" : account.address,
        payTo: "",
        tx,
        explorer: tx ? `${EXPLORER}/tx/${tx}` : null,
        borrowTxs: [],
        approveTx: null,
        at: new Date().toISOString(),
        spentToday: `${formatUnits(after, token.decimals)} of ${formatUnits(this.daily[token.name], token.decimals)} ${token.symbol}`,
        ...extra,
      };
      return { data: data as T, receipt };
    };

    const within = (token: Token, amount: bigint) => {
      const price = `${formatUnits(amount, token.decimals)} ${token.symbol}`;
      if (amount > this.perCall[token.name]) return `${price} is above the per-call cap of ${formatUnits(this.perCall[token.name], token.decimals)} ${token.symbol}`;
      const sofar = spent[token.name] ?? 0n;
      if (sofar + amount > this.daily[token.name]) return `${price} would pass today's ${token.symbol} budget (${formatUnits(sofar, token.decimals)} of ${formatUnits(this.daily[token.name], token.decimals)} spent)`;
      return null;
    };

    // Private: Gloam only.
    if (opts.private) {
      const gloam = this.gloam ?? fail("no_gloam", "private: true needs Gloam set up (options.gloam.fetchPaid).");
      const offer = required.accepts.find((a) => a.scheme === "gloam-cashout") ?? fail("no_private_option", `${api.name} doesn't offer private payment.`);
      const amount = BigInt(offer.amount);
      const why = within(TOKENS.usdg, amount);
      if (why) fail("over_limit", `Not paid: ${why}.`);
      // Gloam asks for its own quote, whose tag can differ by under 0.001 USDG; never more than the per-call cap.
      const most = amount + 1000n < this.perCall.usdg ? amount + 1000n : this.perCall.usdg;
      return pay("gloam", TOKENS.usdg, amount, async () => {
        const r = await gloam.fetchPaid({ url, maxAmount: Number(formatUnits(most, 6)), prefer: "gloam-cashout" });
        if (r.status === "paid_not_served") {
          await this.store.add(day, "usdg", amount);
          fail("paid_not_served", `Paid through Gloam, but the API didn't answer yet: ${r.message ?? ""} Retry gloam_fetch_paid with this paymentHeader, don't pay again: ${r.paymentHeader ?? "(none)"}`);
        }
        if (r.status !== "ok") fail("payment_refused", `Gloam didn't pay: ${r.message ?? r.error ?? r.code ?? r.status}`);
        const res = new Response(r.body ?? "", { status: r.httpStatus ?? 200 });
        return { res, tx: r.hash ?? null, extra: { payTo: getAddress(offer.payTo) } };
      });
    }

    // Public: the wallet's tokens, then Borro.
    const want = opts.payWith ?? this.payWith;
    const order: TokenName[] = want === "auto" ? ["usdg", "autonomo"] : [want];
    const reasons: string[] = [];
    const pub = createPublicClient({ chain: this.chain, transport: http(this.rpc) });
    let usdgShort: { offer: Accept; amount: bigint } | null = null;

    for (const name of order) {
      const token = TOKENS[name];
      const offer = required.accepts.find((a) => a.scheme === "exact" && a.network === NETWORK && sameAddr(a.asset, token.address));
      if (!offer) {
        reasons.push(`${api.name} doesn't take ${token.symbol}`);
        continue;
      }
      const amount = BigInt(offer.amount);
      const why = within(token, amount);
      if (why) {
        reasons.push(why);
        continue;
      }
      const balance = await pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      if (balance < amount) {
        reasons.push(`the wallet holds ${formatUnits(balance, token.decimals)} ${token.symbol}, the call costs ${formatUnits(amount, token.decimals)}`);
        if (name === "usdg") usdgShort = { offer, amount };
        continue;
      }
      return pay(name, token, amount, () => this.payExact(url, required, offer, account, pub));
    }

    if (this.borro && usdgShort) {
      const { offer, amount } = usdgShort;
      const borrowTxs = await this.borrow(url, offer, account, pub);
      return pay("borro", TOKENS.usdg, amount, async () => {
        const r = await this.payExact(url, required, offer, account, pub);
        return { ...r, extra: { ...r.extra, borrowTxs: borrowTxs.map((h) => `${EXPLORER}/tx/${h}`) } };
      });
    }
    return fail("cannot_pay", `Not paid: ${reasons.join("; ")}.`);
  }

  // ---------- Internals ----------

  private async get(url: string, timeout = 15_000) {
    const res = await this.fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (res.status === 503) fail("updating", "Autonomo is being updated right now. Try again in a few minutes.");
    if (!res.ok) fail("http_error", `${new URL(url).pathname} answered ${res.status}.`);
    return res;
  }

  private gatewayUrl(slug: string, path: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) fail("bad_slug", "slug should look like token-risk.");
    const p = path.startsWith("/") ? path : `/${path}`;
    if (p.includes("..") || p.startsWith("//") || /[\s\\<>]/.test(p)) fail("bad_path", `The path ${p} isn't a plain, filled-in path.`);
    const url = new URL(`${this.base}/x/${slug}${p}`);
    if (url.origin !== new URL(this.base).origin || !(url.pathname === `/x/${slug}` || url.pathname.startsWith(`/x/${slug}/`))) {
      fail("bad_path", "That path leaves the API.");
    }
    return url.toString();
  }

  private async resolve(query: string, opts: CallOptions): Promise<{ api: Api; url: string }> {
    if (opts.slug) {
      const apis = await this.find();
      const api = apis.find((a) => a.slug === opts.slug) ?? fail("not_found", `No Autonomo API called ${opts.slug}.`);
      return { api, url: this.gatewayUrl(api.slug, opts.path ?? fill(api.path, opts.input)) };
    }
    const [api] = await this.find(query, opts.input);
    if (!api) {
      const kind = kindOf(opts.input);
      fail("not_found", `No Autonomo API matches "${query}"${kind && kind !== "text" ? ` for a ${kind}` : ""}. Use find() to see them all.`);
    }
    return { api, url: this.gatewayUrl(api.slug, opts.path ?? fill(api.path, opts.input)) };
  }

  private async priceList(url: string): Promise<PaymentRequired> {
    const res = await this.fetch(url, { signal: AbortSignal.timeout(20_000) });
    let required = unb64<PaymentRequired>(res.headers.get("payment-required"));
    if (!required && res.status === 402) {
      try {
        required = (await res.json()) as PaymentRequired;
      } catch {
        required = null;
      }
    } else {
      await res.body?.cancel();
    }
    if (res.status === 503) fail("updating", "This API is paused or being updated. Try again later.");
    if (res.status !== 402 || !Array.isArray(required?.accepts)) fail("no_price", `Expected a 402 price list from ${url}, got ${res.status}.`);
    return required!;
  }

  /** Signs an x402 exact payment (EIP-3009 for USDG, Permit2 for $AUTONOMO) and sends the request with it. */
  private async payExact(url: string, required: PaymentRequired, offer: Accept, account: PrivateKeyAccount, pub: ReturnType<typeof createPublicClient>) {
    let approveTx: string | null = null;
    const now = Math.floor(Date.now() / 1000);
    const timeout = offer.maxTimeoutSeconds ?? 300;
    let payload: Record<string, unknown>;

    if (offer.extra?.assetTransferMethod === "permit2") {
      const allowance = await pub.readContract({ address: getAddress(offer.asset), abi: erc20Abi, functionName: "allowance", args: [account.address, PERMIT2] });
      if (allowance < BigInt(offer.amount)) {
        const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.rpc) });
        const hash = await wallet.writeContract({ address: getAddress(offer.asset), abi: erc20Abi, functionName: "approve", args: [PERMIT2, maxUint256] });
        await pub.waitForTransactionReceipt({ hash });
        approveTx = `${EXPLORER}/tx/${hash}`;
      }
      const auth = {
        from: account.address,
        permitted: { token: getAddress(offer.asset), amount: offer.amount },
        spender: PERMIT2_PROXY,
        nonce: BigInt(randomHex(32)).toString(),
        deadline: String(now + timeout),
        witness: { to: getAddress(offer.payTo), validAfter: "0" },
      };
      const signature = await account.signTypedData(permit2TypedData(auth));
      payload = { signature, permit2Authorization: auth };
    } else {
      const name = offer.extra?.name as string | undefined;
      const version = offer.extra?.version as string | undefined;
      if (!name || !version) fail("bad_offer", "The price list is missing the token's EIP-712 name and version.");
      const auth = {
        from: account.address,
        to: getAddress(offer.payTo),
        value: offer.amount,
        validAfter: "0",
        validBefore: String(now + timeout),
        nonce: randomHex(32),
      };
      const signature = await account.signTypedData(eip3009TypedData(auth, offer.asset, name!, version!));
      payload = { authorization: auth, signature };
    }

    const envelope =
      required.x402Version === 1
        ? { x402Version: 1, scheme: offer.scheme, network: offer.network, payload }
        : { x402Version: required.x402Version, payload, extensions: required.extensions, resource: required.resource, accepted: offer };
    const header = b64(JSON.stringify(envelope));
    const res = await this.fetch(url, {
      headers: required.x402Version === 1 ? { "X-PAYMENT": header } : { "PAYMENT-SIGNATURE": header },
      signal: AbortSignal.timeout(60_000),
    });
    const settled = unb64<{ transaction?: string }>(res.headers.get("payment-response") ?? res.headers.get("x-payment-response"));
    return { res, tx: settled?.transaction ?? null, extra: { approveTx, payTo: getAddress(offer.payTo) } as Partial<Receipt> };
  }

  /** Asks Borro for the borrow that covers what the wallet is short, sends it and waits for the USDG to land. */
  private async borrow(url: string, offer: Accept, account: PrivateKeyAccount, pub: ReturnType<typeof createPublicClient>): Promise<Hex[]> {
    const borro = this.borro!;
    const required = await this.priceList(url);
    const raw = b64(JSON.stringify(required));
    const result = await mcpCall(this.fetch, borro.mcpUrl, "credit_bill", {
      wallet: account.address,
      account: borro.account,
      payment_required: raw,
      max_usdg: formatUnits(this.perCall.usdg, 6),
    });
    const txs = findTransactions(result);
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.rpc) });
    const hashes: Hex[] = [];
    for (const t of txs) {
      const hash = await wallet.sendTransaction({ to: getAddress(t.to), data: t.data as Hex, value: t.value ? BigInt(t.value) : 0n });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") fail("borrow_failed", `Borro's borrow transaction failed: ${EXPLORER}/tx/${hash}`);
      hashes.push(hash);
    }
    const need = BigInt(offer.amount);
    for (let i = 0; i < 20; i++) {
      const bal = await pub.readContract({ address: TOKENS.usdg.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      if (bal >= need) return hashes;
      await sleep(1000);
    }
    return fail("borrow_failed", "The borrowed USDG hasn't reached the wallet yet. Nothing was paid; try again shortly.");
  }
}

// ---------- Helpers ----------

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const tokenByAsset = (asset: string) => Object.values(TOKENS).find((t) => sameAddr(t.address, asset));

export function eip3009TypedData(
  auth: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string },
  asset: string,
  name: string,
  version: string,
) {
  return {
    domain: { name, version, chainId: CHAIN_ID, verifyingContract: getAddress(asset) },
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
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as Hex,
    },
  };
}

export function permit2TypedData(auth: {
  permitted: { token: string; amount: string };
  spender: string;
  nonce: string;
  deadline: string;
  witness: { to: string; validAfter: string };
}) {
  return {
    domain: { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2 as Hex },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Witness" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Witness: [
        { name: "to", type: "address" },
        { name: "validAfter", type: "uint256" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: getAddress(auth.permitted.token), amount: BigInt(auth.permitted.amount) },
      spender: getAddress(auth.spender),
      nonce: BigInt(auth.nonce),
      deadline: BigInt(auth.deadline),
      witness: { to: getAddress(auth.witness.to), validAfter: BigInt(auth.witness.validAfter) },
    },
  };
}

/** Calls one tool on an MCP server over plain JSON-RPC and returns its result, parsed from JSON when it's JSON. */
async function mcpCall(f: typeof fetch, url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  let text = await res.text();
  if (text.startsWith("event:") || text.startsWith("data:")) {
    text = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
  }
  let body: { result?: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: unknown }; error?: { message?: string } };
  try {
    body = JSON.parse(text);
  } catch {
    return fail("borro_error", `Borro answered ${res.status}.`);
  }
  if (body.error) fail("borro_error", `Borro: ${body.error.message ?? "error"}`);
  const out = body.result?.content?.map((c) => c.text ?? "").join("") ?? "";
  if (body.result?.isError) fail("borro_refused", `Borro: ${out}`);
  if (body.result?.structuredContent) return body.result.structuredContent;
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

/** Every transaction ({ to, data }) inside a tool result, in order. */
export function findTransactions(value: unknown): Array<{ to: string; data: string; value?: string }> {
  const out: Array<{ to: string; data: string; value?: string }> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.to === "string" && /^0x[0-9a-fA-F]{40}$/.test(o.to) && typeof o.data === "string" && /^0x[0-9a-fA-F]*$/.test(o.data) && o.data.length > 2) {
      out.push({ to: o.to, data: o.data, value: o.value === undefined || o.value === null ? undefined : String(o.value) });
      return;
    }
    // Skip the typed data to sign: its "message" holds from/to/value but no calldata.
    Object.entries(o).forEach(([k, x]) => k !== "typed_data" && walk(x));
  };
  walk(value);
  return out;
}
