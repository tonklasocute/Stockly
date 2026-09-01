import { enforceRateLimit, fail, guarded, ok, parseBody } from "@/lib/api"
import { createClient } from "@/lib/supabase/server"
import { aiAnalyzeSchema, aiCompareSchema } from "@/features/ai/schema"
import { runResearch } from "@/features/ai/research-service"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { isValidSymbol, normalizeSymbol } from "@/lib/symbol"

/**
 * "Analyse this stock" and "compare these stocks" — the two entry points that do not start with a
 * typed question.
 *
 * They share a route because they share everything except the intent and the symbol count. The
 * work is done by the same orchestrator as the chat, so there is one grounding path, one safety
 * check and one usage ledger rather than three.
 */
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`ai:analyze:${userId}`, 6, 60)

    const raw = await request
      .clone()
      .json()
      .catch(() => null)
    const isCompare = raw !== null && typeof raw === "object" && "symbols" in (raw as object)

    const symbols = isCompare
      ? (await parseBody(request, aiCompareSchema)).symbols.map(normalizeSymbol)
      : [normalizeSymbol((await parseBody(request, aiAnalyzeSchema)).symbol)]

    if (symbols.some((s) => !isValidSymbol(s))) {
      return fail("VALIDATION_ERROR", "That is not a valid symbol.")
    }

    const supabase = await createClient()
    const { active } = await resolveActivePortfolio()

    const result = await runResearch({
      supabase,
      userId,
      // The orchestrator still validates every symbol against the supported universe; this text is
      // context for the model, not the source of the symbol list.
      question: isCompare
        ? `Compare ${symbols.join(" and ")} using Stockly's technical data.`
        : `Analyse ${symbols[0]} using Stockly's technical data.`,
      forceIntent: isCompare ? "STOCK_COMPARISON" : "STOCK_ANALYSIS",
      forceSymbols: symbols,
      portfolioId: active?.id,
      portfolioName: active?.name,
      portfolioCurrency: active?.currency,
    })

    return ok(result)
  })
}
