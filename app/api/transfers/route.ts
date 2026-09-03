import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio, invalidateReconciliation } from "@/lib/cache"
import { previewTransfer } from "@/features/operations/transfer"
import { transferSchema } from "@/features/operations/schema"
import { logger } from "@/lib/log"
import { createClient } from "@/lib/supabase/server"

/**
 * Preview a transfer, or apply one.
 *
 * One endpoint and one computation. `apply: false` runs the preview and writes nothing at all — no
 * session row, no pending transfer, no staging table — so a user who abandons the flow leaves
 * nothing behind and the preview is trivially free of side effects.
 *
 * The apply goes through `transfer_instrument`, which is `security definer` and checks that **both**
 * portfolios belong to the caller. With RLS off inside that function, those two checks are the
 * whole ownership boundary; nothing here can substitute for them.
 */
export async function POST(request: Request) {
  // Ownership is the database's: `transfer_instrument` is `security definer` and checks
  // `user_id = auth.uid()` itself, so this handler never needs the id.
  return guarded(async () => {
    const body = await parseBody(request, transferSchema)
    const preview = await previewTransfer(body)

    if (preview.empty) {
      throw new ApiError(
        "VALIDATION_ERROR",
        body.symbol
          ? `There are no ${body.symbol} transactions in that portfolio to move.`
          : "That portfolio has no transactions to move.",
      )
    }

    if (!body.apply) return ok({ preview, applied: false })

    const supabase = await createClient()
    const { data, error } = await supabase.rpc("transfer_instrument", {
      p_from_portfolio: body.fromPortfolioId,
      p_to_portfolio: body.toPortfolioId,
      p_symbol: body.symbol,
      p_market: body.market,
      p_reason: body.reason,
    })

    if (error?.code === "P0002") throw new ApiError("NOT_FOUND", "Portfolio not found.", "portfolioMissing")
    if (error?.code === "22023") throw new ApiError("VALIDATION_ERROR", "That transfer is not valid.", "transferInvalid")
    if (error) throw error

    // Counters only: no symbol, no quantity, no value.
    logger.info("transfer.applied", { moved: Number(data ?? 0) })

    invalidatePortfolio()
    invalidateReconciliation()
    return ok({ preview, applied: true, moved: Number(data ?? 0) })
  })
}
