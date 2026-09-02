import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AppChrome } from "@/components/app-shell/app-chrome"
import { unreadCount } from "@/features/notifications/queries"
import { listPortfolios } from "@/features/portfolios/queries"
import { isSupabaseConfigured } from "@/lib/env"
import { getUser } from "@/lib/supabase/server"
import { SetupRequired } from "./_setup-required"

/**
 * Nothing under here is ever indexed.
 *
 * Three independent reasons it cannot be: the route redirects a session-less request to /login,
 * robots.txt disallows the paths, and this. The third one is what still holds if somebody shares a
 * signed-in URL and a crawler follows it with a stale cookie.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupRequired />

  // Middleware already redirects, but a layout must not assume it ran (e.g. the matcher changes).
  const user = await getUser()
  if (!user) redirect("/login")

  // Both loads are independent; the unread count is cache()d so the nav asks for it once.
  const [portfolios, unread] = await Promise.all([listPortfolios(), unreadCount()])

  return (
    <AppChrome portfolios={portfolios} email={user.email ?? ""} unread={unread}>
      {children}
    </AppChrome>
  )
}
