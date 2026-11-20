# elizaOS plugin for Autonomo

Give an [elizaOS](https://elizaos.ai) agent [Autonomo](https://autonomo.fun)'s paid APIs. The agent finds the right
API for its task, checks the price and pays for the call itself, in USDG or $AUTONOMO with x402 on Robinhood Chain.
Spending caps are checked before anything is signed.

```bash
npm install elizaos-plugin-autonomo
```

```ts
import { autonomoPlugin } from "elizaos-plugin-autonomo";

export const projectAgent = { character, plugins: [autonomoPlugin] };
```

Then put the agent's wallet key in its secrets (or in `.env`):

```json
{ "settings": { "secrets": { "AUTONOMO_WALLET_KEY": "0x…" } } }
```

Ask the agent "Is this token safe? 0x86b5…ec49". It picks Token Risk, pays 0.01 USDG and answers from the report,
with the payment's transaction link. No code was written for Token Risk; an API listed on Autonomo tomorrow works the
same way.

Use a **new wallet just for the agent**, holding only what it may spend. Most APIs cost 0.01 USDG.

Works on elizaOS 1.x (1.7 or later) and 2.x, from one build.

## The actions

| Action | | Pays |
| --- | --- | --- |
| `AUTONOMO_FIND_APIS` | The best APIs for a task, or all of them: what each does, its path, price and track record | No |
| `AUTONOMO_GET_PRICE` | What one call would cost, and the exact URL | No |
| `AUTONOMO_CALL_API` | Calls the API, pays for it and returns the answer with a receipt and transaction link | Yes |

Without a wallet key the agent is only offered the two free actions, so it can look but not pay.

## Settings

All optional. Set them in the character's secrets or settings, or in the environment.

| Setting | | Default |
| --- | --- | --- |
| `AUTONOMO_WALLET_KEY` | The agent wallet's private key | none: free actions only |
| `AUTONOMO_PAY_WITH` | `usdg`, `autonomo`, or `auto` (USDG first, then $AUTONOMO) | `auto` |
| `AUTONOMO_MAX_USDG_PER_CALL` | The most one call may cost in USDG | `0.05` |
| `AUTONOMO_MAX_AUTONOMO_PER_CALL` | The most one call may cost in $AUTONOMO | `5000` |
| `AUTONOMO_DAILY_USDG` | The most to spend per UTC day in USDG | `1` |
| `AUTONOMO_DAILY_AUTONOMO` | The most to spend per UTC day in $AUTONOMO | `10000` |
| `AUTONOMO_BORRO_ACCOUNT` | A [Borro](https://borro.markets) credit line to borrow from when the wallet is short of USDG | none |
| `AUTONOMO_MAX_OUTPUT_CHARS` | Longer answers are cut before they reach the model or the chat | `8000` |

A call over a limit is refused before anything is signed, and the agent is told why, so it can choose a cheaper API or
answer with what it has. If an API fails, the payment doesn't settle, so the agent isn't charged.

A setting the plugin can't read as written (a limit that isn't a number, a key of the wrong length) turns paying off
until it's fixed. The agent says which setting, and the free actions keep working. A typo never becomes a looser
limit.

## Good to know

- **Anyone who can talk to the agent can ask it to make a paid call.** On Discord, Telegram or X, that is every user.
  The daily budget is the most they can spend between them, so set it to what you're fine losing in a day.
- Today's spending is kept in `~/.autonomo/spend.json`, shared with the Autonomo SDK and CLI on the same machine. On a
  host that wipes its disk on each deploy, the daily count starts again after a deploy.
- Each paid call is public on Robinhood Chain: the wallet, the amount and the API it paid.
- Paying in $AUTONOMO needs a little ETH once, for a Permit2 approval. USDG needs none.
- Prefer APIs marked verified with a good track record. Autonomo lists outside creators' APIs too, and doesn't vouch
  for each one.

## elizaOS 1.x and 2.x

- **2.x**: the planner fills in each action's parameters and writes the reply from the result.
- **1.x**: there are no action parameters, so the action reads what's needed from the user's message with the agent's
  small model, and answers through the callback. The address, transaction hash or link it passes to an API is only
  ever one written in the message, never one the model made up. The line saying what was paid is taken from the
  receipt, not written by the model.

## Options in code

To set things in code instead of settings, or to pay privately through [Gloam](https://gloam.trade), make the plugin
yourself. It takes the [Autonomo SDK](https://www.npmjs.com/package/autonomo-sdk)'s options, or a `client` you made:

```ts
import { createAutonomoPlugin } from "elizaos-plugin-autonomo";

const autonomo = createAutonomoPlugin({
  limits: { perCall: { usdg: "0.02" }, daily: { usdg: "0.50" } },
  gloam: { fetchPaid },   // adds a `private` option to AUTONOMO_CALL_API
});
```

Options given in code win over the agent's settings. A private call only ever pays through Gloam, never as a public
payment.

## Tests

They run offline against a fake Autonomo and pay nothing. They also register the built plugin in a real elizaOS 1.7.2
and 2.0.5 runtime (the 2.x one needs Node 24):

```bash
npm install && npm run build && npm run typecheck:v1 && npm test
```
