import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AgentTurn } from "@/lib/agent-events";
import type { AgentSurface } from "@/lib/agent-limits";

// Keeps recent turns on the server, so a visitor can't hand the model a made-up history. Only the question, the
// answer and the checked inputs of each call are kept, never what the APIs returned, and a conversation is deleted
// 24 hours after its last turn.

const EXPIRES_MS = 24 * 3600 * 1000;
const TURNS_FOR_CONTEXT = 4;
const MAX_ANSWER_CHARS = 2_000;
const VALID_ID = /^[A-Za-z0-9_-]{22}$/;

/** The latest turns of a live conversation; empty and with a new id when there isn't one. */
export async function loadConversation(surface: AgentSurface, id: string | null | undefined): Promise<{ id: string; isNew: boolean; turns: AgentTurn[] }> {
  if (id && VALID_ID.test(id)) {
    try {
      const db = await getDb();
      const t = schema.agentConversations;
      const [row] = await db
        .select({ turns: t.turns })
        .from(t)
        .where(and(eq(t.id, id), eq(t.surface, surface), gte(t.updatedAt, new Date(Date.now() - EXPIRES_MS))));
      if (row) return { id, isNew: false, turns: row.turns.slice(-TURNS_FOR_CONTEXT) };
    } catch (e) {
      // The question can still be answered, just without the earlier turns.
      console.error("couldn't load the agent conversation", e);
    }
  }
  return { id: randomBytes(16).toString("base64url"), isNew: true, turns: [] };
}

export async function saveTurn(surface: AgentSurface, conversation: { id: string; isNew: boolean }, turn: AgentTurn) {
  const db = await getDb();
  const t = schema.agentConversations;
  const answer = turn.answer.length > MAX_ANSWER_CHARS ? `${turn.answer.slice(0, MAX_ANSWER_CHARS)}…` : turn.answer;
  const stored: AgentTurn = { ...turn, answer };
  await db
    .insert(t)
    .values({ id: conversation.id, surface, turns: [stored] })
    // Appended in one statement, so two questions at once can't overwrite each other.
    .onConflictDoUpdate({ target: t.id, set: { turns: sql`${t.turns} || ${JSON.stringify([stored])}::jsonb`, updatedAt: sql`now()` } });
  // Starting a conversation clears out the expired ones.
  if (conversation.isNew) await db.delete(t).where(lt(t.updatedAt, new Date(Date.now() - EXPIRES_MS)));
}
