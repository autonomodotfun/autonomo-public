# Autonomo MCP server

Give Claude, Codex, Cursor or any MCP client access to Autonomo's paid APIs. The agent finds an API, checks the
price and pays per call with x402, in USDG or $AUTONOMO on Robinhood Chain, or USDC on Base. No API keys and no
account: just a wallet.

The server runs on your own computer. Your wallet key stays there and is only used to sign payments.

## Tools

| Tool | What it does | Costs |
| --- | --- | --- |
| `find_apis` | Search Autonomo's APIs (token prices, launches, rug risk, wallets, transactions, page reader). Optionally also the directory of 4K+ x402 projects. | Free |
| `get_price` | Call an API without paying and show its price. | Free |
| `wallet_status` | What the wallet holds on both chains, what it has spent today and its limits. Signs nothing. | Free |
| `call_api` | Pay for one call and return the answer, with the payment link on Blockscout or Basescan. | Usually 0.01 USDG or USDC, or 20% less in $AUTONOMO |

## Setup

1. Make a **new wallet just for your agent**, and send it a little USDG (1 USDG is 100 calls) or $AUTONOMO on
   Robinhood Chain, or USDC on Base. The same wallet works on both chains. Paying in $AUTONOMO needs a little ETH
   once, for the Permit2 approval; USDG and USDC need no ETH.
2. Add the server to your client (below), with that wallet's private key as `AUTONOMO_WALLET_KEY`.
3. Ask: "Is token 0x… safe? Use Autonomo."

Without a key, `find_apis` and `get_price` still work.

### Claude Code

```bash
claude mcp add autonomo -e AUTONOMO_WALLET_KEY=0xYOUR_AGENT_WALLET_KEY -- npx -y autonomo-mcp
```

On Windows, start `npx` through `cmd /c`. In PowerShell, quote the `--`:

```powershell
claude mcp add autonomo -e AUTONOMO_WALLET_KEY=0xYOUR_AGENT_WALLET_KEY '--' cmd /c npx -y autonomo-mcp
```

### Claude Desktop, Cursor and others

Add this to the client's MCP config (`claude_desktop_config.json`, `.cursor/mcp.json`, …):

```json
{
  "mcpServers": {
    "autonomo": {
      "command": "npx",
      "args": ["-y", "autonomo-mcp"],
      "env": { "AUTONOMO_WALLET_KEY": "0xYOUR_AGENT_WALLET_KEY" }
    }
  }
}
```

If the client can't find `npx` on Windows, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "autonomo-mcp"]`.

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.autonomo]
command = "npx"
args = ["-y", "autonomo-mcp"]
env = { AUTONOMO_WALLET_KEY = "0xYOUR_AGENT_WALLET_KEY" }
```

## Settings

| Env var | Default | Meaning |
| --- | --- | --- |
| `AUTONOMO_WALLET_KEY` | none | Private key of the agent's wallet. Needed only for `call_api`. |
| `AUTONOMO_PAY_WITH` | `auto` | The token used when the agent doesn't say. `auto` pays with the first the wallet can afford: USDG, then $AUTONOMO, then USDC on Base. Or name one: `usdg`, `autonomo`, or `usdc` for Base. |
| `AUTONOMO_MAX_USDG_PER_CALL` | `0.05` | Most one call may cost in USDG or USDC. |
| `AUTONOMO_MAX_AUTONOMO_PER_CALL` | `5000` | Most one call may cost in $AUTONOMO. |
| `AUTONOMO_DAILY_USDG` | `1` | Most dollars the server will spend per UTC day, in USDG and USDC on Base together. |
| `AUTONOMO_DAILY_AUTONOMO` | `10000` | Most $AUTONOMO the server will spend per UTC day. |
| `AUTONOMO_RPC_URL` | Robinhood Chain's public RPC | Another Robinhood Chain RPC. |
| `AUTONOMO_BASE_RPC_URL` | `https://mainnet.base.org` | Another Base RPC, for USDC balances. |
| `AUTONOMO_BASE_URL` | `https://autonomo.fun` | Only for testing against a local copy of the site. |

## Safety

- It only pays Autonomo gateways (`autonomo.fun/x/...`), and only in USDG or $AUTONOMO on Robinhood Chain, or USDC on Base.
- Each call is capped at 0.05 USDG or USDC, or 5,000 $AUTONOMO, whatever the API asks, unless you change the caps
  above. USDG and USDC share one daily dollar budget.
- It signs only what it checked: the same token, amount and payee as in the price it read. If the API's price or
  payee changes in between, nothing is signed.
- The daily budget is tracked in `~/.autonomo-mcp/spend.json`.
- Your MCP client asks before each tool call, so you approve every payment unless you choose to allow it always.
- Use a dedicated wallet with a small balance, never your main wallet.

## Develop

```bash
npm install
npm run inspect
```

`npm run inspect` opens the MCP Inspector so you can try the tools by hand.
