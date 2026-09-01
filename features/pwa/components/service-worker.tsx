"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { APP_VERSION } from "@/lib/version"

/**
 * Registers the service worker and offers an update when a new one is waiting.
 *
 * The worker is registered as `/sw.js?v=<version>`: a changed URL is a different worker to the
 * browser, so shipping a release installs one without any build-time rewriting of sw.js.
 *
 * The update is never forced. Reloading under someone mid-way through a transaction form would
 * discard their input, so the new worker waits until they accept.
 */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    // A worker registered by `next dev` would cache development chunks that never match a rebuild.
    if (process.env.NODE_ENV !== "production") return

    let registration: ServiceWorkerRegistration | undefined

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, {
          scope: "/",
        })

        if (registration.waiting) setWaiting(registration.waiting)

        registration.addEventListener("updatefound", () => {
          const installing = registration?.installing
          if (!installing) return
          installing.addEventListener("statechange", () => {
            // "installed" with an existing controller means an update is ready, not a first install.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(installing)
            }
          })
        })
      } catch (error) {
        // An unsupported or blocked worker must never break the app; it just loses offline support.
        console.warn("[pwa] service worker registration failed", error)
      }
    }

    void register()

    // The new worker calls skipWaiting, which changes the controller; that is when we reload.
    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
  }, [])

  if (!waiting) return null

  return (
    <div
      role="status"
      className="bg-card safe-bottom fixed inset-x-3 bottom-20 z-50 flex items-center gap-3 rounded-xl border p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm lg:bottom-4"
    >
      <RefreshCw className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <p className="flex-1 text-sm">A new version of Stockly is available.</p>
      <Button size="sm" className="max-sm:h-10" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
        Refresh
      </Button>
    </div>
  )
}

/** Wipes every cache the worker holds. Called on sign-out, so a shared device leaks nothing. */
export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" })
  } catch (error) {
    console.warn("[pwa] cache cleanup failed", error)
  }
}
