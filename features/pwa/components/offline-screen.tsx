"use client"

import { useRouter } from "next/navigation"
import { CloudOff, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export function OfflineScreen() {
  const router = useRouter()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <CloudOff className="size-6" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="text-muted-foreground mx-auto max-w-sm text-sm text-balance">
          Stockly is installed and ready, but your portfolio and live market data need an internet
          connection.
        </p>
      </div>
      <Button
        className="gap-2 max-sm:h-11"
        onClick={() => {
          // A refresh rather than a reload: if the network is back, the router re-fetches; if it is
          // still gone, the worker serves this page again instead of a browser error.
          router.refresh()
          router.replace("/dashboard")
        }}
      >
        <RefreshCw className="size-4" aria-hidden />
        Retry
      </Button>
    </main>
  )
}
