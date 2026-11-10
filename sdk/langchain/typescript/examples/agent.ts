import { createAgent } from "langchain";
import { AutonomoToolkit } from "langchain-autonomo";

// A new wallet just for the agent, holding only what it may spend.
const toolkit = new AutonomoToolkit({
  privateKey: process.env.AUTONOMO_WALLET_KEY,
  limits: { perCall: { usdg: "0.05" }, daily: { usdg: "1" } }, // the most one call may cost, and per UTC day
  maxCalls: 5, // paid calls in this run, then the tool stops
});

const agent = createAgent({
  model: "anthropic:claude-sonnet-5-5",
  tools: toolkit.getTools(),
  systemPrompt: "Use Autonomo's APIs for live crypto data. Say what you paid and link the receipt.",
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Is this token safe? 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49" }],
});
console.log(result.messages.at(-1)?.content);
console.log(`Paid calls: ${toolkit.paidCalls}`);
