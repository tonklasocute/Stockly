import { Settings2 } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { getTranslations } from "next-intl/server"

/** Rendered instead of crashing when .env.local has not been filled in yet. */
export async function SetupRequired() {
  const t = await getTranslations("settings")
  return (
    <div className="mx-auto max-w-2xl rounded-xl border">
      <EmptyState
        icon={Settings2}
        title={t("setupRequired")}
        description={t("setupRequiredBody")}
      />
    </div>
  )
}
