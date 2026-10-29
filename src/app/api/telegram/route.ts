import { after } from "next/server";
import { runAgent } from "@/lib/agent";
import { exampleQuestion } from "@/lib/playground";
import { listAutonomoGateways } from "@/lib/queries";
import { editMessage, esc, freeDaily, Progress, recordAnswer, sendMessage, telegramEnabled, usedToday, validSecret } from "@/lib/telegram";

// Telegram webhook for the Autonomo agent bot. Telegram posts every update here with our secret header; we
// answer 200 at once and do the work after the response (paying can take a few seconds).
//
// In private chats every message is a question. In groups the bot only answers /ask <question>, messages that
// mention it, and replies to its own messages, so it never talks over a conversation.

export const maxDuration = 60;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autonomo.fun").replace(/\/$/, "");
const PLAYGROUND = { text: "Open the Agent Playground", url: `${SITE}/playground` };

type TgMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: { id: number; is_bot?: boolean; first_name?: string };
  reply_to_message?: { from?: { is_bot?: boolean; username?: string } };
};

// Per-user burst limit (the daily allowance is in the database).
const recent = new Map<number, number[]>();
function tooFast(userId: number) {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(userId, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 4;
}

export async function POST(request: Request) {
  if (!telegramEnabled()) return new Response("bot disabled", { status: 404 });
  if (!validSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return new Response("forbidden", { status: 403 });

  const update = (await request.json().catch(() => null)) as { message?: TgMessage } | null;
  const msg = update?.message;
  if (msg?.text && msg.from && !msg.from.is_bot) after(() => handle(msg));
  return new Response("ok");
}

/** The question in a message, or null when the bot shouldn't answer it. */
function questionFrom(msg: TgMessage): { command: string | null; text: string } | null {
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").toLowerCase();
  let text = (msg.text ?? "").trim();
  const cmd = text.match(/^\/([a-z]+)(@\w+)?\s*/i);
  if (cmd) {
    if (cmd[2] && bot && cmd[2].slice(1).toLowerCase() !== bot) return null; // a command for another bot
    return { command: cmd[1].toLowerCase(), text: text.slice(cmd[0].length).trim() };
  }
  if (msg.chat.type === "private") return { command: null, text };
  const mentioned = bot && text.toLowerCase().includes(`@${bot}`);
  const replyToBot = msg.reply_to_message?.from?.is_bot && (!bot || msg.reply_to_message.from.username?.toLowerCase() === bot);
  if (!mentioned && !replyToBot) return null;
  if (bot) text = text.replace(new RegExp(`@${bot}`, "ig"), "").trim();
  return { command: null, text };
}

async function handle(msg: TgMessage) {
  const q = questionFrom(msg);
  if (!q) return;
  const chatId = msg.chat.id;
  const userId = String(msg.from!.id);

  if (q.command === "start" || q.command === "help") return sendHelp(chatId, msg.message_id);
  if (q.command === "apis") return sendApis(chatId, msg.message_id);
  if (q.command === "credits") {
    const left = Math.max(0, freeDaily() - (await usedToday(userId)));
    return sendMessage(chatId, `You have <b>${left} of ${freeDaily()}</b> free answers left today. They refill over 24 hours.`, { replyTo: msg.message_id });
  }
  if (q.command && q.command !== "ask") return; // unknown command: stay quiet
  if (q.text.length < 3) {
    return sendMessage(chatId, "Ask me something, for example: <code>/ask What are the newest token launches?</code>", { replyTo: msg.message_id });
  }
  if (tooFast(msg.from!.id)) return sendMessage(chatId, "One moment, you're asking a bit fast. Try again in a minute.", { replyTo: msg.message_id });

  const question = q.text.slice(0, 200);
  const progress = new Progress();
  const sent = await sendMessage(chatId, "🔎 Searching Autonomo for an API that takes $AUTONOMO …", { replyTo: msg.message_id });
  if (!sent) return;

  // Edit the message as the agent works, at most every 1.2 s, then once more at the end.
  let lastEdit = 0;
  let lastText = "";
  const push = async (force = false, footer = "") => {
    const text = progress.render(footer);
    if (text === lastText || (!force && Date.now() - lastEdit < 1200)) return;
    lastText = text;
    lastEdit = Date.now();
    await editMessage(chatId, sent.message_id, text, force ? [PLAYGROUND] : undefined);
  };

  let paidHere = false;
  const edits: Promise<void>[] = [];
  await runAgent(question, (e) => {
    progress.apply(e);
    if (e.step !== "end") edits.push(push());
  }, {
    mayPay: async () => {
      const used = await usedToday(userId);
      if (used >= freeDaily()) return `You've used your ${freeDaily()} free answers for today. They refill over 24 hours.`;
      return null;
    },
    onPaid: async (tx) => {
      paidHere = true;
      await recordAnswer(userId, String(chatId), tx);
    },
  });
  await Promise.all(edits);
  const left = paidHere ? Math.max(0, freeDaily() - (await usedToday(userId))) : null;
  await push(true, left === null ? "" : `Free answers left today: ${left} of ${freeDaily()}`);
}

async function sendHelp(chatId: number, replyTo: number) {
  const apis = await listAutonomoGateways();
  const examples = apis.slice(0, 4).map((g) => `• <code>${esc(exampleQuestion(g.slug, g.name))}</code>`).join("\n");
  const html = [
    "🤖 <b>Autonomo Agent</b>",
    "Ask a question and I find a paid API on Autonomo, pay for it in <b>$AUTONOMO</b> with x402 and answer you, with the on-chain receipt.",
    examples ? `<b>Try:</b>\n${examples}` : "",
    `In groups, use <code>/ask your question</code> or mention me. You get <b>${freeDaily()} free answers</b> a day.`,
    "/apis lists what I can use · /credits shows what you have left",
    "<i>Heuristic data from public chains, not financial advice.</i>",
  ].filter(Boolean).join("\n\n");
  return sendMessage(chatId, html, { replyTo, buttons: [PLAYGROUND] });
}

async function sendApis(chatId: number, replyTo: number) {
  const apis = await listAutonomoGateways();
  if (!apis.length) return sendMessage(chatId, "No APIs are live right now.", { replyTo });
  const lines = apis.map(
    (g) => `• <b>${esc(g.name)}</b>: ${Number(g.autonomoAmount).toLocaleString("en-US")} $AUTONOMO per call\n  <code>${esc(exampleQuestion(g.slug, g.name))}</code>`,
  );
  return sendMessage(chatId, `<b>APIs I can use right now</b>\n\n${lines.join("\n\n")}`, { replyTo, buttons: [PLAYGROUND] });
}
