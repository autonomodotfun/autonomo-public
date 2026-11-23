// The directory's topics and price bands. Run: npx tsx --test src/lib/topics.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { PRICE_BANDS, priceBand, topic, TOPICS, topicTsQuery } from "@/lib/topics";

test("every topic has its own id, a label, words and tags", () => {
  assert.equal(new Set(TOPICS.map((t) => t.id)).size, TOPICS.length);
  for (const t of TOPICS) {
    assert.ok(t.label && t.words.length && t.tags.length, t.id);
    assert.match(t.id, /^[a-z]+$/);
  }
});

test("words and tags are lowercase and safe to put in a text-search query", () => {
  for (const t of TOPICS) {
    for (const w of t.words) assert.match(w, /^[a-z0-9]+$/, `${t.id}: ${w}`);
    for (const tag of t.tags) assert.equal(tag, tag.toLowerCase());
  }
});

test("a topic's query is its words joined by or", () => {
  assert.equal(topicTsQuery({ id: "x", label: "X", words: ["llm", "gpt"], tags: [] }), "llm | gpt");
});

test("an unknown topic or price band is ignored", () => {
  assert.equal(topic("nope"), undefined);
  assert.equal(topic(undefined), undefined);
  assert.equal(priceBand("free"), undefined);
  assert.equal(topic("crypto")?.label, "Crypto and tokens");
});

test("price bands cover every price once, in order", () => {
  assert.equal(PRICE_BANDS[0].over, null);
  assert.equal(PRICE_BANDS.at(-1)?.upTo, null);
  for (let i = 1; i < PRICE_BANDS.length; i++) assert.equal(PRICE_BANDS[i].over, PRICE_BANDS[i - 1].upTo);
});
