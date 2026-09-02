"use client"

import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
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
          title="Something went wrong"
          /* The real message stays in the logs; the user gets something actionable instead. */
          description="We could not load this page. Try again — if it keeps happening, check your connection."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </div>
    </div>
  )
}
