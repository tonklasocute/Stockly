import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { listJournalPage } from "@/features/journal/queries"
import { journalFilterSchema, journalInputSchema } from "@/features/journal/schema"
import { toPage } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"

/**
 * The journal timeline, filtered and paginated.
 *
 * Ownership is the database's job in both directions: RLS scopes every read to the caller, so a
 * `portfolioId` belonging to someone else returns an empty page rather than a 403 that would
 * confirm the portfolio exists — and the composite foreign key on the insert below refuses a row
 * pointed at a portfolio the caller does not own, whatever the body claims.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const parsed = journalFilterSchema.safeParse({
      portfolioId: url.searchParams.get("portfolioId") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      symbol: url.searchParams.get("symbol") ?? undefined,
      market: url.searchParams.get("market") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    })
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Invalid journal filter.", "filterInvalid")

    const page = await listJournalPage(parsed.data, toPage(url.searchParams.get("page")))
    return ok({ entries: page.rows, meta: page })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, journalInputSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("investment_journals")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        symbol: body.symbol || null,
        market: body.market,
        transaction_id: body.transactionId ?? null,
        type: body.type,
        reason: body.reason ?? null,
        title: body.title,
        content: body.content,
        entry_date: body.entryDate,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "That trade already has a sell review. Edit it instead.", "duplicateSellReview")
    }
    if (error?.code === "23514" || error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That entry violates a data rule.", "dataRuleJournal")
    }
    if (error) throw error

    // A journal entry changes no financial figure, so only the pages that render it are refreshed.
    invalidateIntelligence()
    return ok(data, 201)
  })
}
