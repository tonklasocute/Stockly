import { fail, guarded, ok, parseBody } from "@/lib/api"
import { savedScreenSchema } from "@/features/screener/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, savedScreenSchema)
    const { id } = await params
    const supabase = await createClient()

    // Another user's screen id updates zero rows and 404s: the policy is the authorization.
    const { data, error } = await supabase
      .from("saved_screens")
      .update({ name: body.name, definition: body.definition })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    return data ? ok(data) : fail("NOT_FOUND", "Screen not found.")
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saved_screens")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    return data ? ok({ id: data.id }) : fail("NOT_FOUND", "Screen not found.")
  })
}
