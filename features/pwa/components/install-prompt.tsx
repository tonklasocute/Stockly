"use client"

import { useEffect, useState } from "react"
import { Download, Share, SquarePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  dismissInstallPrompt,
  useInstallDismissed,
  usePlatform,
  useStandalone,
} from "../use-pwa"

/** The Chromium-only event that lets a page trigger the real install dialog. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Invitation to install, shown at most once a fortnight and never in an installed app.
 *
 * Two paths, because the platforms genuinely differ: Chromium hands the page a real install event,
 * while Safari has no such API — so iOS gets the actual Share → Add to Home Screen steps rather than
 * a fake button that would do nothing.
 *
 * Visibility is derived, never stored: it is a function of platform, install state, the captured
 * event and the dismissal timestamp, so there is no effect writing state during render.
 */
export function InstallPrompt() {
  const standalone = useStandalone()
  const platform = usePlatform()
  const dismissed = useInstallDismissed()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Keep the event so the dialog can open from a real user gesture later.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  // iOS never fires beforeinstallprompt, so it is offered instructions instead of a dead button.
  const canOffer = platform === "ios" || deferred !== null
  const visible = canOffer && !standalone && !installed && !dismissed

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === "dismissed") dismissInstallPrompt()
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Install Stockly"
      className="bg-card safe-bottom fixed inset-x-3 bottom-20 z-40 rounded-xl border p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm lg:bottom-4"
    >
      <div className="flex items-start gap-3">
        <span className="bg-foreground text-background flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold">
          S
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install Stockly</p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Install Stockly on your device for a faster, app-like experience.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismissInstallPrompt}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {platform === "ios" ? (
        <ol className="text-muted-foreground mt-3 space-y-1.5 border-t pt-3 text-sm">
          <li className="flex items-center gap-2">
            <span className="tabular w-4 shrink-0 font-medium">1.</span>
            Tap <Share className="size-4 shrink-0" aria-hidden /> Share
          </li>
          <li className="flex items-center gap-2">
            <span className="tabular w-4 shrink-0 font-medium">2.</span>
            Choose <SquarePlus className="size-4 shrink-0" aria-hidden /> Add to Home Screen
          </li>
          <li className="flex items-center gap-2">
            <span className="tabular w-4 shrink-0 font-medium">3.</span>
            Tap Add
          </li>
        </ol>
      ) : (
        <Button onClick={install} className="mt-3 w-full gap-2">
          <Download className="size-4" aria-hidden />
          Install
        </Button>
      )}
    </div>
  )
}
