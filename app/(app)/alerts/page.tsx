import type { Metadata } from "next"
import Link from "next/link"
import { History } from "lucide-react"
import { Section } from "@/components/metric"
import { Button } from "@/components/ui/button"
import { AlertList } from "@/features/alerts/components/alert-list"
import { listAlerts, listAlertEvents } from "@/features/alerts/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatTime } from "@/lib/format"

export const metadata: Metadata = { title: "Alerts" }

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const [alerts, events, { active }] = await Promise.all([
    listAlerts(),
    listAlertEvents(),
    resolveActivePortfolio(p),
  ])

  const activeCount = alerts.filter((a) => a.enabled).length

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Alerts</h1>
          <p className="text-muted-foreground text-sm">
            {activeCount} active · evaluated on the server every few minutes
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/settings/notifications" />}
          variant="outline"
          size="sm"
        >
          Notification settings
        </Button>
      </div>

      <AlertList alerts={alerts} portfolioId={active?.id} />

      {events.length > 0 && (
        <Section
          title="Trigger history"
          description="Every time one of your alerts fired, and at what value."
        >
          <ul className="divide-y">
            {events.slice(0, 15).map((event) => (
              <li key={event.id} className="flex items-start gap-3 py-2.5">
                <History className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{event.message}</p>
                  <p className="text-muted-foreground text-xs">{formatTime(event.triggered_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
