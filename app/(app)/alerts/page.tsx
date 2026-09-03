import type { Metadata } from "next"
import Link from "next/link"
import { History } from "lucide-react"
import { Section } from "@/components/metric"
import { Button } from "@/components/ui/button"
import { AlertList } from "@/features/alerts/components/alert-list"
import { listAlerts, listAlertEvents } from "@/features/alerts/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatTime } from "@/lib/format"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("alerts") }
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("alerts")
  const locale = await appLocale()
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
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("alerts")}</h1>
          <p className="text-muted-foreground text-sm">
            {activeCount} active · evaluated on the server every few minutes
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/settings/notifications" />}
          variant="outline"
          size="sm"
        >{t("notificationSettings")}</Button>
      </div>

      <AlertList alerts={alerts} portfolioId={active?.id} />

      {events.length > 0 && (
        <Section
          title={t("history")}
          description={t("historyHint")}
        >
          <ul className="divide-y">
            {events.slice(0, 15).map((event) => (
              <li key={event.id} className="flex items-start gap-3 py-2.5">
                <History className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{event.message}</p>
                  <p className="text-muted-foreground text-xs">{formatTime(event.triggered_at, locale)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
