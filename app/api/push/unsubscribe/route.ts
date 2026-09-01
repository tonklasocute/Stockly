import { guarded, ok, parseBody } from "@/lib/api"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"

const schema = z.object({ endpoint: z.url() })

export async function POST(request: Request) {
  return guarded(async () => {
    const body = await parseBody(request, schema)
    const supabase = await createClient()

    // RLS means a caller can only delete their own subscription, even knowing another endpoint.
    const { data, error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
      .select("id")

    if (error) throw error
    return ok({ removed: data?.length ?? 0 })
  })
}
