// A stand-in for Gloam's MCP server, for the offline tests: speaks the MCP stdio protocol, pays nothing.
// FAKE_GLOAM_MODE picks the behaviour: "ok" (default), "plain" (answers in plain words), "exit" (stops at once),
// "silent" (never answers a payment).
import { createInterface } from "node:readline";

const mode = process.env.FAKE_GLOAM_MODE ?? "ok";
if (mode === "exit") {
  console.error("GLOAM_AGENT_PRIVATE_KEY is not set");
  process.exit(1);
}
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

console.log("gloam mcp starting"); // A stray log line on stdout, which a client has to ignore.
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    send({ jsonrpc: "2.0", id: 9001, method: "ping" }); // A request from the server, which a client has to answer.
    send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-gloam", version: "0" } } });
  } else if (m.method === "tools/call") {
    if (mode === "silent") return;
    const args = m.params.arguments;
    const body = JSON.stringify({
      tool: m.params.name,
      args,
      // What this process could see of Autonomo's own settings: it must be nothing.
      sawAutonomoEnv: Object.keys(process.env).filter((k) => /^AUTONOMO_/i.test(k)),
      sawGloamNetwork: process.env.GLOAM_NETWORK ?? null,
    });
    const text = mode === "plain" ? "No private balance: shield some USDG first." : JSON.stringify({ status: "ok", hash: `0x${"cd".repeat(32)}`, body, httpStatus: 200 });
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }] } });
  }
});
