import { enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { createClient } from "@/lib/supabase/server"
import { aiChatSchema } from "@/features/ai/schema"
import { appendTurn, loadConversation, toHistory } from "@/features/ai/queries"
import { runResearch } from "@/features/ai/research-service"
import { resolveActivePortfolio } from "@/features/portfolios/queries"

/**
 * The one conversational endpoint. Intent routing happens inside the orchestrator, so a stock
 * question, a portfolio question and a watchlist question all arrive here rather than at three
 * near-identical routes.
 *
 * Node runtime, not edge: the orchestrator reaches the market-data and portfolio services, and an
 * AI call is measured in seconds rather than milliseconds.
 */
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  return guarded(async (userId) => {
    // A brake on bursts within a minute. The daily spending limit is counted in the database, in
    // features/ai/usage.ts — an in-memory counter cannot hold a budget across instances.
    enforceRateLimit(`ai:chat:${userId}`, 6, 60)

    const body = await parseBody(request, aiChatSchema)
    const supabase = await createClient()

    // Ownership is established by loading through RLS: another user's conversation simply is not
    // found, and the turn starts a new one instead of appending to theirs.
    const existing = body.conversationId ? await loadConversation(body.conversationId) : null

    // The portfolio is resolved from the caller's own list, never taken from the body as an id to
    // trust. An id belonging to someone else resolves to their default portfolio, not to that one.
    const { active } = await resolveActivePortfolio(body.portfolioId)

    const { data: savedScreens } = await supabase
      .from("saved_screens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)

    const result = await runResearch({
      supabase,
      userId,
      question: body.question,
      history: existing ? toHistory(existing.messages) : [],
      portfolioId: active?.id,
      portfolioName: active?.name,
      portfolioCurrency: active?.currency,
      savedScreens: savedScreens ?? [],
    })

    const conversationId = await appendTurn(supabase, {
      userId,
      conversationId: existing?.conversation.id,
      question: body.question,
      result,
    })

    return ok({ ...result, conversationId })
  })
}
