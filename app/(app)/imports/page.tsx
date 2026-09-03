import type { Metadata } from "next"
import Link from "next/link"
import { Section } from "@/components/metric"
import { PaginationNav } from "@/components/pagination-nav"
import { ImportWizard } from "@/features/imports/components/import-wizard"
import { listImportSessions } from "@/features/imports/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatTime } from "@/lib/format"
import { toPage } from "@/lib/pagination"
import { cn } from "@/lib/utils"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("import") }
}

/**
 * The CSP is nonce-based, so every route that renders a script must be server-rendered — a
 * statically prerendered page has no nonce and its scripts are blocked in production only.
 */
export const dynamic = "force-dynamic"

const STATUS_LABELS = {
  APPLIED: "Imported",
  PARTIAL: "Partly imported",
  FAILED: "Failed",
} as const

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; page?: string }>
}) {
  const t = await getTranslations("imports")
  const locale = await appLocale()
  const query = await searchParams
  const { active } = await resolveActivePortfolio(query.p)
  if (!active) return <NoPortfolio />

  const history = await listImportSessions(active.id, toPage(query.page))

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("importTransactions")}</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · imported trades become ordinary transactions, and every figure is
          recalculated from them
        </p>
      </div>

      <ImportWizard portfolioId={active.id} portfolioName={active.name} />

      <Section
        title={t("history")}
        description={t("historyHint")}
      >
        {history.rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("nothingYet")}</p>
        ) : (
          <ul className="divide-y">
            {history.rows.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <Link
                  href={`/imports/${session.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {session.filename}
                </Link>
                <span
                  className={cn(
                    "text-xs font-medium",
                    session.status === "FAILED" ? "text-loss" : "text-muted-foreground",
                  )}
                >
                  {STATUS_LABELS[session.status]}
                </span>
                <span className="text-muted-foreground tabular shrink-0 text-xs">
                  {session.applied_count} of {session.total_rows}
                  {session.duplicate_count > 0 ? ` · ${session.duplicate_count} duplicate` : ""}
                  {session.reject_count > 0 ? ` · ${session.reject_count} rejected` : ""}
                </span>
                <time className="text-muted-foreground shrink-0 text-xs" dateTime={session.created_at}>
                  {formatTime(session.created_at, locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {history.pageCount > 1 && (
        <PaginationNav
          page={history.page}
          pageCount={history.pageCount}
          total={history.total}
          baseParams={{ p: active.id }}
          label="imports"
        />
      )}
    </div>
  )
}
