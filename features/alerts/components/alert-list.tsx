"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Bell, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"
import { describeAlert } from "@/domain/alerts"
import { toRuleFromRow } from "../to-rule"
import { apiFetch } from "@/lib/api-client"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AlertRow } from "@/types/database"
import { AlertDialog } from "./alert-dialog"

type Filter = "all" | "enabled" | "disabled"

const FILTERS: Record<Filter, string> = {
  all: "All alerts",
  enabled: "Active only",
  disabled: "Disabled only",
}

export function AlertList({
  alerts,
  portfolioId,
}: {
  alerts: AlertRow[]
  portfolioId?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [editing, setEditing] = useState<AlertRow | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    return alerts.filter(
      (a) =>
        (filter === "all" || (filter === "enabled") === a.enabled) &&
        (!q || (a.symbol ?? "PORTFOLIO").includes(q)),
    )
  }, [alerts, query, filter])

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: (_d, { enabled }) => {
      toast.success(enabled ? "Alert enabled." : "Alert disabled.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/alerts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Alert deleted.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function openNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by symbol"
            className="pl-9"
            aria-label="Search alerts"
          />
        </div>
        <Select value={filter} onValueChange={(value) => setFilter((value as Filter) ?? "all")}>
          <SelectTrigger aria-label="Filter alerts" className="sm:w-40">
            <SelectValue>{(value) => FILTERS[value as Filter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {FILTERS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={openNew} className="gap-2 max-sm:w-full">
          <Plus className="size-4" aria-hidden />
          New alert
        </Button>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Bell}
            title="No alerts yet"
            description="Set a price target and Stockly watches it on the server — you will hear about it whether or not the app is open."
            action={
              <Button onClick={openNew} className="gap-2">
                <Plus className="size-4" aria-hidden />
                New alert
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Search} title="No matches" description="No alert matches those filters." />
        </div>
      ) : (
        <ul className="grid gap-2">
          {visible.map((alert) => (
            <li key={alert.id} className="bg-card rounded-xl border p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {alert.symbol ? (
                      <Link
                        href={`/stocks/${alert.symbol}`}
                        className="tap font-semibold underline-offset-4 hover:underline"
                      >
                        {alert.symbol}
                      </Link>
                    ) : (
                      <span className="font-semibold">Portfolio</span>
                    )}
                    {/* State is shown as a word as well as a dot: colour alone is not a label. */}
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1.5",
                        alert.enabled ? "border-gain/40 text-gain" : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          alert.enabled ? "bg-gain" : "bg-muted-foreground/50",
                        )}
                        aria-hidden
                      />
                      {alert.enabled ? "Active" : "Disabled"}
                    </Badge>
                    {alert.state === "triggered" && alert.enabled && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Waiting to reset
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {describeAlert(toRuleFromRow(alert))}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {alert.last_triggered_at
                      ? `Last fired ${formatTime(alert.last_triggered_at)}`
                      : "Not fired yet"}
                    {alert.cooldown_minutes > 0 && ` · ${alert.cooldown_minutes} min quiet period`}
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for the ${alert.symbol ?? "portfolio"} alert`}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => toggle.mutate({ id: alert.id, enabled: !alert.enabled })}
                      className="gap-2"
                    >
                      <Bell className="size-4" aria-hidden />
                      {alert.enabled ? "Disable" : "Enable"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(alert)
                        setDialogOpen(true)
                      }}
                      className="gap-2"
                    >
                      <Pencil className="size-4" aria-hidden />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      className="gap-2"
                      onSelect={() => {
                        if (confirm(`Delete this ${alert.symbol ?? "portfolio"} alert?`)) {
                          remove.mutate(alert.id)
                        }
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        alert={editing}
      />
    </div>
  )
}
