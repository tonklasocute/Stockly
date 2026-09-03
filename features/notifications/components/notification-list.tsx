"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Bell, Newspaper, BellRing, Check, Coins, TrendingUp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { apiFetch } from "@/lib/api-client"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { NotificationCategory, NotificationRow } from "@/types/database"

const CATEGORY_ICON: Record<NotificationCategory, typeof Bell> = {
  price: BellRing,
  portfolio: TrendingUp,
  dividend: Coins,
  system: Bell,
  news: Newspaper,
}

export function NotificationList({
  notifications,
  unread,
}: {
  notifications: NotificationRow[]
  unread: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}`, { method: "PATCH" }),
    onSuccess: () => router.refresh(),
    onError: (error: Error) => toast.error(error.message),
  })

  const markAll = useMutation({
    mutationFn: () => apiFetch("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      toast.success("All notifications marked as read.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => router.refresh(),
    onError: (error: Error) => toast.error(error.message),
  })

  if (notifications.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Bell}
          title="Nothing here yet"
          description="When one of your alerts triggers, or a dividend is recorded, it appears here."
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <Check className="size-4" aria-hidden />
            Mark all as read
          </Button>
        </div>
      )}

      <ul className="grid gap-2">
        {notifications.map((notification) => {
          const Icon = CATEGORY_ICON[notification.category]
          const isUnread = notification.read_at === null

          return (
            <li
              key={notification.id}
              className={cn(
                "bg-card flex items-start gap-3 rounded-xl border p-3.5",
                // Unread is marked by a left rule and bold text, not by colour alone.
                isUnread && "border-l-foreground border-l-2",
              )}
            >
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                {notification.href ? (
                  <Link
                    href={notification.href}
                    className="tap block"
                    onClick={() => {
                      if (isUnread) {
                        setBusy(notification.id)
                        markRead.mutate(notification.id)
                      }
                    }}
                  >
                    <span className={cn("block", isUnread ? "font-semibold" : "font-medium")}>
                      {notification.title}
                    </span>
                  </Link>
                ) : (
                  <span className={cn("block", isUnread ? "font-semibold" : "font-medium")}>
                    {notification.title}
                  </span>
                )}
                <p className="text-muted-foreground mt-0.5 text-sm">{notification.body}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatTime(notification.created_at)}
                  {isUnread && <span className="ml-2 font-medium">· Unread</span>}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {isUnread && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mark as read"
                    disabled={busy === notification.id}
                    onClick={() => markRead.mutate(notification.id)}
                  >
                    <Check className="size-4" aria-hidden />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete notification"
                  onClick={() => remove.mutate(notification.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
