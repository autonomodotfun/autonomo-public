// Pay privately from a Gloam balance, through Gloam's own MCP server running on this machine.
// It reads its key and limits from ~/.gloam/agent.env (GLOAM_NETWORK=robinhood-mainnet).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Autonomo } from "autonomo-sdk";

const gloam = new Client({ name: "my-agent", version: "1.0.0" });
// On Windows, npx is a script, so it's started through cmd.
const server = process.platform === "win32" ? { command: "cmd", args: ["/c", "npx", "-y", "@gloamtrade/mcp"] } : { command: "npx", args: ["-y", "@gloamtrade/mcp"] };
await gloam.connect(new StdioClientTransport(server));

const autonomo = new Autonomo({
  gloam: {
    fetchPaid: async (args) => {
      // A private payment builds its proofs on this machine and can take a few minutes: wait up to 5, not the
      // MCP client's default of 60 seconds.
      const out = await gloam.callTool({ name: "gloam_fetch_paid", arguments: args }, undefined, { timeout: 300_000 });
      return JSON.parse((out.content as Array<{ text: string }>)[0].text);
    },
  },
});

const { data, receipt } = await autonomo.call("newest launches", { private: true });
console.log(data);
console.log(receipt.route, receipt.amount, receipt.explorer); // "gloam", the price plus Gloam's fee, the cash-out
await gloam.close();
