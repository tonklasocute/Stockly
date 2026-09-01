import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST only, so a prefetch or a crawler can never sign anyone out. Called by fetch from the user
 * menu (which clears client caches first) and usable as a plain form target without JavaScript.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  // A form post expects a redirect; a fetch just needs the cookies cleared.
  const wantsHtml = request.headers.get("accept")?.includes("text/html")
  return wantsHtml
    ? NextResponse.redirect(new URL("/login", request.url), { status: 303 })
    : NextResponse.json({ success: true })
}
