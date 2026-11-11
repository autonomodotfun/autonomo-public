// Offline tests for the CLI's Gloam client, against a stand-in server (fake-gloam-server.mjs). Nothing is paid.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { gloamEnv, startGloam } from "../dist/gloam.js";

const server = { command: process.execPath, args: [fileURLToPath(new URL("./fake-gloam-server.mjs", import.meta.url))] };
const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
const ARGS = { url: "https://autonomo.fun/x/token-risk/risk/0xabc", maxAmount: 0.011, prefer: "gloam-cashout" };

test("Gloam's server never gets Autonomo's wallet key or settings", () => {
  const env = gloamEnv({ PATH: "/bin", AUTONOMO_WALLET_KEY: "0xsecret", autonomo_borro_account: "0x1", GLOAM_NETWORK: "robinhood-mainnet", EMPTY: undefined });
  assert.deepEqual(env, { PATH: "/bin", GLOAM_NETWORK: "robinhood-mainnet" });
});

test("starts the server, skips its log lines, answers its ping and calls gloam_fetch_paid", async () => {
  const gloam = await startGloam({ ...base, AUTONOMO_WALLET_KEY: "0xsecret", GLOAM_NETWORK: "robinhood-mainnet" }, server);
  try {
    const r = await gloam.fetchPaid(ARGS);
    assert.equal(r.status, "ok");
    assert.equal(r.hash, `0x${"cd".repeat(32)}`);
    const seen = JSON.parse(r.body);
    assert.equal(seen.tool, "gloam_fetch_paid");
    assert.deepEqual(seen.args, ARGS);
    assert.deepEqual(seen.sawAutonomoEnv, []); // The wallet key stayed with the CLI.
    assert.equal(seen.sawGloamNetwork, "robinhood-mainnet"); // Gloam's own settings pass through.
  } finally {
    await gloam.close();
  }
});

test("an answer in plain words becomes an error result, not a crash", async () => {
  const gloam = await startGloam({ ...base, FAKE_GLOAM_MODE: "plain" }, server);
  try {
    assert.deepEqual(await gloam.fetchPaid(ARGS), { status: "error", message: "No private balance: shield some USDG first." });
  } finally {
    await gloam.close();
  }
});

test("a server that stops at once is reported with what it printed", async () => {
  await assert.rejects(startGloam({ ...base, FAKE_GLOAM_MODE: "exit" }, server), /Gloam's server stopped \(exit 1\): GLOAM_AGENT_PRIVATE_KEY is not set/);
});

test("a command that doesn't exist is reported, not thrown from nowhere", async () => {
  await assert.rejects(startGloam(base, { command: "no-such-command-autonomo-test", args: [] }), /couldn't be started|stopped/);
});

test("a payment that never answers times out, and close stops the server", async () => {
  const gloam = await startGloam({ ...base, FAKE_GLOAM_MODE: "silent" }, server, "0", { start: 10_000, pay: 300 });
  await assert.rejects(gloam.fetchPaid(ARGS), /The private payment took over 0 seconds/);
  await gloam.close();
  await gloam.close(); // Closing twice is fine.
});
