"""Borrow what the wallet is short from a Borro credit line, then pay."""
import os

from autonomo import Autonomo

autonomo = Autonomo(
    private_key=os.environ["AUTONOMO_WALLET_KEY"],
    pay_with="usdg",
    borro_account=os.environ["BORRO_CREDIT_LINE"],
)

result = autonomo.call("explain this transaction", input="0x0f1635d41a8fbbde7d61ad39e045e067780b921329112c16955bc26ad3423041")
print(result.data)
print(result.receipt.route, result.receipt.borrow_txs, result.receipt.explorer)
