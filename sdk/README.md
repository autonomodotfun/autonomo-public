# Autonomo SDKs

One function, `call`, that does what an x402 client alone doesn't: find the right Autonomo API for a request, pay
for it in USDG or $AUTONOMO (privately through Gloam, or on Borro credit when the wallet is empty), keep to spending
caps, and return the answer with a receipt.

| | Package | Folder |
| --- | --- | --- |
| TypeScript | `autonomo-sdk` on npm | [typescript](typescript) |
| Python | `autonomo-sdk` on PyPI (also as `autonomo`) | [python](python) |
| LangChain, Python | `langchain-autonomo` on PyPI | [langchain/python](langchain/python) |
| LangChain.js | `langchain-autonomo` on npm | [langchain/typescript](langchain/typescript) |

`autonomo-sdk` on PyPI is a second name with no code of its own ([python-alias](python-alias)): it installs
`autonomo`, so the install matches npm.

The TypeScript package also installs a command, `autonomo` (`npx autonomo-sdk risk 0x…`), with the same limits:
[typescript](typescript#from-the-terminal).

Both build the x402 payment themselves (EIP-3009 for USDG, Permit2 for $AUTONOMO), so one call can switch between
routes. Their payment headers match `@x402/core`'s field for field, and the two SDKs sign the same payment
identically. Both keep today's spending in `~/.autonomo/spend.json`, so a budget holds across them.

The LangChain packages give an agent three tools on top of the SDK (find an API, check its price, pay for a call),
so the model picks and pays for APIs itself, with a cap on paid calls per toolkit on top of the SDK's limits. Guide:
[autonomo.fun/docs/langchain](https://autonomo.fun/docs/langchain).

Tests run offline and pay nothing:

```bash
cd typescript && npm install && npm run build && npm test
cd python && pip install -e . pytest && pytest
cd langchain/typescript && npm install && npm run build && npm test
cd langchain/python && pip install -e ../../python -e . pytest && pytest
```

Next: an ElizaOS plugin built on `call`.
