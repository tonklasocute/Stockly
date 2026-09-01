import { redirect } from "next/navigation"
import { AppChrome } from "@/components/app-shell/app-chrome"
import { listPortfolios } from "@/features/portfolios/queries"
import { isSupabaseConfigured } from "@/lib/env"
import { getUser } from "@/lib/supabase/server"
import { SetupRequired } from "./_setup-required"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) return <SetupRequired />

  // Middleware already redirects, but a layout must not assume it ran (e.g. the matcher changes).
  const user = await getUser()
  if (!user) redirect("/login")

  const portfolios = await listPortfolios()

  return (
    <AppChrome portfolios={portfolios} email={user.email ?? ""}>
      {children}
    </AppChrome>
  )
}
