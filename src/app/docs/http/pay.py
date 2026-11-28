# Pay an x402 API over plain HTTP: ask for the price, sign once, ask again with the payment.
# Needs Python 3.9 or newer and one package, for signing: pip install eth-account
# Run: AUTONOMO_WALLET_KEY=0x... python pay.py "https://autonomo.fun/x/gas-now/gas"
import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

from eth_account import Account
from eth_utils import to_checksum_address

# The dollars this wallet pays with. To pay USDC on Base instead, set NETWORK to "eip155:8453".
NETWORK = os.environ.get("PAY_NETWORK") or "eip155:4663"
DOLLARS = {
    "eip155:4663": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",  # USDG on Robinhood Chain
    "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # USDC on Base
}
MAX_PRICE = 0.5  # dollars. Never sign for more than this.

if len(sys.argv) < 2 or not os.environ.get("AUTONOMO_WALLET_KEY"):
    sys.exit('Usage: AUTONOMO_WALLET_KEY=0x... python pay.py "<api url>"')
url = sys.argv[1]
account = Account.from_key(os.environ["AUTONOMO_WALLET_KEY"])


def decode(header):
    return json.loads(base64.b64decode(header))


def encode(value):
    return base64.b64encode(json.dumps(value).encode()).decode()


def get(headers=None):
    """One GET. urllib raises on 402, and the error carries the status, headers and body we need."""
    request = urllib.request.Request(url, headers={"User-Agent": "pay.py", **(headers or {})})
    try:
        return urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as answer:
        return answer


# 1. Ask. With no payment the API answers 402 and puts its price list in the PAYMENT-REQUIRED header.
first = get()
if first.status != 402:
    print(first.status, first.read().decode())
    sys.exit(0 if first.status < 400 else 1)
required = decode(first.headers["payment-required"])

# 2. Choose the option that is the token above, on the network above.
offer = next(
    (
        o
        for o in required["accepts"]
        if o["scheme"] == "exact"
        and o["network"] == NETWORK
        and o["asset"].lower() == DOLLARS[NETWORK].lower()
        and o.get("extra", {}).get("name")  # a name here means one signature is enough
    ),
    None,
)
if offer is None:
    sys.exit(f"This API has no one-signature price on {NETWORK}")
price = int(offer["amount"]) / 1e6  # USDG and USDC both count in millionths of a dollar
if price > MAX_PRICE:
    sys.exit(f"The price is ${price}, over the limit of ${MAX_PRICE}")

# 3. Sign a transfer of exactly that amount to exactly that address.
# It is a signature, not a transaction, so the wallet pays no gas.
nonce = secrets.token_bytes(32)  # 32 random bytes, new for every payment
authorization = {
    "from": account.address,
    "to": to_checksum_address(offer["payTo"]),
    "value": offer["amount"],
    "validAfter": "0",
    "validBefore": str(int(time.time()) + offer["maxTimeoutSeconds"]),
    "nonce": "0x" + nonce.hex(),
}
signed = Account.sign_typed_data(
    account.key,
    {
        "name": offer["extra"]["name"],
        "version": offer["extra"]["version"],
        "chainId": int(offer["network"].split(":")[1]),
        "verifyingContract": offer["asset"],
    },
    {
        "TransferWithAuthorization": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"},
        ]
    },
    {
        "from": authorization["from"],
        "to": authorization["to"],
        "value": int(authorization["value"]),
        "validAfter": int(authorization["validAfter"]),
        "validBefore": int(authorization["validBefore"]),
        "nonce": nonce,
    },
)

# 4. Ask again, the same request, with the payment in the PAYMENT-SIGNATURE header.
payment = {
    "x402Version": required["x402Version"],
    "payload": {"authorization": authorization, "signature": "0x" + bytes(signed.signature).hex()},
    "extensions": required.get("extensions"),  # copied back as it came
    "resource": required.get("resource"),  # copied back as it came
    "accepted": offer,  # the option you chose, unchanged
}
payment = {k: v for k, v in payment.items() if v is not None}
paid = get({"PAYMENT-SIGNATURE": encode(payment)})

# 5. Read the answer. A paid call carries a receipt in the PAYMENT-RESPONSE header.
if paid.status == 402:
    again, failed = paid.headers["payment-required"], paid.headers["payment-response"]
    reason = (failed and decode(failed).get("errorReason")) or (again and decode(again).get("error"))
    sys.exit(f"Not paid: {reason or 'no reason given'}")
print(paid.status, paid.read().decode())
receipt = paid.headers["payment-response"]
if receipt:
    print(f"Paid ${price}. Transaction: {decode(receipt)['transaction']}")
