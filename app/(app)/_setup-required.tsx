import { Settings2 } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

/** Rendered instead of crashing when .env.local has not been filled in yet. */
export function SetupRequired() {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border">
      <EmptyState
        icon={Settings2}
        title="Supabase is not configured"
        description="Copy .env.example to .env.local, fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, apply supabase/migrations, then restart the dev server."
      />
    </div>
  )
}
