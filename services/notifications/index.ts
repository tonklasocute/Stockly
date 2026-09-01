import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, NotificationCategory } from "@/types/database"
import { sendPush } from "./push"
import type { DeliveryResult, NotificationRequest, NotificationService } from "./types"

/**
 * The only place a notification is created and fanned out to channels.
 *
 * In-app first: the row in `notifications` is the record of truth, and it is written even when push
 * is unconfigured, denied or broken. Push is a best-effort convenience layered on top — losing it
 * must never mean losing the notification.
 */

/** How many notifications one user may receive per run before the rest are dropped. */
const MAX_PER_USER_PER_RUN = 10

const CATEGORY_PREFERENCE: Record<NotificationCategory, keyof PreferenceRow> = {
  price: "price",
  portfolio: "portfolio",
  dividend: "dividend",
  system: "system",
}

type PreferenceRow = {
  price: boolean
  portfolio: boolean
  dividend: boolean
  system: boolean
  push: boolean
}

const DEFAULT_PREFERENCES: PreferenceRow = {
  price: true,
  portfolio: true,
  dividend: true,
  system: true,
  push: true,
}

export function createNotificationService(
  supabase: SupabaseClient<Database>,
): NotificationService {
  /** Preferences are read once per service instance; a run touches the same users repeatedly. */
  const preferenceCache = new Map<string, PreferenceRow>()
  const sentThisRun = new Map<string, number>()

  async function preferencesFor(userId: string): Promise<PreferenceRow> {
    const cached = preferenceCache.get(userId)
    if (cached) return cached

    const { data } = await supabase
      .from("notification_preferences")
      .select("price, portfolio, dividend, system, push")
      .eq("user_id", userId)
      .maybeSingle()

    // A missing row means the defaults, not silence.
    const preferences = data ?? DEFAULT_PREFERENCES
    preferenceCache.set(userId, preferences)
    return preferences
  }

  async function deliver(request: NotificationRequest): Promise<DeliveryResult> {
    const empty: DeliveryResult = {
      notificationId: null,
      inApp: false,
      pushSent: 0,
      pushFailed: 0,
      pushExpired: 0,
      suppressed: true,
    }

    const preferences = await preferencesFor(request.userId)
    if (!preferences[CATEGORY_PREFERENCE[request.category]]) return empty

    // Spam ceiling: a hundred alerts crossing at once must not become a hundred pushes. The
    // notifications beyond the cap are dropped for this run rather than queued — a stale price
    // notification delivered later is worse than none.
    const already = sentThisRun.get(request.userId) ?? 0
    if (already >= MAX_PER_USER_PER_RUN) return empty
    sentThisRun.set(request.userId, already + 1)

    const { data, error } = await supabase
      .from("notifications")
      .insert({
        user_id: request.userId,
        category: request.category,
        title: request.title,
        body: request.body,
        href: request.href ?? null,
        alert_id: request.alertId ?? null,
        read_at: null,
      })
      .select("id")
      .single()

    if (error) {
      console.error("[notifications] insert failed", { userId: request.userId, code: error.code })
      return empty
    }

    const result: DeliveryResult = {
      notificationId: data.id,
      inApp: true,
      pushSent: 0,
      pushFailed: 0,
      pushExpired: 0,
      suppressed: false,
    }

    if (!preferences.push) return result

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", request.userId)

    if (!subscriptions?.length) return result

    const expired: string[] = []
    await Promise.all(
      subscriptions.map(async (subscription) => {
        const outcome = await sendPush(subscription, {
          title: request.title,
          body: request.body,
          href: request.href,
          // Same alert replaces its own previous notification instead of stacking.
          tag: request.alertId ?? request.category,
        })
        if (outcome === "sent") result.pushSent += 1
        else if (outcome === "expired") expired.push(subscription.id)
        else if (outcome === "failed") result.pushFailed += 1
      }),
    )

    if (expired.length > 0) {
      // 404/410 means the browser threw the subscription away. Keeping it would fail forever.
      await supabase.from("push_subscriptions").delete().in("id", expired)
      result.pushExpired = expired.length
    }

    return result
  }

  return {
    deliver,
    async deliverMany(requests) {
      const results: DeliveryResult[] = []
      // Sequential: the per-user cap has to see each decision before making the next one.
      for (const request of requests) results.push(await deliver(request))
      return results
    },
  }
}

export type { NotificationRequest, DeliveryResult, NotificationService } from "./types"
export { isPushConfigured } from "./push"
