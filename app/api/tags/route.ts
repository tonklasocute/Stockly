import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { listTags } from "@/features/personalization/queries"
import { MAX_TAGS_PER_USER, tagSchema } from "@/features/personalization/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Tags belong to a user, not to a portfolio: "High conviction" means the same thing across every
 * portfolio somebody owns, and a per-portfolio tag would have to be recreated in each.
 *
 * A tag is metadata. Creating, renaming or deleting one cannot move a holding, a cost basis or a
 * P&L figure — `domain/personalization-boundary.test.ts` asserts it.
 */
export async function GET() {
  return guarded(async () => ok({ tags: await listTags() }))
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, tagSchema)
    const supabase = await createClient()

    // A cap the database can answer, unlike a counter a cold start forgets.
    const { count } = await supabase.from("tags").select("id", { count: "exact", head: true })
    if ((count ?? 0) >= MAX_TAGS_PER_USER) {
      throw new ApiError("CONFLICT", `You can have at most ${MAX_TAGS_PER_USER} tags.`)
    }

    const { data, error } = await supabase
      .from("tags")
      .insert({ user_id: userId, name: body.name, color: body.color })
      .select("*")
      .single()

    // The unique index is case-insensitive, so "Growth" and "growth" cannot both exist and quietly
    // split a group in two.
    if (error?.code === "23505") throw new ApiError("CONFLICT", "You already have a tag with that name.")
    if (error) throw error

    invalidatePersonalization()
    return ok(data, 201)
  })
}
