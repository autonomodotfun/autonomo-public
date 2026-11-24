// Which shelf each API lands on. Run: npx tsx --test src/lib/directory/api-shelves.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { shelfOf, shelve } from "@/lib/directory/api-shelves";
import { OFFICIAL_OWNER } from "@/lib/directory/track-record";

const CREATOR = "0xdf129a523aeb072a2cecba50170eab2fcb183c4c";

test("Autonomo's own APIs go on their listed shelf", () => {
  assert.equal(shelfOf({ slug: "safe-swap", owner: OFFICIAL_OWNER }), "tokens");
  assert.equal(shelfOf({ slug: "ostrapad-offer-finder", owner: OFFICIAL_OWNER }), "partners");
  assert.equal(shelfOf({ slug: "something-new", owner: OFFICIAL_OWNER }), "other");
});

test("a list without owners is treated as Autonomo's", () => {
  assert.equal(shelfOf({ slug: "token-risk" }), "tokens");
  assert.equal(shelfOf({ slug: "something-new" }), "other");
});

test("an API another team owns is a creator API, even with an official slug", () => {
  assert.equal(shelfOf({ slug: "stoa-quote", owner: CREATOR }), "creators");
  assert.equal(shelfOf({ slug: "token-risk", owner: CREATOR }), "creators");
  assert.equal(shelfOf({ slug: "stoa-quote", owner: CREATOR.toUpperCase().replace("0X", "0x") }), "creators");
  assert.equal(shelfOf({ slug: "token-risk", owner: OFFICIAL_OWNER.toUpperCase().replace("0X", "0x") }), "tokens");
});

test("creator APIs come last, in the order they came in", () => {
  const apis = [
    { slug: "stoa-safety", owner: CREATOR },
    { slug: "token-lookup", owner: OFFICIAL_OWNER },
    { slug: "stoa-quote", owner: CREATOR },
    { slug: "safe-swap", owner: OFFICIAL_OWNER },
  ];
  const shelves = shelve(apis);
  assert.deepEqual(shelves.map((s) => s.shelf.id), ["tokens", "creators"]);
  assert.deepEqual(shelves[0].apis.map((a) => a.slug), ["token-lookup", "safe-swap"]);
  assert.deepEqual(shelves[1].apis.map((a) => a.slug), ["stoa-safety", "stoa-quote"]);
});

test("a retired official API is left off the shelves while its gateway still answers", () => {
  const apis = [
    { slug: "token-price", owner: OFFICIAL_OWNER },
    { slug: "token-lookup", owner: OFFICIAL_OWNER },
  ];
  assert.deepEqual(shelve(apis).flatMap((s) => s.apis.map((a) => a.slug)), ["token-lookup"]);
  assert.deepEqual(shelve([{ slug: "token-price" }]), [], "the docs list, without owners, too");
});
