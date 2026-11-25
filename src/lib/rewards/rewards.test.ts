// The rewards' rules and their rows in the database. The database here is a real Postgres running in memory (PGlite)
// with every migration applied, so the SQL is the SQL production runs. No network.
// Run: npx tsx --test src/lib/rewards/rewards.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, type DB } from "@/db";
import { REWARDS, RESERVED_REF_CODES, countingWindow, holdTokensFor, monthOf, normalizeRefCode, refCodeError, vestedBy } from "@/lib/rewards/rewards-rules";
import { refCodeOf, refCodeWallet, registerRefCode, saveRewardsCall, walletCounts } from "@/lib/rewards/rewards-store";

let database: Promise<DB> | undefined;
/** One in-memory Postgres for the whole file, migrated the way `npm run db:migrate` does it. */
function testDb() {
  database ??= (async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    return db as unknown as DB;
  })();
  return database;
}

// Every test uses its own wallets, codes and payments, so they can share the one database.
let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "a")}`;
const tx = () => `0x${(++n).toString(16).padStart(64, "0")}`;
const code = () => `CODE${++n}`;

// ---------- the rules ----------

test("the split adds up, and no call can pay more in rewards than it cost for good", () => {
  const { split } = REWARDS;
  assert.equal(split.creators + split.integrators + split.cashback + split.burn, 100);
  // A creator's API: 5% of the payment is burned for good.
  assert.ok(REWARDS.creatorRate + REWARDS.integratorRateExternal < 0.05, "creator and integrator rewards stay under the burn");
  // An official API: the whole payment goes to Autonomo.
  assert.ok(REWARDS.cashbackRate + REWARDS.integratorRateOfficial < 1, "cashback and integrator rewards stay under the price");
});

test("a ref code is 3 to 20 letters or digits, stored in upper case", () => {
  assert.equal(normalizeRefCode(" oak1 "), "OAK1");
  assert.equal(normalizeRefCode("MyAgent"), "MYAGENT");
  assert.equal(normalizeRefCode("ab"), null, "too short");
  assert.equal(normalizeRefCode("a".repeat(21)), null, "too long");
  assert.equal(normalizeRefCode("my-agent"), null);
  assert.equal(normalizeRefCode("my agent"), null);
  assert.equal(normalizeRefCode("año"), null, "plain letters only");
  assert.equal(normalizeRefCode(""), null);
  assert.equal(normalizeRefCode(null), null);
  assert.equal(normalizeRefCode(undefined), null);
});

test("our own and our partners' names can't be registered", () => {
  for (const name of ["oak", "Autonomo", "ELIZA", "priors"]) assert.match(refCodeError(name) ?? "", /reserved/);
  assert.match(refCodeError("a b") ?? "", /3 to 20 letters or digits/);
  assert.equal(refCodeError("myagent"), null);
  for (const reserved of RESERVED_REF_CODES) assert.equal(normalizeRefCode(reserved), reserved, `${reserved} is itself a valid code`);
});

test("a holding minimum is a round number of tokens", () => {
  assert.equal(holdTokensFor(25, 0.00014), 180_000); // 178,571
  assert.equal(holdTokensFor(75, 0.00014), 540_000); // 535,714
  assert.equal(holdTokensFor(25, 1), 10_000, "never under 10,000");
  assert.throws(() => holdTokensFor(25, 0));
  assert.throws(() => holdTokensFor(0, 0.0001));
});

test("calls count from December 1, 2026, month by month in UTC", () => {
  const at = (iso: string) => Date.parse(iso);
  const nov = countingWindow(at("2026-11-25T10:00:00Z"));
  assert.equal(nov.started, false);
  assert.equal(nov.from.toISOString(), "2026-12-01T00:00:00.000Z", "nothing in November is in the window");
  const dec = countingWindow(at("2026-12-01T00:00:00Z"));
  assert.deepEqual([dec.started, dec.from.toISOString(), dec.to.toISOString()], [true, "2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  const jan = countingWindow(at("2027-01-31T23:59:59Z"));
  assert.deepEqual([jan.from.toISOString(), jan.to.toISOString()], ["2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]);
  assert.equal(monthOf(at("2027-12-31T23:59:59Z")).end.toISOString(), "2028-01-01T00:00:00.000Z", "December rolls into the next year");
});

test("the vesting releases nothing before its start, everything after its end, and a straight line between", () => {
  const total = 10_000_000n;
  const start = 1_796_083_200; // December 1, 2026
  const duration = 180 * 86_400;
  assert.equal(vestedBy(total, start, duration, start - 1), 0n);
  assert.equal(vestedBy(total, start, duration, start), 0n);
  assert.equal(vestedBy(total, start, duration, start + duration / 2), 5_000_000n);
  assert.equal(vestedBy(total, start, duration, start + 31 * 86_400), 1_722_222n, "the first, 31-day month");
  assert.equal(vestedBy(total, start, duration, start + duration), total);
  assert.equal(vestedBy(total, start, duration, start + 10 * duration), total);
});

// ---------- ref codes ----------

test("a wallet registers one code, and a code belongs to one wallet", async () => {
  const db = await testDb();
  const [a, b] = [wallet(), wallet()];
  const mine = code();
  assert.equal(await refCodeOf(db, a), null);
  assert.deepEqual(await registerRefCode(db, a.toUpperCase().replace("0X", "0x"), ` ${mine.toLowerCase()} `), { ok: true, code: mine });
  assert.equal(await refCodeWallet(db, mine), a, "the wallet is kept in lower case");
  assert.equal(await refCodeOf(db, a), mine);
  assert.deepEqual(await registerRefCode(db, a, mine), { ok: true, code: mine }, "registering the same code again changes nothing");

  const taken = await registerRefCode(db, b, mine);
  assert.deepEqual(taken, { ok: false, error: "That code is taken." });
  const second = await registerRefCode(db, a, code());
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, new RegExp(`already has the code ${mine}`));
  assert.equal(await refCodeOf(db, b), null);

  assert.equal((await registerRefCode(db, b, "oak")).ok, false, "a reserved name");
  assert.equal((await registerRefCode(db, b, "no")).ok, false, "too short");
  assert.equal(await refCodeWallet(db, "NOBODY"), null);
});

test("two wallets asking for the same code at the same moment: one gets it", async () => {
  const db = await testDb();
  const wanted = code();
  const wallets = Array.from({ length: 8 }, wallet);
  const results = await Promise.all(wallets.map((w) => registerRefCode(db, w, wanted)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(wallets.includes((await refCodeWallet(db, wanted))!));
});

// ---------- what is counted ----------

async function api(db: DB, owner: string, payTo: string | null = null) {
  const [row] = await db
    .insert(schema.gateways)
    .values({ slug: `api-${++n}`, owner, payTo, name: "Test API", upstreamUrl: "https://example.com", priceUsd: "0.01" })
    .returning({ id: schema.gateways.id });
  return row.id;
}

const DEC = new Date("2026-12-10T12:00:00Z");
const WINDOW = [new Date("2026-12-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")] as const;

test("a payment is noted once, and a wallet's month is counted from the notes", async () => {
  const db = await testDb();
  const [agent, integrator, creator, safe, other] = [wallet(), wallet(), wallet(), wallet(), wallet()];
  const mine = code();
  assert.equal((await registerRefCode(db, integrator, mine)).ok, true);
  const official = await api(db, wallet());
  const creators = await api(db, creator, safe);
  const note = (o: { gatewayId: number; payer: string; official: boolean; refCode?: string | null; pass?: boolean | null; at?: Date }) =>
    saveRewardsCall(db, { gatewayId: o.gatewayId, tx: tx(), payer: o.payer, official: o.official, refCode: o.refCode ?? null, payerHasPass: o.pass ?? false, passMinTokens: 180_000, at: o.at ?? DEC });

  // The agent pays official APIs: twice with the pass, once without, once when the pass couldn't be read.
  await note({ gatewayId: official, payer: agent.toUpperCase().replace("0X", "0x"), official: true, pass: true, refCode: mine });
  await note({ gatewayId: official, payer: agent, official: true, pass: true, refCode: mine });
  await note({ gatewayId: official, payer: agent, official: true, pass: false });
  await note({ gatewayId: official, payer: agent, official: true, pass: null });
  // Outside the month, and to a creator's API: neither counts as an official call of December.
  await note({ gatewayId: official, payer: agent, official: true, pass: true, at: new Date("2026-11-30T23:59:59Z") });
  await note({ gatewayId: creators, payer: agent, official: false, pass: true, refCode: mine });
  // Others pay the creator's API. Its own two wallets paying it are left out.
  await note({ gatewayId: creators, payer: other, official: false, refCode: mine });
  await note({ gatewayId: creators, payer: creator, official: false });
  await note({ gatewayId: creators, payer: safe, official: false });
  // The integrator's own wallet using its own code doesn't count as a call it brought.
  await note({ gatewayId: official, payer: integrator, official: true, refCode: mine });

  const asAgent = await walletCounts(db, agent, null, ...WINDOW);
  assert.deepEqual(asAgent, { paid: { officialCalls: 4, withPass: 2 }, brought: null, earned: null });

  const asIntegrator = await walletCounts(db, integrator.toUpperCase().replace("0X", "0x"), mine, ...WINDOW);
  assert.deepEqual(asIntegrator.brought, { calls: 4, payers: 2 }, "the agent three times and one other wallet, not itself");
  assert.equal(asIntegrator.earned, null, "it has launched no API");

  for (const owner of [creator, safe]) {
    const asCreator = await walletCounts(db, owner, null, ...WINDOW);
    assert.deepEqual(asCreator.earned, { calls: 2, payers: 2 }, "the agent and the other wallet, found by the owner or by the wallet it is paid at");
  }

  assert.deepEqual(await walletCounts(db, wallet(), null, ...WINDOW), { paid: { officialCalls: 0, withPass: 0 }, brought: null, earned: null });
});

test("the same payment sent twice leaves one note", async () => {
  const db = await testDb();
  const payer = wallet();
  const gatewayId = await api(db, wallet());
  const payment = tx();
  const call = { gatewayId, tx: payment, payer, official: true, refCode: null, payerHasPass: true, passMinTokens: 180_000, at: DEC };
  await Promise.all(Array.from({ length: 10 }, () => saveRewardsCall(db, call)));
  await saveRewardsCall(db, { ...call, tx: payment.toUpperCase().replace("0X", "0x"), payerHasPass: false });
  assert.deepEqual((await walletCounts(db, payer, null, ...WINDOW)).paid, { officialCalls: 1, withPass: 1 }, "the first note is kept as it was");
});
