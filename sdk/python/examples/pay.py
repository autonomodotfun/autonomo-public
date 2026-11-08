"""Pay from the agent's own wallet: USDG first, then $AUTONOMO."""
import os

from autonomo import Autonomo

autonomo = Autonomo(
    private_key=os.environ["AUTONOMO_WALLET_KEY"],
    per_call={"usdg": "0.02"},
    daily={"usdg": "0.50"},
)

result = autonomo.call("is this token safe", input="0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49")
print(result.data)
print(result.receipt.route, result.receipt.amount, result.receipt.token, result.receipt.explorer)
