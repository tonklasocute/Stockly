import {
  ApiError,
  MAX_IMPORT_REQUEST_BYTES,
  enforceRateLimit,
  guarded,
  ok,
  parseBody,
} from "@/lib/api"
import { ImportRejected, applyImport } from "@/features/imports/apply"
import { listImportSessions } from "@/features/imports/queries"
import { applyRequestSchema } from "@/features/imports/schema"
import { invalidateImports } from "@/lib/cache"
import { invalidatePortfolio } from "@/lib/cache"
import { toPage } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"

/** Import history, newest first. RLS scopes it; a portfolio filter narrows it further. */
export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const page = await listImportSessions(
      url.searchParams.get("portfolioId") ?? undefined,
      toPage(url.searchParams.get("page")),
    )
    return ok({ sessions: page.rows, meta: page })
  })
}

/**
 * Applies an import.
 *
 * The only endpoint in phase 12 that creates a transaction, and it creates **ordinary** ones —
 * replayed by the same engine as anything typed in by hand, so every downstream figure updates
 * because the transaction set changed and for no other reason.
 *
 * Ownership is the database's job in both directions: `user_id` comes from the session and never
 * the body, and the composite foreign key to `(portfolio_id, user_id)` refuses a portfolio the
 * caller does not own whatever the request claims.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    // Applying is a bulk write. One a second is generous for a human and stops a loop.
    enforceRateLimit(`imports:apply:${userId}`, 10, 60)

    const body = await parseBody(request, applyRequestSchema, {
      maxBytes: MAX_IMPORT_REQUEST_BYTES,
    })
    const supabase = await createClient()

    try {
      const result = await applyImport(supabase, body, userId)

      // Holdings, P&L and every analytic derive from the transaction set that just changed.
      invalidatePortfolio()
      invalidateImports()

      return ok(
        {
          sessionId: result.session.id,
          status: result.session.status,
          totalRows: result.session.total_rows,
          created: result.created,
          duplicates: result.duplicates,
          rejected: result.rejected,
        },
        201,
      )
    } catch (error) {
      if (error instanceof ImportRejected) {
        // A refusal the user can act on, not a failure: the message names what to fix.
        throw new ApiError("VALIDATION_ERROR", error.message)
      }
      if ((error as { code?: string }).code === "23503") {
        throw new ApiError("VALIDATION_ERROR", "That portfolio could not be found.")
      }
      throw error
    }
  })
}
