// The built plugin, registered in a real elizaOS runtime of each line it supports: 2.x (@elizaos/core) and 1.x
// (@elizaos/core-v1, an alias of 1.7.2). No model, no database, no payments.
import assert from "node:assert/strict";
import { test } from "node:test";
import autonomoPlugin from "../dist/index.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // a throwaway test key
const NAMES = ["AUTONOMO_FIND_APIS", "AUTONOMO_GET_PRICE", "AUTONOMO_CALL_API"];

async function agent(mod, secrets) {
  const core = await import(mod);
  const runtime = new core.AgentRuntime({ character: { name: "Test", bio: ["test"], plugins: [], settings: { secrets } }, plugins: [] });
  await runtime.registerPlugin(autonomoPlugin);
  return { core, runtime, action: (name) => runtime.actions.find((a) => a.name === name) };
}

for (const [line, mod] of [["2.x", "@elizaos/core"], ["1.x", "@elizaos/core-v1"]]) {
  test(`elizaOS ${line}: the actions register, and paying follows the agent's secrets`, async () => {
    const without = await agent(mod, {});
    assert.deepEqual(NAMES.filter((n) => without.action(n)), NAMES);
    assert.equal(await without.action("AUTONOMO_CALL_API").validate(without.runtime, { content: { text: "" } }), false);
    assert.equal(await without.action("AUTONOMO_FIND_APIS").validate(without.runtime, { content: { text: "" } }), true);

    const withKey = await agent(mod, { AUTONOMO_WALLET_KEY: KEY });
    assert.equal(await withKey.action("AUTONOMO_CALL_API").validate(withKey.runtime, { content: { text: "" } }), true);
  });
}

test("elizaOS 2.x: each action becomes a tool the planner can call", async () => {
  const { core, action } = await agent("@elizaos/core", {});
  for (const name of NAMES) {
    const tool = core.actionToTool(action(name));
    assert.equal(tool.function.name, name);
    assert.equal(tool.function.parameters.type, "object");
    assert.ok(Object.keys(tool.function.parameters.properties).includes("query"));
  }
});
