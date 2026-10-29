import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, count, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PlaygroundEvent } from "@/lib/playground-events";

// The Autonomo agent bot for Telegram.
//
// Env:
//   TELEGRAM_BOT_TOKEN        From @BotFather. Without it the bot is off.
//   TELEGRAM_WEBHOOK_SECRET   Random string; Telegram sends it back on every update so only Telegram can call us.
//   TELEGRAM_BOT_USERNAME     The bot's @username without "@", for mentions in groups.
//   TELEGRAM_FREE_DAILY       Optional: free paid answers per user per rolling 24 h (default 3).

export function telegramEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
}

export function validSecret(given: string | null) {
  const want = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(want);
  return want.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

type Button = { text: string; url: string };

/** Calls the Bot API; returns the result or null (failures are logged, never thrown at the user). */
export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) console.error(`telegram ${method} failed:`, json.description);
    return json.ok ? (json.result ?? null) : null;
  } catch (e) {
    console.error(`telegram ${method} failed:`, e);
    return null;
  }
}

export function sendMessage(chatId: number | string, html: string, opts: { replyTo?: number; buttons?: Button[] } = {}) {
  return tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    ...(opts.buttons?.length ? { reply_markup: { inline_keyboard: [opts.buttons] } } : {}),
  });
}

export function editMessage(chatId: number | string, messageId: number, html: string, buttons?: Button[]) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons?.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
  });
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- free daily allowance ----------

export function freeDaily() {
  const n = Number(process.env.TELEGRAM_FREE_DAILY);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}

export async function usedToday(userId: string) {
  const db = await getDb();
  const t = schema.telegramQuestions;
  const [row] = await db
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.userId, userId), gte(t.createdAt, new Date(Date.now() - 24 * 3600 * 1000))));
  return row?.n ?? 0;
}

export async function recordAnswer(userId: string, chatId: string, tx: string | null) {
  const db = await getDb();
  await db.insert(schema.telegramQuestions).values({ userId, chatId, tx });
}

// ---------- rendering the agent's progress as one message ----------

type Line = { icon: string; text: string; state: "running" | "done" | "fail" | "soon" };

/** Folds agent events into the message the bot keeps editing. */
export class Progress {
  private lines = new Map<string, Line>();
  answer = "";
  receipt: { amount: string; tx: string | null; explorer: string | null } | null = null;
  failed = false;

  apply(e: PlaygroundEvent) {
    if (e.step === "end") return;
    if (e.state === "fail") this.failed = true;
    if (e.step === "search") {
      const text = e.state === "done" ? `Found <b>${esc(e.api.name)}</b>` : esc(e.detail);
      this.lines.set("search", { icon: "🔎", text, state: e.state });
    } else if (e.step === "quote") {
      const autonomo = e.state === "done" ? e.offers.find((o) => o.token === "$AUTONOMO") : null;
      const text = autonomo ? `Price: <b>${Number(autonomo.amount).toLocaleString("en-US")} $AUTONOMO</b>` : esc(e.detail);
      this.lines.set("quote", { icon: "💰", text, state: e.state });
    } else if (e.step === "pay") {
      if (e.state === "done") this.receipt = { amount: e.amount, tx: e.tx, explorer: e.explorer };
      const text = e.state === "done" ? "Paid · settled on Robinhood Chain" : esc(e.detail);
      this.lines.set("pay", { icon: "⚡", text, state: e.state });
    } else if (e.step === "answer") {
      if (e.state === "done") this.answer = e.text;
      else this.lines.set("answer", { icon: "💬", text: esc(e.detail), state: e.state });
    }
  }

  render(footer = "") {
    const mark = { running: " …", done: " ✓", fail: " ✗", soon: "" };
    const steps = [...this.lines.values()].map((l) => `${l.icon} ${l.text}${l.state === "running" && l.text.endsWith("…") ? "" : mark[l.state]}`);
    const parts = [steps.join("\n")];
    if (this.answer) parts.push(esc(this.answer));
    if (this.receipt) {
      const tx = this.receipt.tx ? ` · tx ${this.receipt.tx.slice(0, 6)}…${this.receipt.tx.slice(-4)}` : "";
      const label = `${esc(this.receipt.amount)} $AUTONOMO${tx}`;
      parts.push(`🧾 Receipt: ${this.receipt.explorer ? `<a href="${this.receipt.explorer}">${label}</a>` : label}`);
    }
    if (footer) parts.push(`<i>${footer}</i>`);
    return parts.filter(Boolean).join("\n\n");
  }
}
