// What the AI agent reports while it works (shared by the agent and the pages that show it).

/** The most paid calls the agent may make for one question. */
export const MAX_PAID_CALLS = 3;

export type AgentReceipt = { api: string; amount: string; tx: string | null; explorer: string | null };

export type AgentUsage = { model: string; inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number };

/** A checked tool input, kept so a follow-up question can refer back to it. */
export type AgentLookup = { tool: string; input: Record<string, unknown> };

export type AgentTurn = { question: string; answer: string; lookups: AgentLookup[] };

export type AgentEvent =
  /** The conversation this question belongs to. Send the id back with a follow-up question. */
  | { type: "conversation"; id: string; freeLeft: number }
  /** One API call moving through checking the price, paying and finishing. `id` ties its updates together. */
  | { type: "call"; id: string; api: string; state: "quoting" | "paying" | "fail"; detail: string }
  | { type: "call"; id: string; api: string; state: "done"; detail: string; receipt: AgentReceipt | null }
  /** A piece of the answer as the model writes it. */
  | { type: "text"; delta: string }
  /** Drop the text streamed since the last call: that model turn is being run again. */
  | { type: "retract" }
  /** The agent finished. `usage` is null when the keyword agent answered. */
  | { type: "answer"; text: string; receipts: AgentReceipt[]; usage: AgentUsage | null; lookups: AgentLookup[] }
  /** The agent stopped without an answer. Payments it already made are still in `receipts`. */
  | { type: "fail"; detail: string; receipts: AgentReceipt[]; usage: AgentUsage | null };

/** The agent's answers show as plain text, so the markdown models still sometimes write would appear as typed. */
export const plainAnswer = (text: string) => text.replace(/\*\*|`/g, "").replace(/^#{1,6}\s+/gm, "");
