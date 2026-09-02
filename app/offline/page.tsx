import type { Metadata } from "next"
import { OfflineScreen } from "@/features/pwa/components/offline-screen"

export const metadata: Metadata = { title: "Offline" }

/**
 * Precached by the service worker and served for any navigation that fails. Signed-out by design:
 * it must render with no network and no session.
 *
 * Rendered per request rather than at build time, for the CSP nonce — see the auth layout. The
 * service worker caches the response *and its headers*, so the copy it replays offline carries the
 * nonce that matches its own HTML.
 */
export const dynamic = "force-dynamic"
export default function OfflinePage() {
  return <OfflineScreen />
}
