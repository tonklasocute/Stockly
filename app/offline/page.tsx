import type { Metadata } from "next"
import { OfflineScreen } from "@/features/pwa/components/offline-screen"

export const metadata: Metadata = { title: "Offline" }

/**
 * Precached by the service worker and served for any navigation that fails. It is deliberately
 * static and signed-out: it must render with no network and no session.
 */
export default function OfflinePage() {
  return <OfflineScreen />
}
