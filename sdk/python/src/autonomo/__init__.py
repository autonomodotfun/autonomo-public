"""Autonomo SDK: one call that finds the right paid API on Autonomo, pays for it on Robinhood Chain and returns the
answer with a receipt.

    from autonomo import Autonomo
    autonomo = Autonomo(private_key=os.environ["AUTONOMO_WALLET_KEY"])
    result = autonomo.call("is this token safe", input="0x…")
    result.data, result.receipt

How a call is paid, in order:
    private=True   Only through Gloam, from a private balance, so the payment doesn't link to the wallet. Never falls
                   back to a public payment.
    otherwise      USDG, then $AUTONOMO (or just the one set in pay_with), from the wallet, whichever it can afford.
                   If it can't afford either and a Borro credit line is set, it borrows the USDG it's short and pays.
Every route checks the per-call cap and the daily budget before anything is signed or sent.
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Literal, Optional, Protocol
from urllib.parse import quote as urlquote, urlparse

import httpx
from eth_account import Account
from eth_utils import to_checksum_address

__version__ = "0.1.0"
__all__ = ["Autonomo", "AutonomoError", "Api", "Receipt", "CallResult", "MemoryStore", "FileStore", "rank_apis", "find_transactions"]

NETWORK = "eip155:4663"
CHAIN_ID = 4663
EXPLORER = "https://robinhoodchain.blockscout.com"
PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001"  # x402's exact-scheme Permit2 proxy
BORRO_MCP = "https://borro.markets/mcp"
MAX_UINT256 = 2**256 - 1

TokenName = Literal["usdg", "autonomo"]
Route = Literal["usdg", "autonomo", "gloam", "borro"]


@dataclass(frozen=True)
class Token:
    name: str
    symbol: str
    address: str
    decimals: int


TOKENS = {
    "usdg": Token("usdg", "USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", 6),
    "autonomo": Token("autonomo", "AUTONOMO", "0xe83c85e1ead16fcfe85401e2b337fb4fb5b5cc96", 18),
}
DEFAULT_PER_CALL = {"usdg": "0.05", "autonomo": "5000"}
DEFAULT_DAILY = {"usdg": "1", "autonomo": "10000"}


class AutonomoError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _fail(code: str, message: str):
    raise AutonomoError(code, message)


def _units(amount: str, decimals: int) -> int:
    return int(Decimal(amount) * (10**decimals))


def _fmt(amount: int, decimals: int) -> str:
    s = format(Decimal(amount) / (Decimal(10) ** decimals), "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _b64(obj: Any) -> str:
    return base64.b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode()


def _unb64(h: Optional[str]) -> Optional[dict]:
    if not h:
        return None
    try:
        return json.loads(base64.b64decode(h))
    except Exception:
        return None


# ---------- Public types ----------


@dataclass
class Api:
    slug: str
    name: str
    description: str
    path: str
    price: dict
    verified: bool
    success_rate: Optional[float]
    paid_calls_30d: int


@dataclass
class Receipt:
    api: dict
    url: str
    route: str
    amount: str
    token: str
    payer: str
    pay_to: str
    tx: Optional[str]
    explorer: Optional[str]
    borrow_txs: list = field(default_factory=list)
    approve_tx: Optional[str] = None
    at: str = ""
    spent_today: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CallResult:
    data: Any
    receipt: Receipt


class SpendStore(Protocol):
    def get(self, day: str) -> dict: ...
    def add(self, day: str, token: str, amount: int) -> None: ...


class MemoryStore:
    """Keeps spending in memory only, for tests or short-lived agents."""

    def __init__(self):
        self.days: dict[str, dict[str, int]] = {}

    def get(self, day: str) -> dict:
        return dict(self.days.get(day, {}))

    def add(self, day: str, token: str, amount: int) -> None:
        d = self.days.setdefault(day, {})
        d[token] = d.get(token, 0) + amount


class FileStore:
    """Today's spending in a JSON file, ~/.autonomo/spend.json by default (shared with the TypeScript SDK)."""

    def __init__(self, path: Optional[str] = None):
        self.path = Path(path) if path else Path.home() / ".autonomo" / "spend.json"

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except Exception:
            return {}

    def get(self, day: str) -> dict:
        s = self._read()
        if s.get("date") != day:
            return {}
        return {k: int(s.get(k, 0)) for k in ("usdg", "autonomo")}

    def add(self, day: str, token: str, amount: int) -> None:
        s = self._read()
        cur = s if s.get("date") == day else {"date": day}
        cur[token] = str(int(cur.get(token, 0)) + amount)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(cur))


# ---------- Finding the right API ----------


def _kind_of(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        return "tx"
    if re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        return "address"
    if re.match(r"https?://", value, re.I):
        return "url"
    return "text"


def _placeholders(path: str) -> list[str]:
    return [m.lower() for m in re.findall(r"<([^>]+)>", path)]


def _fits(path: str, kind: Optional[str]) -> bool:
    ph = _placeholders(path)
    if kind is None:
        return not ph
    if len(ph) != 1:
        return False
    p = ph[0]
    if kind == "tx":
        return bool(re.search(r"transaction|hash", p))
    if kind == "address":
        return "address" in p
    if kind == "url":
        return bool(re.search(r"url|link", p))
    return not re.search(r"address|hash|url|link", p)


def _fill(path: str, value: Optional[str]) -> str:
    if value is None:
        return path

    def repl(m: re.Match) -> str:
        return urlquote(value, safe="") if re.search(r"url|link", m.group(1), re.I) else value

    return re.sub(r"<([^>]+)>", repl, path, count=1)


def rank_apis(apis: list[Api], query: str, input: Optional[str] = None) -> list[Api]:
    """Ranks APIs for a query and input: word matches first, then a fitting path, then verified and the track record."""
    words = [w for w in re.split(r"[^a-z0-9$]+", query.lower()) if len(w) > 2]
    kind = _kind_of(input)
    scored = []
    for a in apis:
        if not _fits(a.path, kind):
            continue
        hay = f"{a.slug} {a.name} {a.description}".lower()
        hits = sum(1 for w in words if w in hay)
        if hits == 0 and words:
            continue
        rate = a.success_rate if a.success_rate is not None else 0.5
        trust = (1 if a.verified else 0) + rate + min(a.paid_calls_30d, 100) / 1000
        scored.append((hits, trust, a))
    scored.sort(key=lambda s: (-s[0], -s[1]))
    return [s[2] for s in scored]


# ---------- Typed data ----------


def eip3009_typed_data(auth: dict, asset: str, name: str, version: str) -> dict:
    return {
        "domain": {"name": name, "version": version, "chainId": CHAIN_ID, "verifyingContract": to_checksum_address(asset)},
        "types": {
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ]
        },
        "message": {
            "from": to_checksum_address(auth["from"]),
            "to": to_checksum_address(auth["to"]),
            "value": int(auth["value"]),
            "validAfter": int(auth["validAfter"]),
            "validBefore": int(auth["validBefore"]),
            "nonce": bytes.fromhex(auth["nonce"][2:]),
        },
    }


def permit2_typed_data(auth: dict) -> dict:
    return {
        "domain": {"name": "Permit2", "chainId": CHAIN_ID, "verifyingContract": PERMIT2},
        "types": {
            "PermitWitnessTransferFrom": [
                {"name": "permitted", "type": "TokenPermissions"},
                {"name": "spender", "type": "address"},
                {"name": "nonce", "type": "uint256"},
                {"name": "deadline", "type": "uint256"},
                {"name": "witness", "type": "Witness"},
            ],
            "TokenPermissions": [{"name": "token", "type": "address"}, {"name": "amount", "type": "uint256"}],
            "Witness": [{"name": "to", "type": "address"}, {"name": "validAfter", "type": "uint256"}],
        },
        "message": {
            "permitted": {"token": to_checksum_address(auth["permitted"]["token"]), "amount": int(auth["permitted"]["amount"])},
            "spender": to_checksum_address(auth["spender"]),
            "nonce": int(auth["nonce"]),
            "deadline": int(auth["deadline"]),
            "witness": {"to": to_checksum_address(auth["witness"]["to"]), "validAfter": int(auth["witness"]["validAfter"])},
        },
    }


def _sign_typed(key: str, typed: dict) -> str:
    signed = Account.sign_typed_data(key, domain_data=typed["domain"], message_types=typed["types"], message_data=typed["message"])
    return "0x" + bytes(signed.signature).hex()


def find_transactions(value: Any) -> list[dict]:
    """Every transaction ({to, data}) inside a tool result, in order, skipping the typed data to sign."""
    out: list[dict] = []

    def walk(v: Any) -> None:
        if isinstance(v, list):
            for x in v:
                walk(x)
            return
        if not isinstance(v, dict):
            return
        to, data = v.get("to"), v.get("data")
        if isinstance(to, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", to) and isinstance(data, str) and re.fullmatch(r"0x[0-9a-fA-F]+", data):
            out.append({"to": to, "data": data, "value": None if v.get("value") is None else str(v["value"])})
            return
        for k, x in v.items():
            if k != "typed_data":
                walk(x)

    walk(value)
    return out


# ---------- The client ----------

GloamCashOut = Callable[[dict], str]
"""Pays a Gloam cash-out from your private balance and returns its tx hash. Gets {amount, amount_usdg, pay_to, asset, url}."""


class Autonomo:
    def __init__(
        self,
        private_key: Optional[str] = None,
        pay_with: str = "auto",
        per_call: Optional[dict] = None,
        daily: Optional[dict] = None,
        gloam_cash_out: Optional[GloamCashOut] = None,
        borro_account: Optional[str] = None,
        borro_mcp_url: str = BORRO_MCP,
        spend_store: Optional[SpendStore] = None,
        base_url: str = "https://autonomo.fun",
        rpc_url: str = "https://rpc.mainnet.chain.robinhood.com",
        http: Optional[httpx.Client] = None,
    ):
        key = (private_key or "").strip()
        if key and not re.fullmatch(r"0x[0-9a-fA-F]{64}", key):
            _fail("bad_key", "private_key should be 0x followed by 64 hex characters.")
        self._key = key or None
        self.address: Optional[str] = Account.from_key(key).address if key else None
        if pay_with not in ("auto", "usdg", "autonomo"):
            _fail("bad_option", 'pay_with should be "auto", "usdg" or "autonomo".')
        self.pay_with = pay_with
        pc = {**DEFAULT_PER_CALL, **(per_call or {})}
        dl = {**DEFAULT_DAILY, **(daily or {})}
        self.per_call = {t: _units(pc[t], TOKENS[t].decimals) for t in TOKENS}
        self.daily = {t: _units(dl[t], TOKENS[t].decimals) for t in TOKENS}
        self.gloam_cash_out = gloam_cash_out
        self.borro_account = to_checksum_address(borro_account) if borro_account else None
        self.borro_mcp_url = borro_mcp_url
        self.store: SpendStore = spend_store or FileStore()
        self.base = base_url.rstrip("/")
        self.rpc_url = rpc_url
        self.http = http or httpx.Client(timeout=30, follow_redirects=False)

    # ----- Public -----

    def find(self, query: str = "", input: Optional[str] = None) -> list[Api]:
        """Every Autonomo API, or the best matches for a query and input. Free."""
        res = self.http.get(f"{self.base}/api/v1/gateways", timeout=15)
        if res.status_code == 503:
            _fail("updating", "Autonomo is being updated right now. Try again in a few minutes.")
        if res.status_code != 200:
            _fail("http_error", f"/api/v1/gateways answered {res.status_code}.")
        apis = [
            Api(
                slug=g["slug"],
                name=g["name"],
                description=g.get("description") or "",
                path=g.get("usage") or "/",
                price=g.get("price") or {},
                verified=bool(g.get("verified")),
                success_rate=(g.get("trackRecord") or {}).get("successRate"),
                paid_calls_30d=(g.get("trackRecord") or {}).get("paidCalls") or 0,
            )
            for g in res.json()["data"]
        ]
        return rank_apis(apis, query, input) if (query or input is not None) else apis

    def quote(self, query: str = "", input: Optional[str] = None, slug: Optional[str] = None, path: Optional[str] = None) -> dict:
        """What a call would cost, without paying."""
        api, url = self._resolve(query, input, slug, path)
        required = self._price_list(url)
        offers = []
        for a in required["accepts"]:
            t = _token_by_asset(a["asset"])
            offers.append(
                {
                    "scheme": a["scheme"],
                    "token": t.symbol if t else a["asset"],
                    "amount": _fmt(int(a["amount"]), t.decimals if t else 18),
                    "private": a["scheme"] == "gloam-cashout",
                }
            )
        return {"api": api, "url": url, "offers": offers}

    def call(
        self,
        query: str = "",
        input: Optional[str] = None,
        slug: Optional[str] = None,
        path: Optional[str] = None,
        private: bool = False,
        pay_with: Optional[str] = None,
    ) -> CallResult:
        """Finds the right API, pays for one call and returns its answer with a receipt."""
        if not self._key:
            _fail("no_wallet", "No wallet set. Pass private_key (a wallet just for this agent).")
        api, url = self._resolve(query, input, slug, path)
        required = self._price_list(url)
        day = _today()
        spent = self.store.get(day)

        def within(token: Token, amount: int) -> Optional[str]:
            price = f"{_fmt(amount, token.decimals)} {token.symbol}"
            if amount > self.per_call[token.name]:
                return f"{price} is above the per-call cap of {_fmt(self.per_call[token.name], token.decimals)} {token.symbol}"
            so_far = spent.get(token.name, 0)
            if so_far + amount > self.daily[token.name]:
                return f"{price} would pass today's {token.symbol} budget ({_fmt(so_far, token.decimals)} of {_fmt(self.daily[token.name], token.decimals)} spent)"
            return None

        def finish(route: str, token: Token, amount: int, res: httpx.Response, tx: Optional[str], extra: dict) -> CallResult:
            if res.status_code != 200:
                reason = (_unb64(res.headers.get("payment-required")) or {}).get("error")
                detail = ""
                try:
                    j = res.json()
                    detail = j.get("message") or j.get("error") or ""
                except Exception:
                    pass
                _fail(
                    "payment_refused",
                    f"Payment refused: {reason}" if reason else f"The API answered {res.status_code}{': ' + detail if detail else ''}. You aren't charged unless it settled.",
                )
            self.store.add(day, token.name, amount)
            after = self.store.get(day).get(token.name, 0)
            try:
                data = res.json()
            except Exception:
                data = res.text
            receipt = Receipt(
                api={"slug": api.slug, "name": api.name},
                url=url,
                route=route,
                amount=_fmt(amount, token.decimals),
                token=token.symbol,
                payer="private (Gloam)" if route == "gloam" else self.address,
                pay_to=extra.get("pay_to", ""),
                tx=tx,
                explorer=f"{EXPLORER}/tx/{tx}" if tx else None,
                borrow_txs=extra.get("borrow_txs", []),
                approve_tx=extra.get("approve_tx"),
                at=datetime.now(timezone.utc).isoformat(),
                spent_today=f"{_fmt(after, token.decimals)} of {_fmt(self.daily[token.name], token.decimals)} {token.symbol}",
            )
            return CallResult(data=data, receipt=receipt)

        # Private: Gloam only.
        if private:
            if not self.gloam_cash_out:
                _fail("no_gloam", "private=True needs a Gloam cash-out function (gloam_cash_out=...).")
            offer = next((a for a in required["accepts"] if a["scheme"] == "gloam-cashout"), None)
            if not offer:
                _fail("no_private_option", f"{api.name} doesn't offer private payment.")
            amount = int(offer["amount"])
            why = within(TOKENS["usdg"], amount)
            if why:
                _fail("over_limit", f"Not paid: {why}.")
            pay_to = to_checksum_address(offer["payTo"])
            tx_hash = self.gloam_cash_out(
                {"amount": amount, "amount_usdg": _fmt(amount, 6), "pay_to": pay_to, "asset": to_checksum_address(offer["asset"]), "url": url}
            )
            header = json.dumps({"scheme": "gloam-cashout", "txHash": tx_hash, "quoteId": (offer.get("extra") or {}).get("quoteId")})
            res = self.http.get(url, headers={"X-PAYMENT": header}, timeout=60)
            return finish("gloam", TOKENS["usdg"], amount, res, tx_hash, {"pay_to": pay_to})

        # Public: the wallet's tokens, then Borro.
        want = pay_with or self.pay_with
        order = ["usdg", "autonomo"] if want == "auto" else [want]
        reasons: list[str] = []
        usdg_short: Optional[tuple[dict, int]] = None
        for name in order:
            token = TOKENS[name]
            offer = next(
                (a for a in required["accepts"] if a["scheme"] == "exact" and a["network"] == NETWORK and a["asset"].lower() == token.address.lower()),
                None,
            )
            if not offer:
                reasons.append(f"{api.name} doesn't take {token.symbol}")
                continue
            amount = int(offer["amount"])
            why = within(token, amount)
            if why:
                reasons.append(why)
                continue
            balance = self._balance(token.address, self.address)
            if balance < amount:
                reasons.append(f"the wallet holds {_fmt(balance, token.decimals)} {token.symbol}, the call costs {_fmt(amount, token.decimals)}")
                if name == "usdg":
                    usdg_short = (offer, amount)
                continue
            res, tx, extra = self._pay_exact(url, required, offer)
            return finish(name, token, amount, res, tx, extra)

        if self.borro_account and usdg_short:
            offer, amount = usdg_short
            borrow_txs = self._borrow(url, offer)
            res, tx, extra = self._pay_exact(url, required, offer)
            extra["borrow_txs"] = [f"{EXPLORER}/tx/{h}" for h in borrow_txs]
            return finish("borro", TOKENS["usdg"], amount, res, tx, extra)
        _fail("cannot_pay", f"Not paid: {'; '.join(reasons)}.")

    # ----- Internals -----

    def _gateway_url(self, slug: str, path: str) -> str:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug):
            _fail("bad_slug", "slug should look like token-risk.")
        p = path if path.startswith("/") else f"/{path}"
        if ".." in p or p.startswith("//") or re.search(r"[\s\\<>]", p):
            _fail("bad_path", f"The path {p} isn't a plain, filled-in path.")
        url = f"{self.base}/x/{slug}{p}"
        u, b = urlparse(url), urlparse(self.base)
        if (u.scheme, u.netloc) != (b.scheme, b.netloc) or not (u.path == f"/x/{slug}" or u.path.startswith(f"/x/{slug}/")):
            _fail("bad_path", "That path leaves the API.")
        return url

    def _resolve(self, query: str, input: Optional[str], slug: Optional[str], path: Optional[str]) -> tuple[Api, str]:
        if slug:
            api = next((a for a in self.find() if a.slug == slug), None)
            if not api:
                _fail("not_found", f"No Autonomo API called {slug}.")
        else:
            matches = self.find(query, input)
            if not matches:
                kind = _kind_of(input)
                _fail("not_found", f'No Autonomo API matches "{query}"' + (f" for a {kind}" if kind and kind != "text" else "") + ". Use find() to see them all.")
            api = matches[0]
        return api, self._gateway_url(api.slug, path or _fill(api.path, input))

    def _price_list(self, url: str) -> dict:
        res = self.http.get(url, timeout=20)
        required = _unb64(res.headers.get("payment-required"))
        if not required and res.status_code == 402:
            try:
                required = res.json()
            except Exception:
                required = None
        if res.status_code == 503:
            _fail("updating", "This API is paused or being updated. Try again later.")
        if res.status_code != 402 or not isinstance((required or {}).get("accepts"), list):
            _fail("no_price", f"Expected a 402 price list from {url}, got {res.status_code}.")
        return required

    def _pay_exact(self, url: str, required: dict, offer: dict) -> tuple[httpx.Response, Optional[str], dict]:
        """Signs an x402 exact payment (EIP-3009 for USDG, Permit2 for $AUTONOMO) and sends the request with it."""
        now = int(time.time())
        timeout = int(offer.get("maxTimeoutSeconds") or 300)
        extra_in = offer.get("extra") or {}
        approve_tx = None
        if extra_in.get("assetTransferMethod") == "permit2":
            if self._allowance(offer["asset"], self.address, PERMIT2) < int(offer["amount"]):
                data = "0x095ea7b3" + _word(PERMIT2) + format(MAX_UINT256, "064x")
                approve_tx = f"{EXPLORER}/tx/{self._send({'to': to_checksum_address(offer['asset']), 'data': data})}"
            auth = {
                "from": self.address,
                "permitted": {"token": to_checksum_address(offer["asset"]), "amount": offer["amount"]},
                "spender": PERMIT2_PROXY,
                "nonce": str(int.from_bytes(secrets.token_bytes(32), "big")),
                "deadline": str(now + timeout),
                "witness": {"to": to_checksum_address(offer["payTo"]), "validAfter": "0"},
            }
            payload = {"signature": _sign_typed(self._key, permit2_typed_data(auth)), "permit2Authorization": auth}
        else:
            name, version = extra_in.get("name"), extra_in.get("version")
            if not name or not version:
                _fail("bad_offer", "The price list is missing the token's EIP-712 name and version.")
            auth = {
                "from": self.address,
                "to": to_checksum_address(offer["payTo"]),
                "value": offer["amount"],
                "validAfter": "0",
                "validBefore": str(now + timeout),
                "nonce": "0x" + secrets.token_hex(32),
            }
            payload = {"authorization": auth, "signature": _sign_typed(self._key, eip3009_typed_data(auth, offer["asset"], name, version))}

        if required.get("x402Version") == 1:
            envelope = {"x402Version": 1, "scheme": offer["scheme"], "network": offer["network"], "payload": payload}
            headers = {"X-PAYMENT": _b64(envelope)}
        else:
            envelope = {"x402Version": required["x402Version"], "payload": payload, "resource": required.get("resource"), "accepted": offer}
            if required.get("extensions") is not None:
                envelope["extensions"] = required["extensions"]
            headers = {"PAYMENT-SIGNATURE": _b64(envelope)}
        res = self.http.get(url, headers=headers, timeout=60)
        settled = _unb64(res.headers.get("payment-response") or res.headers.get("x-payment-response")) or {}
        return res, settled.get("transaction"), {"approve_tx": approve_tx, "pay_to": to_checksum_address(offer["payTo"])}

    def _borrow(self, url: str, offer: dict) -> list[str]:
        """Asks Borro for the borrow that covers what the wallet is short, sends it and waits for the USDG to land."""
        required = self._price_list(url)
        result = _mcp_call(
            self.http,
            self.borro_mcp_url,
            "credit_bill",
            {"wallet": self.address, "account": self.borro_account, "payment_required": _b64(required), "max_usdg": _fmt(self.per_call["usdg"], 6)},
        )
        hashes = [self._send(t) for t in find_transactions(result)]
        need = int(offer["amount"])
        for _ in range(20):
            if self._balance(TOKENS["usdg"].address, self.address) >= need:
                return hashes
            time.sleep(1)
        _fail("borrow_failed", "The borrowed USDG hasn't reached the wallet yet. Nothing was paid; try again shortly.")

    # ----- Chain -----

    def _rpc(self, method: str, params: list) -> Any:
        res = self.http.post(self.rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20)
        body = res.json()
        if "error" in body:
            _fail("rpc_error", f"{method}: {body['error'].get('message')}")
        return body["result"]

    def _balance(self, token: str, owner: str) -> int:
        return int(self._rpc("eth_call", [{"to": token, "data": "0x70a08231" + _word(owner)}, "latest"]), 16)

    def _allowance(self, token: str, owner: str, spender: str) -> int:
        return int(self._rpc("eth_call", [{"to": token, "data": "0xdd62ed3e" + _word(owner) + _word(spender)}, "latest"]), 16)

    def _send(self, tx: dict) -> str:
        """Signs and sends a transaction from the wallet, waits for it, and returns its hash. Needs a little ETH for gas."""
        value = int(tx.get("value") or 0, 0) if isinstance(tx.get("value"), str) else int(tx.get("value") or 0)
        base = {"from": self.address, "to": to_checksum_address(tx["to"]), "data": tx["data"], "value": hex(value)}
        gas = int(int(self._rpc("eth_estimateGas", [base]), 16) * 1.2)
        signed = Account.sign_transaction(
            {
                "to": base["to"],
                "data": tx["data"],
                "value": value,
                "gas": gas,
                "gasPrice": int(self._rpc("eth_gasPrice", []), 16),
                "nonce": int(self._rpc("eth_getTransactionCount", [self.address, "pending"]), 16),
                "chainId": CHAIN_ID,
            },
            self._key,
        )
        h = self._rpc("eth_sendRawTransaction", ["0x" + bytes(signed.raw_transaction).hex()])
        for _ in range(60):
            r = self._rpc("eth_getTransactionReceipt", [h])
            if r:
                if r.get("status") != "0x1":
                    _fail("tx_failed", f"Transaction failed: {EXPLORER}/tx/{h}")
                return h
            time.sleep(1)
        _fail("tx_timeout", f"Transaction not confirmed yet: {EXPLORER}/tx/{h}")


def _word(address: str) -> str:
    return address.lower().replace("0x", "").rjust(64, "0")


def _token_by_asset(asset: str) -> Optional[Token]:
    return next((t for t in TOKENS.values() if t.address.lower() == asset.lower()), None)


def _mcp_call(http: httpx.Client, url: str, name: str, args: dict) -> Any:
    """Calls one tool on an MCP server over plain JSON-RPC and returns its result, parsed from JSON when it's JSON."""
    res = http.post(
        url,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}},
        headers={"accept": "application/json, text/event-stream"},
        timeout=30,
    )
    text = res.text
    if text.startswith("event:") or text.startswith("data:"):
        text = "".join(line[5:] for line in text.splitlines() if line.startswith("data:"))
    try:
        body = json.loads(text)
    except Exception:
        _fail("borro_error", f"Borro answered {res.status_code}.")
    if body.get("error"):
        _fail("borro_error", f"Borro: {body['error'].get('message', 'error')}")
    result = body.get("result") or {}
    out = "".join(c.get("text", "") for c in result.get("content") or [])
    if result.get("isError"):
        _fail("borro_refused", f"Borro: {out}")
    if result.get("structuredContent") is not None:
        return result["structuredContent"]
    try:
        return json.loads(out)
    except Exception:
        return out
