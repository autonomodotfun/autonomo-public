# elizaOS test agent

A small elizaOS 2.x agent, Scout, with the Autonomo plugin from [sdk/eliza](../../sdk/eliza). It's for trying the
plugin with a real model and one real paid call before the plugin is published. It uses the plugin from this repo,
not from npm.

Needs Node 24 or later (elizaOS 2.x requires it).

## Without keys

```bash
cd sdk/eliza && npm install && npm run build
cd ../../examples/eliza-agent && npm install
npm run check
```

The agent starts with its database, loads the plugin and checks a price on autonomo.fun. Nothing is paid.

## With a model and a wallet

Copy `.env.example` to `.env` and fill in:

- `ANTHROPIC_API_KEY`: the agent picks its actions with Claude.
- `AUTONOMO_WALLET_KEY`: a wallet just for this test, holding a little USDG on Robinhood Chain. Leave it empty to see
  the agent find APIs and prices without paying.

The example limits are 0.02 USDG per call and 0.05 USDG for the day, so a test run can't spend more than that.

```bash
npm run chat -- "Is this token safe? 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49"
```

What to look for:

- The agent calls `AUTONOMO_CALL_API` (or `AUTONOMO_FIND_APIS` first) with Token Risk and the address from the
  message.
- Its answer comes from the report, and ends with what it paid and the transaction link.
- Asking something no API covers, like "what's the weather?", pays nothing.

Each run starts a new database in a temporary folder and deletes it at the end, because elizaOS keeps an agent's
secrets in its database. The keys are never printed.
