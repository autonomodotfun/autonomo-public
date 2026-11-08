# Autonomo SDK for Python

One call for AI agents. Say what you need, and the SDK:

1. **Finds the right API** on [Autonomo](https://autonomo.fun), from your words and the kind of input you give
   (a token or wallet address, a transaction hash, a link).
2. **Pays for it** with x402 on Robinhood Chain, in USDG or $AUTONOMO, whichever the wallet can afford.
3. **Pays privately through [Gloam](https://gloam.trade)** when you ask, so the payment doesn't link to your wallet.
4. **Borrows from a [Borro](https://borro.markets) credit line** when the wallet is short of USDG.
5. **Keeps to your caps**: a most-per-call and a daily budget, checked before anything is signed.
6. **Returns the answer and a receipt**: which API, how it was paid, the amount and the transaction link.

```bash
pip install autonomo-sdk
```

The same package is also on PyPI as `autonomo`. Either way, you import it as `autonomo`.

Full examples for each way to pay: [autonomo.fun/docs/sdk](https://autonomo.fun/docs/sdk).

```python
import os
from autonomo import Autonomo

autonomo = Autonomo(private_key=os.environ["AUTONOMO_WALLET_KEY"])

result = autonomo.call("is this token safe", input="0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49")
print(result.data)
print(result.receipt.route, result.receipt.amount, result.receipt.token, result.receipt.explorer)
```

Use a **new wallet just for the agent**, holding only what it may spend. A little USDG covers many calls (most APIs
cost 0.01 USDG). Paying in $AUTONOMO needs a little ETH once, for a Permit2 approval.

## Finding APIs without paying

```python
autonomo = Autonomo()                      # no key needed to look
autonomo.find("wallet holdings")           # best matches first
autonomo.quote("explain this transaction", input="0x…")   # the API, the URL and every price
```

To skip the search, name the API: `autonomo.call(slug="token-risk", path="/risk/0x…")`.

## Limits

```python
Autonomo(
    private_key=...,
    pay_with="auto",                                  # or "usdg" / "autonomo"
    per_call={"usdg": "0.05", "autonomo": "5000"},    # the defaults
    daily={"usdg": "1", "autonomo": "10000"},         # per UTC day; Gloam and Borro count as USDG
)
```

A call over a limit is refused before anything is signed, with the reason. Spending is kept in
`~/.autonomo/spend.json` (shared with the TypeScript SDK); pass `spend_store=MemoryStore()` or your own store to change
that.

## Private payments with Gloam

`private=True` pays from a private Gloam balance through Gloam's own MCP server, `@gloamtrade/mcp`, running on your
machine with its key and limits in `~/.gloam/agent.env`. The SDK calls its `gloam_fetch_paid` tool; Gloam cashes out
exactly the price through its relay and calls the API with it. The SDK holds no Gloam keys, and no wallet key is needed.
See the [SDK guide](https://autonomo.fun/docs/sdk) for the setup and a full example (it uses `pip install mcp`).

```python
def fetch_paid(args):   # runs gloam_fetch_paid on an MCP session with @gloamtrade/mcp
    out = asyncio.run_coroutine_threadsafe(gloam.call_tool("gloam_fetch_paid", args), loop).result()
    return json.loads(out.content[0].text)

autonomo = Autonomo(gloam_fetch_paid=fetch_paid)
autonomo.call("newest launches", private=True)
```

A private call only ever pays through Gloam. If the API doesn't offer it, or Gloam isn't set up, it's refused, never
sent as a public payment. The price includes Gloam's 0.5% cash-out fee.

## Borrowing with Borro

```python
autonomo = Autonomo(private_key=..., borro_account="0xYourCreditLine")
```

When the wallet can't afford a call, the SDK asks Borro's MCP server to prepare a borrow of just what it's short,
sends it from the wallet (this needs a little ETH for gas), waits for the USDG and pays. The line needs x402 bills
turned on; see [Pay with a Borro credit line](https://autonomo.fun/docs/borro). Borro's own daily limit still applies.

## The receipt

| Field | |
| --- | --- |
| `api` | The API's slug and name |
| `route` | `usdg`, `autonomo`, `gloam` or `borro` |
| `amount`, `token` | What was paid |
| `payer`, `pay_to` | The wallet (or "private (Gloam)") and the API's payment address |
| `tx`, `explorer` | The payment transaction and its Blockscout link |
| `borrow_txs`, `approve_tx` | Borro borrows and the one-time Permit2 approval, when there were any |
| `spent_today` | Today's total against the daily budget |

Errors are `AutonomoError` with a `code` such as `cannot_pay`, `over_limit`, `no_private_option` or `payment_refused`.
If an API fails after a payment is signed, the payment doesn't settle, so you aren't charged.
