"""Pay privately from a Gloam balance, through Gloam's own MCP server running on this machine.
It reads its key and limits from ~/.gloam/agent.env (GLOAM_NETWORK=robinhood-mainnet). Needs `pip install mcp`."""
import asyncio
import json
from datetime import timedelta

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from autonomo import Autonomo


async def main():
    server = StdioServerParameters(command="npx", args=["-y", "@gloamtrade/mcp"])
    async with stdio_client(server) as (read, write), ClientSession(read, write) as gloam:
        await gloam.initialize()
        loop = asyncio.get_running_loop()

        def fetch_paid(args):
            # A private payment builds its proofs on this machine and can take a few minutes: wait up to 5.
            call = gloam.call_tool("gloam_fetch_paid", args, read_timeout_seconds=timedelta(minutes=5))
            out = asyncio.run_coroutine_threadsafe(call, loop).result()
            return json.loads(out.content[0].text)

        autonomo = Autonomo(gloam_fetch_paid=fetch_paid)
        result = await asyncio.to_thread(autonomo.call, "newest launches", private=True)
        print(result.data)
        print(result.receipt.route, result.receipt.amount, result.receipt.explorer)


asyncio.run(main())
