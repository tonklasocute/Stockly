"use client"

import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { useTranslations } from "next-intl"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("errors")
  const tc = useTranslations("common")
  useEffect(() => {
    // Browser console, deliberately: this runs in the user's tab, where `lib/log.ts` would emit
    // JSON nobody reads and the server has already logged the failure against its request id.
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border">
        <EmptyState
          icon={TriangleAlert}
          title={t("page.title")}
          /* The real message stays in the logs; the user gets something actionable instead. */
          description={t("page.body")}
          action={<Button onClick={reset}>{tc("actions.retry")}</Button>}
        />
      </div>
    </div>
  )
}
