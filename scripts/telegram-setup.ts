// Points the Telegram bot at autonomo.fun and sets its commands and description.
// Run once after creating the bot (and again if the URL or secret changes): npm run telegram:setup
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local (the same values as in Vercel).
import "./env";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = (process.env.TELEGRAM_WEBHOOK_SITE || "https://autonomo.fun").replace(/\/$/, "");
if (!token || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local first.");
  process.exit(1);
}

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  console.log(`${method}: ${json.ok ? "ok" : `failed (${json.description})`}`);
  return json;
}

const me = (await call("getMe", {})).result as { username?: string } | undefined;
if (me?.username) console.log(`Bot: @${me.username}  (set TELEGRAM_BOT_USERNAME=${me.username} in Vercel)`);

await call("setWebhook", {
  url: `${site}/api/telegram`,
  secret_token: secret,
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
await call("setMyCommands", {
  commands: [
    { command: "ask", description: "Ask the agent; it pays an API in $AUTONOMO" },
    { command: "apis", description: "APIs the agent can use right now" },
    { command: "credits", description: "Free answers you have left today" },
    { command: "help", description: "How the Autonomo agent works" },
  ],
});
await call("setMyShortDescription", { short_description: "Ask anything. An AI agent pays for the answer in $AUTONOMO. autonomo.fun" });
await call("setMyDescription", {
  description:
    "The Autonomo agent finds a paid API on Autonomo, pays for it in $AUTONOMO with x402 on Robinhood Chain, and answers you with the on-chain receipt. Try: What are the newest token launches?",
});
