import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createNotificationService } from "@/services/notifications"
import type { Database } from "@/types/database"
import { describeError, logger } from "@/lib/log"

/**
 * DIVIDEND_RECEIVED is the one alert type the scheduled job never evaluates.
 *
 * There is nothing to poll: the event is a row the user just wrote. Raising the notification from
 * the write is immediate, exact, and cannot double-fire — as opposed to a cron that would have to
 * diff the dividends table against itself every few minutes to notice.
 *
 * Best-effort by design: a failure here must not fail the dividend the user was recording.
 */
export async function notifyDividendRecorded(
  supabase: SupabaseClient<Database>,
  userId: string,
  dividend: { symbol: string; netAmount: number; currency: string },
): Promise<void> {
  try {
    const { data: alert } = await supabase
      .from("alerts")
      .select("id")
      .eq("type", "DIVIDEND_RECEIVED")
      .eq("enabled", true)
      .maybeSingle()

    if (!alert) return

    await createNotificationService(supabase).deliver({
      userId,
      category: "dividend",
      title: `Dividend recorded for ${dividend.symbol}`,
      // The amount is the user's own income. It stays out of the push payload, which a lock screen
      // may show to whoever is holding the phone.
      body: "Open Stockly to see the payment and its effect on your yield.",
      href: "/dividends",
      alertId: alert.id,
    })
  } catch (error) {
    logger.error("alerts.dividend_notification_failed", describeError(error))
  }
}
