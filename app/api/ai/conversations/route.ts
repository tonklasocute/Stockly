import { guarded, ok } from "@/lib/api"
import { listConversations } from "@/features/ai/queries"

/** The caller's own research history. RLS scopes it; no user_id appears in the query. */
export async function GET() {
  return guarded(async () => ok({ conversations: await listConversations() }))
}
