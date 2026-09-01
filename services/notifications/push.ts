import "server-only"

import webpush, { WebPushError } from "web-push"
import { serverEnv } from "@/lib/env.server"
import type { PushSubscriptionRow } from "@/types/database"

let configured = false

/** VAPID keys are read once, lazily, so a build without them still succeeds. */
function ensureConfigured(): boolean {
  if (!serverEnv.pushConfigured) return false
  if (!configured) {
    webpush.setVapidDetails(
      serverEnv.vapidSubject,
      serverEnv.vapidPublicKey,
      serverEnv.vapidPrivateKey,
    )
    configured = true
  }
  return true
}

export type PushPayload = {
  title: string
  body: string
  href?: string
  tag?: string
}

export type PushOutcome = "sent" | "expired" | "failed" | "unconfigured"

/**
 * Sends one push.
 *
 * The three outcomes are handled differently on purpose:
 *   sent     — delivered to the push service (not necessarily to a screen; that is out of our hands)
 *   expired  — 404/410: the subscription is permanently gone. Delete it. Never retry.
 *   failed   — anything else. Transient; the next alert will try again. There is no retry loop here
 *              because a queue that retries a stale price notification is worse than a lost one.
 */
export async function sendPush(
  subscription: Pick<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">,
  payload: PushPayload,
): Promise<PushOutcome> {
  if (!ensureConfigured()) return "unconfigured"

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 30, urgency: "normal" },
    )
    return "sent"
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      return "expired"
    }
    // The endpoint is logged, the payload is not — it describes a user's holdings.
    console.error("[push] send failed", {
      status: error instanceof WebPushError ? error.statusCode : "unknown",
      endpoint: subscription.endpoint.slice(0, 60),
    })
    return "failed"
  }
}

export function isPushConfigured(): boolean {
  return serverEnv.pushConfigured
}
