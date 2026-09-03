import { guarded, ok } from "@/lib/api"
import { listNotifications } from "@/features/notifications/queries"
import { toPage } from "@/lib/pagination"
import type { NotificationCategory } from "@/types/database"

const CATEGORIES = ["price", "portfolio", "dividend", "system", "news"] as const

export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const raw = url.searchParams.get("category")
    const category = CATEGORIES.includes(raw as NotificationCategory)
      ? (raw as NotificationCategory)
      : undefined

    return ok(await listNotifications(toPage(url.searchParams.get("page")), category))
  })
}
