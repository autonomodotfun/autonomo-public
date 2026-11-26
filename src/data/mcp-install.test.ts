import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cursorDeeplink, cursorWebLink, MCP_SERVER_ENTRY, MCP_SERVER_NAME } from "./mcp-install";

const configOf = (link: string) => new URL(link).searchParams.get("config") ?? "";

test("the Cursor link carries the server's entry, and nothing else", () => {
  for (const link of [cursorDeeplink(), cursorWebLink()]) {
    assert.equal(new URL(link).searchParams.get("name"), MCP_SERVER_NAME);
    const entry = JSON.parse(Buffer.from(configOf(link), "base64").toString("utf8"));
    assert.deepEqual(entry, MCP_SERVER_ENTRY);
    assert.equal("env" in entry, false, "no wallet key or other setting travels in the link");
  }
});

test("the link has the shape Cursor's docs give", () => {
  assert.match(cursorDeeplink(), /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=autonomo&config=[A-Za-z0-9]+=*$/);
  assert.match(cursorWebLink(), /^https:\/\/cursor\.com\/install-mcp\?name=autonomo&config=[A-Za-z0-9]+=*$/);
});

test("the MCP README's Add to Cursor link is the same link", () => {
  const readme = readFileSync("mcp/README.md", "utf8");
  assert.ok(readme.includes(`](${cursorWebLink()})`), "mcp/README.md should link to cursorWebLink()");
});
