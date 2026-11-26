import assert from "node:assert/strict";
import { test } from "node:test";
import { GLOAM_VAULT } from "@/lib/payments/gloam-check";
import { summarizeThanks, thanksBannerOn, THANKS_BANNER } from "./thanks";

const OWNER = "0x00000000000000000000000000000000000000a1";
const SPLITTER = "0x00000000000000000000000000000000000000a2";
const CREATOR = "0x00000000000000000000000000000000000000b1";
const ALICE = "0x00000000000000000000000000000000000000c1";
const BOB = "0x00000000000000000000000000000000000000c2";
const TEAM = "0x00000000000000000000000000000000000000d1";

const gateways = [
  { id: 1, owner: OWNER, payTo: SPLITTER },
  { id: 2, owner: OWNER, payTo: SPLITTER },
  { id: 3, owner: CREATOR, payTo: null },
];

test("a wallet that paid several APIs is one payer, and coming back means two different days", () => {
  const t = summarizeThanks(
    gateways,
    [
      { gatewayId: 1, payer: ALICE, day: "2026-11-03", calls: 2 },
      { gatewayId: 2, payer: ALICE.toUpperCase().replace("0X", "0x"), day: "2026-11-03", calls: 1 },
      { gatewayId: 3, payer: ALICE, day: "2026-11-09", calls: 1 },
      { gatewayId: 1, payer: BOB, day: "2026-11-05", calls: 4 },
    ],
    [
      { gatewayId: 1, settled: 6, first: "2026-11-03T10:00:00Z" },
      { gatewayId: 2, settled: 1, first: "2026-11-03T12:00:00Z" },
      { gatewayId: 3, settled: 1, first: "2026-11-09T08:00:00Z" },
    ],
    new Set(),
  );
  assert.equal(t.payers, 2);
  assert.equal(t.cameBack, 1, "only Alice paid on two different days");
  assert.equal(t.paidCalls, 8);
  assert.equal(t.firstPaidAt, "2026-11-03T10:00:00.000Z");
  assert.equal(t.apis, 3);
  assert.equal(t.creators, 2);
});

test("an API's own wallets, the team's test wallets and Gloam's vault are not payers", () => {
  const t = summarizeThanks(
    gateways,
    [
      { gatewayId: 1, payer: OWNER, day: "2026-11-03", calls: 5 },
      { gatewayId: 1, payer: SPLITTER, day: "2026-11-03", calls: 1 },
      { gatewayId: 1, payer: TEAM, day: "2026-11-04", calls: 3 },
      { gatewayId: 1, payer: GLOAM_VAULT, day: "2026-11-04", calls: 2 },
      { gatewayId: 2, payer: GLOAM_VAULT.toLowerCase(), day: "2026-11-05", calls: 1 },
    ],
    [{ gatewayId: 1, settled: 11, first: new Date("2026-11-03T00:00:00Z") }],
    new Set([TEAM]),
  );
  assert.equal(t.payers, 0);
  assert.equal(t.cameBack, 0);
  assert.equal(t.privateCalls, 3, "private calls are counted as calls, not as wallets");
  assert.equal(t.paidCalls, 11, "their payments still settled, so they are paid calls");
});

test("a creator paying another creator's API is an outside payer there", () => {
  const t = summarizeThanks(gateways, [{ gatewayId: 3, payer: OWNER, day: "2026-11-10", calls: 1 }], [], new Set());
  assert.equal(t.payers, 1);
});

test("calls to a gateway that isn't listed any more are left out", () => {
  const t = summarizeThanks(
    gateways,
    [{ gatewayId: 99, payer: ALICE, day: "2026-11-03", calls: 7 }],
    [{ gatewayId: 99, settled: 7, first: "2026-11-01T00:00:00Z" }],
    new Set(),
  );
  assert.deepEqual([t.payers, t.paidCalls, t.firstPaidAt], [0, 0, null]);
});

test("with nothing paid yet, everything is zero", () => {
  assert.deepEqual(summarizeThanks([], [], [], new Set()), { paidCalls: 0, payers: 0, cameBack: 0, privateCalls: 0, apis: 0, creators: 0, firstPaidAt: null });
});

test("the homepage line shows from Thanksgiving through the Monday after, UTC", () => {
  assert.equal(new Date(THANKS_BANNER.from).toISOString(), "2026-11-26T00:00:00.000Z");
  assert.equal(new Date(THANKS_BANNER.from).getUTCDay(), 4, "Thanksgiving is a Thursday");
  assert.equal(thanksBannerOn(Date.UTC(2026, 10, 25, 23, 59)), false);
  assert.equal(thanksBannerOn(Date.UTC(2026, 10, 26, 0, 0)), true);
  assert.equal(thanksBannerOn(Date.UTC(2026, 10, 30, 23, 59)), true);
  assert.equal(thanksBannerOn(Date.UTC(2026, 11, 1, 0, 0)), false);
});
