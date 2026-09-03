"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { WifiOff } from "lucide-react"
import { toast } from "sonner"
import { useOnline } from "../use-pwa"
import { useTranslations } from "next-intl"

/**
 * A banner while offline, and a controlled refresh when the connection returns.
 *
 * Only shown when offline: a permanent "online" badge is noise, and the useful signal is the
 * exception. Reconnecting confirms itself through the app's existing toast channel rather than a
 * second banner with its own state and timer.
 *
 * On reconnect it invalidates the query cache once and refreshes the current route — not a burst of
 * requests to every endpoint the app knows.
 */
export function NetworkStatus() {
  const t = useTranslations("pwa")
  const online = useOnline()
  const router = useRouter()
  const queryClient = useQueryClient()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false

    // One invalidation, one refresh. Queries that are not mounted stay stale until something needs
    // them, which is the whole point of having a query cache.
    void queryClient.invalidateQueries()
    router.refresh()
    toast.success(t("network.backOnline"))
  }, [online, queryClient, router, t])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-muted text-muted-foreground safe-top sticky top-0 z-40 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium"
    >
      <WifiOff className="size-3.5" aria-hidden />{t("network.offline")}</div>
  )
}
