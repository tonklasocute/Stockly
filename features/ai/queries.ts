import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AIMessage } from "@/services/ai"
import { createClient } from "@/lib/supabase/server"
import type { AIConversationRow, AIMessageRow, Database } from "@/types/database"
import { MAX_HISTORY_MESSAGES } from "./schema"
import type { AIResearchResult } from "./research-service"

/**
 * Conversation storage.
 *
 * Every read here goes through the request-scoped client, so RLS scopes it to the caller and no
 * query in this file filters by `user_id` in application code. The `user_id` written on insert
 * comes from the session, never from a request body.
 */

/** How long an AI request and its answer are kept before the retention sweep removes them. */
export const CONVERSATION_RETENTION_DAYS = 180
/** Usage rows outlive conversations: they are the cost ledger, and they contain no question text. */
export const USAGE_RETENTION_DAYS = 365

export async function listConversations(limit = 20): Promise<AIConversationRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function loadConversation(
  id: string,
): Promise<{ conversation: AIConversationRow; messages: AIMessageRow[] } | null> {
  const supabase = await createClient()
  // `.maybeSingle()` plus RLS: another user's id returns null, not a 403 that confirms it exists.
  const { data: conversation } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!conversation) return null

  const { data: messages, error } = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })

  if (error) throw error
  return { conversation, messages: messages ?? [] }
}

/**
 * The turns that travel with the next question.
 *
 * Capped hard, and only the text goes: sending a whole conversation on every request is how a chat
 * feature quietly becomes the most expensive thing in an application. The older turns stay in the
 * database, where the user can read them.
 */
export function toHistory(messages: readonly AIMessageRow[]): AIMessage[] {
  return messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((row) => ({ role: row.role, content: row.content }))
}

/** A title from the first question. No second model call: a title is not worth an API round trip. */
function titleFrom(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ")
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}…`
}

/**
 * Writes the question and the answer, creating the conversation on the first turn.
 *
 * The assistant row stores both halves: `content` is the prose, `data` is the grounded payload the
 * UI renders as cards. Reopening a conversation therefore shows what the user actually saw,
 * without re-running a retrieval whose figures would have moved.
 */
export async function appendTurn(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string
    conversationId?: string
    question: string
    result: AIResearchResult
  },
): Promise<string> {
  let conversationId = input.conversationId

  if (!conversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ user_id: input.userId, title: titleFrom(input.question) })
      .select("id")
      .single()
    if (error) throw error
    conversationId = data.id
  } else {
    // Touches updated_at so the history list orders by recency. RLS makes this a no-op on a
    // conversation the caller does not own. An empty update body would be rejected by PostgREST,
    // so the column is set explicitly rather than left to the trigger.
    await supabase
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
  }

  const { error } = await supabase.from("ai_messages").insert([
    {
      conversation_id: conversationId,
      user_id: input.userId,
      role: "user" as const,
      content: input.question,
      data: null,
      intent: null,
      symbols: [],
    },
    {
      conversation_id: conversationId,
      user_id: input.userId,
      role: "assistant" as const,
      content: input.result.narrative.summary,
      data: {
        narrative: input.result.narrative,
        grounded: input.result.grounded,
        completeness: input.result.completeness,
        dataAsOf: input.result.dataAsOf,
        delayed: input.result.delayed,
        safetyFiltered: input.result.safetyFiltered,
      },
      intent: input.result.intent,
      symbols: input.result.symbols,
    },
  ])
  if (error) throw error

  return conversationId
}

/**
 * Retention.
 *
 * Conversations are the user's own research notes, so they are kept for half a year and can be
 * deleted at any time from the UI. Usage rows are the cost ledger, carry no question text, and are
 * kept for a year. Neither is kept indefinitely, because nothing here justifies that.
 *
 * Runs under the service role from the scheduled job — the only context that may delete another
 * user's rows, and one that is already behind the cron secret.
 */
export async function sweepExpiredAIData(
  admin: SupabaseClient<Database>,
): Promise<{ conversations: number; usage: number }> {
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

  const [conversations, usage] = await Promise.all([
    admin
      .from("ai_conversations")
      .delete({ count: "exact" })
      .lt("updated_at", cutoff(CONVERSATION_RETENTION_DAYS)),
    admin.from("ai_usage").delete({ count: "exact" }).lt("created_at", cutoff(USAGE_RETENTION_DAYS)),
  ])

  if (conversations.error) console.error("[ai] retention sweep failed", conversations.error.code)
  if (usage.error) console.error("[ai] usage sweep failed", usage.error.code)

  return { conversations: conversations.count ?? 0, usage: usage.count ?? 0 }
}
