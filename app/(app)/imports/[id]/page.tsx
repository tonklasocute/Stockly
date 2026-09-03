import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Metric, Section } from "@/components/metric"
import { MarketBadge } from "@/components/market-badge"
import { currencyOf, toMarket } from "@/domain/market"
import type { ImportIssue } from "@/domain/import"
import { findImportSession, listImportRows } from "@/features/imports/queries"
import { formatDate, formatTime } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.importDetail") }
}
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

/**
 * One import, after the fact.
 *
 * The audit trail: which file, how it was read, what it created, and what it did not. RLS scopes
 * the reads — an id belonging to another user simply is not found, which is also the right answer.
 */
export default async function ImportDetailPage({ params }: Ctx) {
  const t = await getTranslations("imports")
  const locale = await appLocale()
  const { id } = await params
  const session = await findImportSession(id)
  if (!session) notFound()

  const supabase = await createClient()
  const [rows, created] = await Promise.all([
    listImportRows(id),
    supabase
      .from("transactions")
      .select("id, symbol, market, side, trade_date, quantity, price, source_row")
      .eq("import_session_id", id)
      .order("source_row", { ascending: true })
      .limit(200),
  ])

  const rejected = rows.filter((row) => row.outcome === "REJECT")
  const duplicates = rows.filter((row) => row.outcome === "DUPLICATE")

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Button
          nativeButton={false}
          render={<Link href="/imports" />}
          variant="ghost"
          size="sm"
          className="gap-1.5"
        >
          <ArrowLeft className="size-3.5" aria-hidden />{t("allImports")}</Button>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{session.filename}</h1>
        <p className="text-muted-foreground text-sm">
          {session.format} · imported {formatTime(session.applied_at, locale)}
        </p>
      </div>

      <dl className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-4">
        {[
          { label: t("rowsRead"), value: session.total_rows },
          { label: t("created"), value: session.applied_count },
          { label: t("alreadyImported"), value: session.duplicate_count },
          { label: t("rejected"), value: session.reject_count },
        ].map((entry) => (
          <div key={entry.label} className="bg-card space-y-0.5 p-4">
            <dt className="text-muted-foreground text-xs">{entry.label}</dt>
            <dd className="tabular text-xl font-semibold">{entry.value}</dd>
          </div>
        ))}
      </dl>

      {rejected.length > 0 && (
        <Section
          title={`${rejected.length} row${rejected.length === 1 ? "" : "s"} rejected`}
          description={t("rejectedHint")}
        >
          <ul className="divide-y">
            {rejected.map((row) => (
              <li key={row.id} className="space-y-1 py-3 first:pt-0">
                <p className="text-sm font-medium">Row {row.row_number}</p>
                {(row.issues as ImportIssue[]).map((issue, index) => (
                  <p
                    key={index}
                    className={cn(
                      "text-xs",
                      issue.severity === "ERROR" ? "text-loss" : "text-muted-foreground",
                    )}
                  >
                    {issue.field ? `${issue.field}: ` : ""}
                    {issue.message}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {duplicates.length > 0 && (
        <Section
          title={`${duplicates.length} row${duplicates.length === 1 ? " was" : "s were"} already imported`}
          description={t("duplicatesHint")}
        >
          <p className="text-muted-foreground text-sm">
            Rows {duplicates.map((row) => row.row_number).slice(0, 30).join(", ")}
            {duplicates.length > 30 ? ", and others" : ""}.
          </p>
        </Section>
      )}

      <Section
        title={t("transactionsCreated")}
        description={t("transactionsCreatedHint")}
      >
        {(created.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noneCreated")}</p>
        ) : (
          <ul className="divide-y">
            {(created.data ?? []).map((transaction) => (
              <li key={transaction.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                <span className="text-muted-foreground tabular w-12 shrink-0 text-xs">
                  #{transaction.source_row}
                </span>
                <Link
                  href={`/stocks/${transaction.symbol}?market=${transaction.market}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {transaction.symbol}
                </Link>
                <MarketBadge
                  market={toMarket(transaction.market)}
                  currency={currencyOf(toMarket(transaction.market))}
                />
                <span className="capitalize">{transaction.side}</span>
                <span className="tabular text-muted-foreground">
                  {Number(transaction.quantity)} @ {Number(transaction.price)}
                </span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {formatDate(transaction.trade_date, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Metric
        label={t("auditability")}
        value="Every transaction above carries this import's id and its line number"
        hint="Deleting this history entry leaves the transactions where they are — they are financial records, and an import is only how they arrived."
      />
    </div>
  )
}
