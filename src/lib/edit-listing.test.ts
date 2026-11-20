// Offline tests for the listing edit form's checks: no database.
// Run: npx tsx --conditions=react-server --test src/lib/edit-listing.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseListingFields } from "@/lib/edit-listing";

const blank = { description: "A listing.", website: "", docs: "", github: "", twitter: "", logoUrl: "" };

test("valid fields are kept and tidied", () => {
  const r = parseListingFields({
    description: "  One MCP   for agents.\n",
    website: "https://qhooks.com",
    docs: "https://qhooks.com/skill.md",
    github: "",
    twitter: "https://x.com/qHooks_",
    logoUrl: "/qhooks-logo.jpg",
  });
  assert.ok(r.ok);
  assert.deepEqual(r.fields, {
    description: "One MCP for agents.",
    website: "https://qhooks.com/",
    docs: "https://qhooks.com/skill.md",
    github: null,
    twitter: "qHooks_",
    logoUrl: "/qhooks-logo.jpg",
  });
});

test("an X handle is accepted with or without @ or a link", () => {
  for (const t of ["qHooks_", "@qHooks_", "https://twitter.com/qHooks_", "https://www.x.com/qHooks_/"]) {
    const r = parseListingFields({ ...blank, twitter: t });
    assert.ok(r.ok, t);
    assert.equal(r.fields.twitter, "qHooks_", t);
  }
});

test("logos are a site path to an image or an https address", () => {
  assert.ok(parseListingFields({ ...blank, logoUrl: "https://cdn.example.com/logo.png" }).ok);
  for (const bad of ["/../secret.png", "/logo", "javascript:alert(1)", "http://example.com/logo.png", "data:image/png;base64,AAAA"]) {
    assert.equal(parseListingFields({ ...blank, logoUrl: bad }).ok, false, bad);
  }
});

test("links must be https, and the description has a limit", () => {
  assert.equal(parseListingFields({ ...blank, website: "http://qhooks.com" }).ok, false);
  assert.equal(parseListingFields({ ...blank, docs: "not a url" }).ok, false);
  assert.equal(parseListingFields({ ...blank, twitter: "not a handle!" }).ok, false);
  assert.equal(parseListingFields({ ...blank, description: "x".repeat(1001) }).ok, false);
});
