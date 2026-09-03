import type { Metadata } from "next"
import Link from "next/link"
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react"
import { Metric, Section } from "@/components/metric"
import { DataHealth } from "@/features/portfolios/components/data-health"
import { loadDataQuality } from "@/features/data-quality/loader"
import { loadIntelligence } from "@/features/intelligence/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadAllFxRates } from "@/services/fx"
import { getMarketStatuses } from "@/services/market-data"
import type { DataQualitySeverity } from "@/domain/data-quality"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"

export const metadata: Metadata = { title: "Data quality" }
export const dynamic = "force-dynamic"

const ICONS: Record<DataQualitySeverity, typeof Info> = {
  ERROR: TriangleAlert,
  WARNING: TriangleAlert,
  NOTICE: CircleAlert,
  INFO: Info,
}

/** Severity is spelled out beside every issue; colour never carries the meaning alone. */
const TONE: Record<DataQualitySeverity, string> = {
  ERROR: "text-loss",
  WARNING: "text-loss",
  NOTICE: "text-foreground",
  INFO: "text-muted-foreground",
}

/**
 * What Stockly knows it does not know.
 *
 * Transparent counts, each pointing at the resource it concerns — never a single "data quality
 * score", which would be a number nobody could reproduce assembled from incommensurable things.
 */
export default async function DataQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const locale = await appLocale()
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const [report, bundle] = await Promise.all([loadDataQuality(active.id), loadIntelligence(active.id)])

  // The provider-facing half. Both degrade to "unavailable" rather than failing the page.
  const [statuses, fx] = await Promise.all([
    getMarketStatuses().catch(() => null),
    loadAllFxRates(bundle.baseCurrency).catch(() => null),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Data quality</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · what Stockly could not confirm, and why a figure reads N/A
        </p>
      </div>

      <Section
        title={
          report.issues.length === 0
            ? "Nothing to report"
            : `${report.issues.length} issue${report.issues.length === 1 ? "" : "s"}`
        }
        description="Computed from the portfolio as it stands, every time this page loads — so an issue cannot linger after the thing that caused it was fixed."
      >
        {report.issues.length === 0 ? (
          <div className="flex items-center gap-3 py-4">
            <CircleCheck className="text-gain size-5 shrink-0" aria-hidden />
            <p className="text-muted-foreground text-sm">
              Every holding is priced, every currency has a rate, and no import needs attention.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {report.issues.map((issue) => {
              const Icon = ICONS[issue.severity]
              const body = (
                <>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[issue.severity])} aria-hidden />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium">{issue.title}</p>
                    <p className="text-muted-foreground text-xs">{issue.detail}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-[10px] font-medium tracking-wide uppercase">
                    {issue.severity}
                  </span>
                </>
              )

              return (
                <li key={issue.category}>
                  {issue.href ? (
                    <Link
                      href={`${issue.href}?p=${active.id}`}
                      className="hover:bg-accent/50 flex items-start gap-3 rounded-lg py-3 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Scheduled refresh"
        description="Quotes and exchange rates are warmed on a schedule so your first page load of the day is not the request that pays for them."
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Last run"
            value={
              report.lastRefresh
                ? formatTime(report.lastRefresh.started_at, locale)
                : <span className="text-muted-foreground">Never</span>
            }
            hint={report.lastRefresh ? `Status: ${report.lastRefresh.status}` : "No run recorded yet"}
          />
          <Metric
            label="Refreshed"
            value={report.lastRefresh ? String(report.lastRefresh.succeeded) : "N/A"}
            hint="Quotes and rates fetched"
          />
          <Metric
            label="Failures"
            value={report.lastRefresh ? String(report.lastRefresh.failed) : "N/A"}
            hint={report.lastRefresh?.error_summary ?? "Providers that did not answer"}
          />
        </dl>
      </Section>

      {statuses && fx && (
        <div className="bg-card rounded-xl border p-4 sm:p-5">
          <DataHealth baseCurrency={bundle.baseCurrency} statuses={statuses} fx={fx} />
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Stockly reports what it could not confirm rather than filling the gap with a zero. A figure
        it cannot compute honestly reads N/A everywhere it appears — see{" "}
        <Link href="/settings" className="underline-offset-4 hover:underline">
          Settings
        </Link>{" "}
        for provider status.
      </p>
    </div>
  )
}
