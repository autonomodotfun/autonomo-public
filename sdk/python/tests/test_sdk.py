"""Offline tests: no network, no wallet balance, no payments. Run with `pytest`."""

import base64
import json
from datetime import datetime, timezone

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data

from autonomo import Api, Autonomo, AutonomoError, MemoryStore, find_transactions, rank_apis
from autonomo import eip3009_typed_data, permit2_typed_data

KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # a throwaway test key
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
AUTONOMO = "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96"
PAY_TO = "0x00000000000000000000000000000000000000aa"
ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49"
TX = "0x" + "ab" * 32

APIS = [
    ("token-price", "Token Price", "show live $autonomo token price", "/price/autonomo", 38),
    ("new-launches", "New Launches", "Newest token launches on Robinhood Chain", "/launches?limit=10", 24),
    ("token-risk", "Token Risk", "Rug-risk check for a launchpad token: holders, creator, safety score", "/risk/<token contract address>", 10),
    ("token-lookup", "Token Lookup", "Price and market cap of any launchpad token", "/price/<token contract address>", 5),
    ("tx-explainer", "Transaction Explainer", "Explains a transaction in plain words", "/tx/<transaction hash>", 3),
    ("wallet-portfolio", "Wallet Portfolio", "What a wallet holds, with USD values", "/portfolio/<wallet address>", 3),
    ("page-reader", "Page Reader", "Reads a web page and returns its text", "/page?url=<url-encoded https:// link>", 2),
]
API_OBJS = [Api(s, n, d, p, {}, True, 1.0, c) for s, n, d, p, c in APIS]


def test_finds_the_right_api():
    assert rank_apis(API_OBJS, "is this token a rug risk", ADDR)[0].slug == "token-risk"
    assert rank_apis(API_OBJS, "token price", ADDR)[0].slug == "token-lookup"
    assert rank_apis(API_OBJS, "what does this wallet hold", ADDR)[0].slug == "wallet-portfolio"
    assert rank_apis(API_OBJS, "explain this transaction", TX)[0].slug == "tx-explainer"
    assert rank_apis(API_OBJS, "read this page", "https://example.com/a?b=c")[0].slug == "page-reader"
    assert rank_apis(API_OBJS, "newest launches")[0].slug == "new-launches"
    assert rank_apis(API_OBJS, "explain this transaction", ADDR) == []


def _recover(typed, sig):
    msg = encode_typed_data(domain_data=typed["domain"], message_types=typed["types"], message_data=typed["message"])
    return Account.recover_message(msg, signature=sig)


def test_typed_data_recovers_to_the_wallet():
    acct = Account.from_key(KEY)
    usdg = eip3009_typed_data(
        {"from": acct.address, "to": PAY_TO, "value": "10000", "validAfter": "0", "validBefore": "9999999999", "nonce": "0x" + "11" * 32}, USDG, "Global Dollar", "1"
    )
    sig = Account.sign_typed_data(KEY, domain_data=usdg["domain"], message_types=usdg["types"], message_data=usdg["message"]).signature
    assert _recover(usdg, sig) == acct.address
    p2 = permit2_typed_data(
        {"permitted": {"token": AUTONOMO, "amount": "100"}, "spender": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001", "nonce": "5", "deadline": "9999999999", "witness": {"to": PAY_TO, "validAfter": "0"}}
    )
    sig = Account.sign_typed_data(KEY, domain_data=p2["domain"], message_types=p2["types"], message_data=p2["message"]).signature
    assert _recover(p2, sig) == acct.address


def test_finds_borro_borrow_transaction():
    result = {
        "borrow": {"to": "0x1111111111111111111111111111111111111111", "data": "0xabcdef", "value": "0"},
        "typed_data": {"message": {"from": "0x2222222222222222222222222222222222222222", "to": PAY_TO, "value": "10000"}},
        "authorization": {"to": PAY_TO, "value": "10000"},
    }
    assert find_transactions(result) == [{"to": "0x1111111111111111111111111111111111111111", "data": "0xabcdef", "value": "0"}]


def _exact(asset, amount, extra=None):
    return {"scheme": "exact", "network": "eip155:4663", "asset": asset, "amount": amount, "payTo": PAY_TO, "maxTimeoutSeconds": 300, "extra": extra or {}}


def _fake(accepts, on_paid=None):
    sent = []

    def handler(request: httpx.Request):
        sent.append(request)
        if request.url.path == "/api/v1/gateways":
            data = [{"slug": s, "name": n, "description": d, "usage": p, "verified": True, "trackRecord": {"successRate": 1, "paidCalls": c}} for s, n, d, p, c in APIS]
            return httpx.Response(200, json={"data": data})
        if on_paid and (request.headers.get("x-payment") or request.headers.get("payment-signature")):
            return on_paid(request)
        required = {"x402Version": 2, "accepts": accepts, "resource": {"url": str(request.url)}}
        return httpx.Response(402, json={}, headers={"payment-required": base64.b64encode(json.dumps(required).encode()).decode()})

    return httpx.Client(transport=httpx.MockTransport(handler)), sent


def test_refuses_over_the_per_call_cap_before_signing():
    client, sent = _fake([_exact(USDG, "100000", {"name": "Global Dollar", "version": "1"})])  # 0.10 USDG
    a = Autonomo(private_key=KEY, pay_with="usdg", http=client, spend_store=MemoryStore())
    with pytest.raises(AutonomoError) as e:
        a.call("newest launches")
    assert e.value.code == "cannot_pay" and "per-call cap" in str(e.value)
    assert not any(r.headers.get("payment-signature") for r in sent)


def test_refuses_when_todays_budget_is_used():
    store = MemoryStore()
    store.add(datetime.now(timezone.utc).strftime("%Y-%m-%d"), "usdg", 995_000)
    client, _ = _fake([_exact(USDG, "10000", {"name": "Global Dollar", "version": "1"})])
    a = Autonomo(private_key=KEY, pay_with="usdg", http=client, spend_store=store)
    with pytest.raises(AutonomoError) as e:
        a.call("newest launches")
    assert e.value.code == "cannot_pay" and "budget" in str(e.value)


def test_private_never_falls_back_to_public():
    client, _ = _fake([_exact(USDG, "10000", {"name": "Global Dollar", "version": "1"})])
    a = Autonomo(private_key=KEY, http=client, spend_store=MemoryStore(), gloam_fetch_paid=lambda args: pytest.fail("no Gloam option"))
    with pytest.raises(AutonomoError) as e:
        a.call("newest launches", private=True)
    assert e.value.code == "no_private_option"
    b = Autonomo(private_key=KEY, http=client, spend_store=MemoryStore())
    with pytest.raises(AutonomoError) as e:
        b.call("newest launches", private=True)
    assert e.value.code == "no_gloam"


def test_pays_privately_through_gloam():
    gloam = {"scheme": "gloam-cashout", "network": "eip155:4663", "asset": USDG, "amount": "10051", "payTo": PAY_TO, "extra": {"quoteId": "q1"}}
    client, _ = _fake([_exact(USDG, "10000", {"name": "Global Dollar", "version": "1"}), gloam])
    store = MemoryStore()
    calls = []
    h = "0x" + "cd" * 32

    def fetch_paid(args):
        calls.append(args)
        return {"status": "ok", "hash": h, "httpStatus": 200, "body": json.dumps({"ok": True})}

    a = Autonomo(http=client, spend_store=store, gloam_fetch_paid=fetch_paid)  # no wallet key needed
    result = a.call("newest launches", private=True)
    assert result.data == {"ok": True}
    assert calls[0] == {"url": "https://autonomo.fun/x/new-launches/launches?limit=10", "maxAmount": 0.011051, "prefer": "gloam-cashout"}
    r = result.receipt
    assert (r.route, r.payer, r.amount, r.tx) == ("gloam", "private (Gloam)", "0.010051", h)
    assert store.get(datetime.now(timezone.utc).strftime("%Y-%m-%d"))["usdg"] == 10051


def test_gloam_refusal_pays_and_records_nothing():
    gloam = {"scheme": "gloam-cashout", "network": "eip155:4663", "asset": USDG, "amount": "10051", "payTo": PAY_TO, "extra": {"quoteId": "q1"}}
    client, _ = _fake([gloam])
    store = MemoryStore()
    a = Autonomo(private_key=KEY, http=client, spend_store=store, gloam_fetch_paid=lambda args: {"status": "refused", "code": "over_daily", "message": "over the daily limit"})
    with pytest.raises(AutonomoError) as e:
        a.call("newest launches", private=True)
    assert e.value.code == "payment_refused" and "over the daily limit" in str(e.value)
    assert store.get(datetime.now(timezone.utc).strftime("%Y-%m-%d")) == {}


def test_signed_usdg_payment_header():
    """The wallet has the USDG (faked), so the SDK signs and sends a PAYMENT-SIGNATURE header that recovers to it."""
    seen = {}

    def paid(request):
        seen["env"] = json.loads(base64.b64decode(request.headers["payment-signature"]))
        settled = base64.b64encode(json.dumps({"transaction": "0x" + "ef" * 32}).encode()).decode()
        return httpx.Response(200, json={"ok": 1}, headers={"payment-response": settled})

    client, _ = _fake([_exact(USDG, "10000", {"name": "Global Dollar", "version": "1"})], on_paid=paid)
    a = Autonomo(private_key=KEY, pay_with="usdg", http=client, spend_store=MemoryStore())
    a._balance = lambda token, owner: 10**9
    result = a.call("newest launches")
    env = seen["env"]
    assert env["x402Version"] == 2 and env["accepted"]["amount"] == "10000" and "extensions" not in env
    auth = env["payload"]["authorization"]
    assert auth["from"] == a.address and auth["value"] == "10000"
    typed = eip3009_typed_data(auth, USDG, "Global Dollar", "1")
    assert _recover(typed, env["payload"]["signature"]) == a.address
    assert result.receipt.route == "usdg" and result.receipt.tx == "0x" + "ef" * 32
