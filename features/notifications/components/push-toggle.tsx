"use client"

import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Bell, BellOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import { notifyPushPermissionChanged, usePushPermission } from "@/features/pwa/use-pwa"
import { useTranslations } from "next-intl"

/**
 * VAPID keys travel as base64url; the subscription API wants raw bytes backed by a plain
 * ArrayBuffer, so the buffer is allocated explicitly rather than inferred.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/**
 * Push opt-in.
 *
 * Permission is never requested on page load — a prompt that arrives before the user knows what it
 * is gets denied, and a denial is permanent until they dig into browser settings. It is requested
 * only from this button, after the sentence explaining what it does.
 *
 * Four states, four different UIs: unsupported (iOS Safari outside an installed app, older
 * browsers), default, granted, denied. A denied permission is never re-requested.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const t = useTranslations("notifications")
  const permission = usePushPermission()
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    if (permission === "unsupported") return
    // Asynchronous by nature — whether this browser already holds a subscription can only be
    // answered by the service worker, so it is read here and not during render.
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(Boolean(subscription)))
      .catch(() => setSubscribed(false))
  }, [permission])

  const subscribe = useMutation({
    mutationFn: async () => {
      const result = await Notification.requestPermission()
      notifyPushPermissionChanged()
      if (result !== "granted") throw new Error(t("push.denied"))

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // required by Chromium, and the honest contract anyway
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })

      const json = subscription.toJSON()
      await apiFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          userAgent: navigator.userAgent.slice(0, 300),
        }),
      })
    },
    onSuccess: () => {
      setSubscribed(true)
      toast.success(t("push.enabled"))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const unsubscribe = useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return
      await apiFetch("/api/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
      await subscription.unsubscribe()
    },
    onSuccess: () => {
      setSubscribed(false)
      toast.success(t("push.disabled"))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (!vapidPublicKey) {
    return (
      <p className="text-muted-foreground text-sm">{t("push.notConfigured")}</p>
    )
  }

  if (permission === "unsupported") {
    return (
      <p className="text-muted-foreground text-sm">
        This browser cannot deliver push notifications. On iPhone and iPad, add Stockly to your Home
        Screen first — Safari only supports push for installed apps. In-app notifications work
        everywhere.
      </p>
    )
  }

  if (permission === "denied") {
    return (
      <p className="text-muted-foreground text-sm">
        Notifications are blocked for Stockly. Your browser will not ask again — allow them in its
        site settings if you change your mind. In-app notifications are unaffected.
      </p>
    )
  }

  const pending = subscribe.isPending || unsubscribe.isPending

  return (
    <div className="space-y-2">
      <Button
        variant={subscribed ? "outline" : "default"}
        className="gap-2"
        disabled={pending}
        onClick={() => (subscribed ? unsubscribe.mutate() : subscribe.mutate())}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : subscribed ? (
          <BellOff className="size-4" aria-hidden />
        ) : (
          <Bell className="size-4" aria-hidden />
        )}
        {subscribed ? "Disable on this device" : "Enable notifications"}
      </Button>
      <p className="text-muted-foreground text-xs">
        {subscribed
          ? "This device will receive a push when one of your alerts triggers."
          : "Get notified when your alerts trigger, even when Stockly is closed."}
      </p>
    </div>
  )
}
