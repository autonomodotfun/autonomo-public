"""Offline tests: a fake Autonomo, no network, no wallet balance, no payments. Run with `pytest`."""

import base64
import json

import httpx
import pytest
from autonomo import Autonomo, MemoryStore
from langchain_core.messages import AIMessage, ToolMessage

from langchain_autonomo import AutonomoToolkit

KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # a throwaway test key
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
PAY_TO = "0x00000000000000000000000000000000000000aa"
ADDR = "0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49"
TX = "0x" + "ef" * 32

APIS = [
    ("new-launches", "New Launches", "Newest token launches on Robinhood Chain", "/launches?limit=10"),
    ("token-risk", "Token Risk", "Rug-risk check for a launchpad token: holders, creator, safety score", "/risk/<token contract address>"),
    ("wallet-portfolio", "Wallet Portfolio", "What a wallet holds, with USD values", "/portfolio/<wallet address>"),
]


def _fake(price="10000", answer=None, status=200):
    """A fake autonomo.fun: the gateway list, a 402 price list, and an answer once a payment is sent."""
    sent = []

    def handler(request: httpx.Request):
        sent.append(request)
        if request.url.path == "/api/v1/gateways":
            data = [
                {"slug": s, "name": n, "description": d, "usage": p, "price": {"usdg": 0.01}, "verified": True, "trackRecord": {"successRate": 1, "paidCalls": 5}}
                for s, n, d, p in APIS
            ]
            return httpx.Response(200, json={"data": data})
        if request.headers.get("payment-signature"):
            settled = base64.b64encode(json.dumps({"transaction": TX}).encode()).decode()
            return httpx.Response(status, json=answer if answer is not None else {"score": 12}, headers={"payment-response": settled} if status == 200 else {})
        accepts = [{"scheme": "exact", "network": "eip155:4663", "asset": USDG, "amount": price, "payTo": PAY_TO, "maxTimeoutSeconds": 300, "extra": {"name": "Global Dollar", "version": "1"}}]
        required = {"x402Version": 2, "accepts": accepts, "resource": {"url": str(request.url)}}
        return httpx.Response(402, json={}, headers={"payment-required": base64.b64encode(json.dumps(required).encode()).decode()})

    return httpx.Client(transport=httpx.MockTransport(handler)), sent


def _client(http, key=KEY, **kw):
    a = Autonomo(private_key=key, pay_with="usdg", http=http, spend_store=MemoryStore(), **kw)
    a._balance = lambda token, owner: 10**9  # the wallet "has" the USDG; nothing real is paid
    return a


def _tools(toolkit):
    return {t.name: t for t in toolkit.get_tools()}


def _paid(sent):
    return [r for r in sent if r.headers.get("payment-signature")]


def test_without_a_wallet_only_the_free_tools():
    http, _ = _fake()
    assert sorted(_tools(AutonomoToolkit(Autonomo(http=http))).keys()) == ["autonomo_find_apis", "autonomo_get_price"]
    assert "autonomo_call_api" in _tools(AutonomoToolkit(_client(http)))
    assert "autonomo_call_api" not in _tools(AutonomoToolkit(_client(http), max_calls=0))


def test_find_apis_is_free_and_filters_by_input():
    http, sent = _fake()
    find = _tools(AutonomoToolkit(_client(http)))["autonomo_find_apis"]
    out = json.loads(find.invoke({"query": "is this token safe", "input": ADDR}))
    assert out["apis"][0]["slug"] == "token-risk" and out["apis"][0]["path"] == "/risk/<token contract address>"
    assert json.loads(find.invoke({}))["apis"][0]["slug"] == "new-launches"
    assert not _paid(sent)


def test_get_price_pays_nothing():
    http, sent = _fake()
    price = _tools(AutonomoToolkit(_client(http)))["autonomo_get_price"]
    out = json.loads(price.invoke({"slug": "token-risk", "input": ADDR}))
    assert out["url"] == f"https://autonomo.fun/x/token-risk/risk/{ADDR}"
    assert out["offers"] == [{"scheme": "exact", "token": "USDG", "amount": "0.01", "private": False}]
    assert not _paid(sent)


def test_call_pays_and_returns_answer_and_receipt():
    http, sent = _fake()
    kit = AutonomoToolkit(_client(http))
    out = json.loads(_tools(kit)["autonomo_call_api"].invoke({"slug": "token-risk", "path": f"/risk/{ADDR}"}))
    assert out["data"] == {"score": 12}
    r = out["receipt"]
    assert (r["route"], r["amount"], r["token"], r["tx"]) == ("usdg", "0.01", "USDG", TX)
    assert r["explorer"].endswith(TX) and kit.paid_calls == 1 and len(_paid(sent)) == 1


def test_over_the_per_call_cap_is_told_to_the_model_and_not_signed():
    http, sent = _fake(price="100000")  # 0.10 USDG, above the default 0.05 cap
    kit = AutonomoToolkit(_client(http))
    msg = _tools(kit)["autonomo_call_api"].invoke({"type": "tool_call", "id": "c1", "name": "autonomo_call_api", "args": {"query": "newest launches"}})
    assert isinstance(msg, ToolMessage) and msg.status == "error"
    assert "cannot_pay" in msg.content and "per-call cap" in msg.content
    assert not _paid(sent) and kit.paid_calls == 0


def test_stops_after_max_calls():
    http, sent = _fake()
    kit = AutonomoToolkit(_client(http), max_calls=2)
    call = _tools(kit)["autonomo_call_api"]
    for _ in range(2):
        json.loads(call.invoke({"query": "newest launches"}))
    msg = call.invoke({"type": "tool_call", "id": "c3", "name": "autonomo_call_api", "args": {"query": "newest launches"}})
    assert msg.status == "error" and "max_calls" in msg.content
    assert len(_paid(sent)) == 2 and kit.paid_calls == 2
    # get_tools() again doesn't reset the count.
    again = _tools(kit)["autonomo_call_api"].invoke({"type": "tool_call", "id": "c4", "name": "autonomo_call_api", "args": {"query": "newest launches"}})
    assert again.status == "error" and len(_paid(sent)) == 2


def test_async_calls_share_max_calls():
    """LangGraph runs tools with ainvoke, often several at once; the limit still holds."""
    import asyncio

    http, sent = _fake()
    kit = AutonomoToolkit(_client(http), max_calls=2)
    call = _tools(kit)["autonomo_call_api"]

    async def go():
        tc = lambda i: {"type": "tool_call", "id": f"c{i}", "name": "autonomo_call_api", "args": {"query": "newest launches"}}
        return await asyncio.gather(*(call.ainvoke(tc(i)) for i in range(4)))

    msgs = asyncio.run(go())
    assert sum(1 for m in msgs if m.status != "error") == 2
    assert sum(1 for m in msgs if m.status == "error" and "max_calls" in m.content) == 2
    assert len(_paid(sent)) == 2 and kit.paid_calls == 2


def test_a_failed_api_isnt_counted():
    http, _ = _fake(status=500, answer={"error": "upstream down"})
    kit = AutonomoToolkit(_client(http), max_calls=1)
    msg = _tools(kit)["autonomo_call_api"].invoke({"type": "tool_call", "id": "c1", "name": "autonomo_call_api", "args": {"query": "newest launches"}})
    assert msg.status == "error" and "payment_refused" in msg.content and "aren't charged" in msg.content
    assert kit.paid_calls == 0


def test_long_answers_are_cut():
    http, _ = _fake(answer={"text": "x" * 5000})
    kit = AutonomoToolkit(_client(http), max_output_chars=1000)
    out = json.loads(_tools(kit)["autonomo_call_api"].invoke({"query": "newest launches"}))
    assert isinstance(out["data"], str) and "[cut:" in out["data"] and len(out["data"]) < 1200
    assert out["receipt"]["tx"] == TX


def test_private_without_gloam_never_pays_publicly():
    http, sent = _fake()
    msg = _tools(AutonomoToolkit(_client(http)))["autonomo_call_api"].invoke(
        {"type": "tool_call", "id": "c1", "name": "autonomo_call_api", "args": {"query": "newest launches", "private": True}}
    )
    assert msg.status == "error" and "no_gloam" in msg.content and not _paid(sent)


def test_options_or_a_client_not_both():
    http, _ = _fake()
    with pytest.raises(ValueError):
        AutonomoToolkit(_client(http), private_key=KEY)
    kit = AutonomoToolkit(private_key=KEY, per_call={"usdg": "0.02"}, http=http, spend_store=MemoryStore())
    assert kit.client.per_call["usdg"] == 20_000 and kit.can_pay


def test_a_model_can_use_the_tools():
    """A scripted chat model asks for the tools by name, as a real one would, and gets their answers back."""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    http, sent = _fake()
    tools = _tools(AutonomoToolkit(_client(http)))
    script = iter(
        [
            AIMessage(content="", tool_calls=[{"id": "1", "name": "autonomo_find_apis", "args": {"query": "token risk", "input": ADDR}}]),
            AIMessage(content="", tool_calls=[{"id": "2", "name": "autonomo_call_api", "args": {"slug": "token-risk", "path": f"/risk/{ADDR}"}}]),
            AIMessage(content="Risk score 12."),
        ]
    )
    model = GenericFakeChatModel(messages=script)
    messages = []
    for _ in range(3):
        ai = model.invoke(messages)
        messages.append(ai)
        for tc in ai.tool_calls:
            messages.append(tools[tc["name"]].invoke({**tc, "type": "tool_call"}))
    assert messages[-1].content == "Risk score 12."
    results = [m for m in messages if isinstance(m, ToolMessage)]
    assert json.loads(results[0].content)["apis"][0]["slug"] == "token-risk"
    assert json.loads(results[1].content)["receipt"]["tx"] == TX and len(_paid(sent)) == 1
