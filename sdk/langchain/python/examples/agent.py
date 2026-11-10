import os

from langchain.agents import create_agent
from langchain_autonomo import AutonomoToolkit

# A new wallet just for the agent, holding only what it may spend.
toolkit = AutonomoToolkit(
    private_key=os.environ["AUTONOMO_WALLET_KEY"],
    per_call={"usdg": "0.05"},  # the most one call may cost
    daily={"usdg": "1"},  # per UTC day
    max_calls=5,  # paid calls in this run, then the tool stops
)

agent = create_agent(
    "anthropic:claude-sonnet-5-5",
    tools=toolkit.get_tools(),
    system_prompt="Use Autonomo's APIs for live crypto data. Say what you paid and link the receipt.",
)

result = agent.invoke({"messages": [("user", "Is this token safe? 0x86b57bcb9d249cf096cf8e21426c9dc9cafdec49")]})
print(result["messages"][-1].content)
print(f"Paid calls: {toolkit.paid_calls}")
