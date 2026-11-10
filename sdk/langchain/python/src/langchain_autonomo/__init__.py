"""LangChain tools for Autonomo: let an agent find a paid API on Autonomo, see its price and pay for a call.

    from langchain_autonomo import AutonomoToolkit

    tools = AutonomoToolkit(private_key=os.environ["AUTONOMO_WALLET_KEY"]).get_tools()

The payments are made by the Autonomo SDK (`autonomo` on PyPI), with its per-call and daily caps. On top of those,
the toolkit stops after `max_calls` paid calls, so a looping agent can't keep paying.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Optional

from autonomo import Api, Autonomo, AutonomoError
from langchain_core.tools import BaseTool, BaseToolkit, ToolException
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

__all__ = ["AutonomoToolkit", "FindApisTool", "GetPriceTool", "CallApiTool"]
__version__ = "0.1.0"

DEFAULT_MAX_CALLS = 10
DEFAULT_MAX_OUTPUT_CHARS = 20_000
FIND_LIMIT = 15


class _Session:
    """What one toolkit has paid for, shared by its tools."""

    def __init__(self, max_calls: Optional[int]):
        self.max_calls = max_calls
        self.paid = 0
        self.lock = threading.Lock()

    def reserve(self) -> None:
        with self.lock:
            if self.max_calls is not None and self.paid >= self.max_calls:
                raise ToolException(
                    f"over_limit: this agent already made {self.paid} paid calls, its limit (max_calls). Don't call again; answer with what you have."
                )
            self.paid += 1

    def release(self) -> None:
        with self.lock:
            self.paid -= 1


def _api_dict(a: Api) -> dict:
    return {
        "slug": a.slug,
        "name": a.name,
        "description": a.description,
        "path": a.path,
        "price": a.price,
        "verified": a.verified,
        "success_rate_30d": a.success_rate,
        "paid_calls_30d": a.paid_calls_30d,
    }


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n[cut: the answer was {len(text)} characters, the first {limit} are shown]"


def _err(e: AutonomoError) -> ToolException:
    return ToolException(f"{e.code}: {e}")


# ---------- Inputs ----------


class FindApisInput(BaseModel):
    query: str = Field(default="", description='What you need, in a few words, e.g. "is this token safe" or "wallet holdings". Empty lists every API.')
    input: Optional[str] = Field(
        default=None, description="The value you'll pass, if any: a token or wallet address, a transaction hash or a link. Only APIs that take it are shown."
    )


class PriceInput(BaseModel):
    slug: Optional[str] = Field(default=None, description="The API's slug from autonomo_find_apis, e.g. token-risk.")
    path: Optional[str] = Field(
        default=None,
        description="The API's path with every <placeholder> filled in, e.g. /risk/0x86b5...ec49. Leave empty to use the API's example path filled with input.",
    )
    query: str = Field(default="", description="Used only without a slug: what you need, to pick the best API.")
    input: Optional[str] = Field(default=None, description="The address, transaction hash, link or text to put in the path's <placeholder>.")


class CallInput(PriceInput):
    private: bool = Field(default=False, description="Pay privately through Gloam. Only works when Gloam is set up; never falls back to a public payment.")


# ---------- Tools ----------


class _AutonomoTool(BaseTool):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    client: Autonomo = Field(exclude=True)
    handle_tool_error: bool = True


class FindApisTool(_AutonomoTool):
    name: str = "autonomo_find_apis"
    description: str = (
        "Search Autonomo's paid APIs: crypto data on Robinhood Chain (token risk and prices, wallets, transactions, new launches) "
        "and more, such as reading web pages. Free. Returns the best matches with each API's slug, what it does, its path "
        "(with <placeholders> to fill), its price in USDG and $AUTONOMO, and its track record. Prefer verified APIs."
    )
    args_schema: type[BaseModel] = FindApisInput

    def _run(self, query: str = "", input: Optional[str] = None, **_: Any) -> str:
        try:
            apis = self.client.find(query, input)
        except AutonomoError as e:
            raise _err(e)
        if not apis:
            return json.dumps({"apis": [], "note": "No API matches. Try other words, or an empty query to list them all."})
        return json.dumps({"apis": [_api_dict(a) for a in apis[:FIND_LIMIT]]})


class GetPriceTool(_AutonomoTool):
    name: str = "autonomo_get_price"
    description: str = (
        "See what one call to an Autonomo API costs, without paying: the exact URL and every way to pay it. Free. "
        "Give the slug and path from autonomo_find_apis, or a query and input to pick the API."
    )
    args_schema: type[BaseModel] = PriceInput

    def _run(self, slug: Optional[str] = None, path: Optional[str] = None, query: str = "", input: Optional[str] = None, **_: Any) -> str:
        try:
            q = self.client.quote(query, input=input, slug=slug, path=path)
        except AutonomoError as e:
            raise _err(e)
        return json.dumps({"api": {"slug": q["api"].slug, "name": q["api"].name}, "url": q["url"], "offers": q["offers"]})


class CallApiTool(_AutonomoTool):
    name: str = "autonomo_call_api"
    description: str = (
        "Call an Autonomo API and pay for it from this agent's wallet, then return its answer and a receipt with the "
        "payment's transaction link. Give the slug and path from autonomo_find_apis (best), or a query and input. "
        "The price is checked against the spending limits before anything is signed; failed calls aren't charged. "
        "Each call costs money, so call only what the task needs."
    )
    args_schema: type[BaseModel] = CallInput
    max_output_chars: int = DEFAULT_MAX_OUTPUT_CHARS
    _session: _Session = PrivateAttr()

    def __init__(self, session: Optional[_Session] = None, **kwargs: Any):
        super().__init__(**kwargs)
        self._session = session or _Session(DEFAULT_MAX_CALLS)

    def _run(
        self,
        slug: Optional[str] = None,
        path: Optional[str] = None,
        query: str = "",
        input: Optional[str] = None,
        private: bool = False,
        **_: Any,
    ) -> str:
        self._session.reserve()
        try:
            result = self.client.call(query, input=input, slug=slug, path=path, private=private)
        except AutonomoError as e:
            if e.code != "paid_not_served":  # that one was paid, so it counts
                self._session.release()
            raise _err(e)
        except Exception:
            self._session.release()
            raise
        text = result.data if isinstance(result.data, str) else json.dumps(result.data)
        # A long answer is cut to fit the model's context; the payment was for the whole answer either way.
        data = _clip(text, self.max_output_chars) if len(text) > self.max_output_chars else result.data
        return json.dumps({"receipt": result.receipt.to_dict(), "data": data})


# ---------- The toolkit ----------


class AutonomoToolkit(BaseToolkit):
    """Autonomo's tools for a LangChain or LangGraph agent.

    Pass a wallet key (a new wallet just for the agent) to let it pay, or an `Autonomo` client you set up yourself, for
    example with Gloam or Borro. Without either, only the free tools are given: finding APIs and their prices.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)
    client: Autonomo = Field(exclude=True)
    max_calls: Optional[int] = DEFAULT_MAX_CALLS
    max_output_chars: int = DEFAULT_MAX_OUTPUT_CHARS
    _session: _Session = PrivateAttr()

    def __init__(
        self,
        client: Optional[Autonomo] = None,
        *,
        private_key: Optional[str] = None,
        pay_with: str = "auto",
        per_call: Optional[dict] = None,
        daily: Optional[dict] = None,
        max_calls: Optional[int] = DEFAULT_MAX_CALLS,
        max_output_chars: int = DEFAULT_MAX_OUTPUT_CHARS,
        **sdk_options: Any,
    ):
        if client is not None and (private_key or per_call or daily or sdk_options or pay_with != "auto"):
            raise ValueError("Pass either an Autonomo client or the options to make one, not both.")
        if client is None:
            client = Autonomo(private_key=private_key, pay_with=pay_with, per_call=per_call, daily=daily, **sdk_options)
        if max_calls is not None and max_calls < 0:
            raise ValueError("max_calls should be 0 or more, or None for no limit.")
        super().__init__(client=client, max_calls=max_calls, max_output_chars=max_output_chars)
        self._session = _Session(max_calls)

    @property
    def can_pay(self) -> bool:
        """True when the toolkit gives the paying tool: a wallet key or Gloam is set, and max_calls isn't 0."""
        return bool(self.client.address or self.client.gloam_fetch_paid) and self.max_calls != 0

    @property
    def paid_calls(self) -> int:
        """Paid calls made through this toolkit's tools so far."""
        return self._session.paid

    def get_tools(self) -> list[BaseTool]:
        tools: list[BaseTool] = [FindApisTool(client=self.client), GetPriceTool(client=self.client)]
        if self.can_pay:
            tools.append(CallApiTool(client=self.client, session=self._session, max_output_chars=self.max_output_chars))
        return tools
