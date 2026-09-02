import "server-only"

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"
import { PAGE_SIZE, pageRange, toPageResult, type Page } from "@/lib/pagination"
import { logger } from "@/lib/log"
import type {
  NotificationCategory,
  NotificationPreferencesRow,
  NotificationRow,
} from "@/types/database"

export async function listNotifications(
  page: number,
  category?: NotificationCategory,
  pageSize = PAGE_SIZE,
): Promise<Page<NotificationRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)

  let query = supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (category) query = query.eq("category", category)

  const { data, error, count } = await query
  if (error) throw error
  return toPageResult(data ?? [], count ?? (data?.length ?? 0), page, pageSize)
}

/**
 * The unread badge, rendered by the app shell on every page. `cache()` keeps it to one query per
 * request even though the sidebar and the tab bar both ask for it.
 */
export const unreadCount = cache(async (): Promise<number> => {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null)

  // The badge is decoration: a failure here must not take down every page in the app.
  if (error) {
    logger.error("notifications.unread_count_failed", { code: error.code })
    return 0
  }
  return count ?? 0
})

export async function getPreferences(): Promise<NotificationPreferencesRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .maybeSingle()

  if (error) throw error
  return data
}
