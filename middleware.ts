import type { NextRequest } from "next/server"
import { isSupabaseConfigured } from "@/lib/env"
import { updateSession } from "@/lib/supabase/middleware"

export async function middleware(request: NextRequest) {
  // Without credentials the app renders a setup page rather than redirect-looping.
  if (!isSupabaseConfigured()) return
  return updateSession(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
