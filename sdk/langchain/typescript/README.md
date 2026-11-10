# LangChain.js tools for Autonomo

Give a [LangChain.js](https://js.langchain.com) or LangGraph.js agent [Autonomo](https://autonomo.fun)'s paid APIs.
The agent finds the right API for its task, checks the price and pays for the call itself, in USDG or $AUTONOMO with
x402 on Robinhood Chain. Spending caps are checked before anything is signed.

```bash
npm install langchain-autonomo @langchain/core
```

```ts
import { createAgent } from "langchain";
import { AutonomoToolkit } from "langchain-autonomo";

const toolkit = new AutonomoToolkit({ privateKey: process.env.AUTONOMO_WALLET_KEY });
const agent = createAgent({ model: "anthropic:claude-sonnet-5-5", tools: toolkit.getTools() });

await agent.invoke({ messages: [{ role: "user", content: "Is this token safe? 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49" }] });
```

The agent searches with `autonomo_find_apis`, picks Token Risk, pays 0.01 USDG with `autonomo_call_api` and answers
from the report. No code was written for Token Risk; an API listed on Autonomo tomorrow works the same way.

Use a **new wallet just for the agent**, holding only what it may spend. Most APIs cost 0.01 USDG.

## The tools

| Tool | | Pays |
| --- | --- | --- |
| `autonomo_find_apis` | The best APIs for a task, or all of them: what each does, its path, price and track record | No |
| `autonomo_get_price` | What one call would cost, and the exact URL | No |
| `autonomo_call_api` | Calls the API, pays for it and returns the answer with a receipt and transaction link | Yes |

Without a wallet key, `getTools()` gives only the two free tools.

## Limits

```ts
new AutonomoToolkit({
  privateKey: "0x…",
  limits: {
    perCall: { usdg: "0.05", autonomo: "5000" },   // the most one call may cost (the defaults)
    daily: { usdg: "1", autonomo: "10000" },       // per UTC day, kept in ~/.autonomo/spend.json
  },
  maxCalls: 10,             // paid calls through this toolkit, then it stops (null: no limit)
  maxOutputChars: 20_000,   // longer answers are cut before they reach the model
});
```

A call over a limit is refused before anything is signed, and the agent is told why, so it can choose a cheaper API or
answer with what it has. If an API fails, the payment doesn't settle, so the agent isn't charged.

## Gloam, Borro and other options

The toolkit runs on the [Autonomo SDK](https://www.npmjs.com/package/autonomo-sdk) and takes all of its options. To pay
privately through [Gloam](https://gloam.trade) or borrow from a [Borro](https://borro.markets) credit line, pass them
the same way, or pass a `client` you made yourself:

```ts
const toolkit = new AutonomoToolkit({ privateKey: "0x…", borro: { account: "0xYourCreditLine" }, maxCalls: 5 });
```

With Gloam set up, the agent can ask for `private: true`. A private call only ever pays through Gloam, never as a
public payment.

Full guide: [autonomo.fun/docs/langchain](https://autonomo.fun/docs/langchain).

## Tests

They run offline against a fake Autonomo and pay nothing:

```bash
npm install && npm run build && npm test
```
