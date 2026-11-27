import "server-only";
import { esc, sendMessage } from "@/lib/agent/telegram";

// Alerts for the team: things a person has to act on, which a log line alone would hide.
//
// Env:
//   ALERT_TELEGRAM_CHAT_ID   The Telegram chat that gets alerts: a group the bot was added to, or a person who has
//                            started the bot. Sent with TELEGRAM_BOT_TOKEN. Without both, alerts only reach the log.

/** Sends the alert to the team chat and always writes it to the log. Returns whether the chat got it. */
export async function alertTeam(title: string, lines: string[]): Promise<boolean> {
  if (lines.length === 0) return false;
  console.error(`ALERT: ${title}`, lines);
  const chat = process.env.ALERT_TELEGRAM_CHAT_ID?.trim();
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) return false;
  const html = [`<b>${esc(title)}</b>`, ...lines.map((l) => `• ${esc(l)}`)].join("\n");
  return (await sendMessage(chat, html)) !== null;
}
