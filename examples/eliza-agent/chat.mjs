// A small elizaOS 2.x agent with the Autonomo plugin, for one live test of the plugin before it's published.
//
//   npm run check                                   no keys: the plugin loads and a price check works, nothing paid
//   npm run chat -- "Is this token safe? 0x…"       one message to the agent, with a real model; it may pay
//
// The keys come from .env (see .env.example) and are never printed. elizaOS saves an agent's secrets in its database,
// so each run gets a new database in a temporary folder, deleted when the run ends: the wallet key isn't left on disk.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime, ChannelType, createMessageMemory, stringToUuid } from "@elizaos/core";
import sqlPlugin from "@elizaos/plugin-sql";
import { autonomoPlugin } from "elizaos-plugin-autonomo";

const check = process.argv.includes("--check");
const text = process.argv.slice(2).filter((a) => a !== "--check").join(" ").trim();

const SETTINGS = [
  "AUTONOMO_WALLET_KEY",
  "AUTONOMO_PAY_WITH",
  "AUTONOMO_MAX_USDG_PER_CALL",
  "AUTONOMO_DAILY_USDG",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_SMALL_MODEL",
  "ANTHROPIC_LARGE_MODEL",
];
const secrets = Object.fromEntries(SETTINGS.filter((k) => process.env[k]?.trim()).map((k) => [k, process.env[k].trim()]));
// A low daily budget for this test, unless .env sets one.
secrets.AUTONOMO_DAILY_USDG ??= "0.05";

const dataDir = mkdtempSync(join(tmpdir(), "autonomo-eliza-"));
const done = async (runtime, code) => {
  await runtime?.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
};

const character = {
  name: "Scout",
  bio: ["Scout answers questions about tokens and wallets on Robinhood Chain, using Autonomo's paid APIs when it needs data."],
  system:
    "You are Scout. When a question needs on-chain data, use Autonomo's actions: find the right API, then call it. " +
    "Answer only from what the API returns, and say what you paid.",
  plugins: [],
  settings: { secrets: { ...secrets, PGLITE_DATA_DIR: dataDir } },
};

const plugins = [sqlPlugin, autonomoPlugin];
if (!check) {
  if (!secrets.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env (see .env.example), or run npm run check.");
  if (!text) throw new Error('Give the agent a message: npm run chat -- "Is this token safe? 0x…"');
  plugins.push((await import("@elizaos/plugin-anthropic")).default);
}

const runtime = new AgentRuntime({ character, plugins });
process.on("uncaughtException", (e) => (console.error(e), done(runtime, 1)));
process.on("unhandledRejection", (e) => (console.error(e), done(runtime, 1)));
await runtime.initialize();

const names = runtime.actions.map((a) => a.name).filter((n) => n.startsWith("AUTONOMO_"));
console.log(`Plugin loaded: ${names.join(", ")}`);
const call = runtime.actions.find((a) => a.name === "AUTONOMO_CALL_API");
console.log(`Paying: ${(await call.validate(runtime, { content: { text: "" } })) ? `on, daily budget ${secrets.AUTONOMO_DAILY_USDG} USDG` : "off (no AUTONOMO_WALLET_KEY)"}`);

if (check) {
  // A free price check against the live site, through the action itself, as the planner would run it.
  const price = runtime.actions.find((a) => a.name === "AUTONOMO_GET_PRICE");
  const result = await price.handler(runtime, { content: { text: "" } }, undefined, { parameters: { query: "newest launches" } });
  console.log(`Price check: ${result.success ? result.text : `failed: ${result.text}`}`);
  await done(runtime, result.success ? 0 : 1);
}

// One message from a user in a direct chat, the way a connector would send it.
const userId = stringToUuid("autonomo-eliza-test-user");
const roomId = stringToUuid("autonomo-eliza-test-room");
const worldId = stringToUuid("autonomo-eliza-test-world");
await runtime.ensureConnection({ entityId: userId, roomId, worldId, userName: "tester", name: "Tester", source: "cli", type: ChannelType.DM });

const message = createMessageMemory({ entityId: userId, agentId: runtime.agentId, roomId, content: { text, source: "cli", channelType: ChannelType.DM } });
console.log(`\nYou: ${text}\n`);
const replies = [];
const outcome = await runtime.messageService.handleMessage(runtime, message, async (content) => {
  if (content?.text) {
    replies.push(content.text);
    console.log(`Scout: ${content.text}\n`);
  }
  return [];
});
if (!replies.length && outcome?.responseContent?.text) console.log(`Scout: ${outcome.responseContent.text}\n`);
console.log(`Actions run: ${(outcome?.responseContent?.actions ?? []).join(", ") || "none"}`);
await done(runtime, 0);
