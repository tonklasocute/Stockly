import type { Metadata } from "next"
import Link from "next/link"
import { FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { HoldingsTable } from "@/features/portfolios/components/holdings-table"
import { TagAssigner } from "@/features/personalization/components/tag-assigner"
import { listTags, loadHoldingTags, loadPreferences } from "@/features/personalization/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView, namesFrom } from "@/features/portfolios/portfolio-view"
import { CurrencyExposure, CurrencyNotice, TranslationNote } from "@/components/currency-exposure"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatCurrencyWithCode } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("portfolio") }
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("portfolios")
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  /*
   * Three reads in parallel, and only the first touches the calculation engine. Preferences and
   * tags are two small row reads that decide presentation — they add no analytics pass, no quote
   * call and no figure.
   */
  const [view, preferences, tags, holdingTags] = await Promise.all([
    loadPortfolioView(active.id),
    loadPreferences(),
    listTags(),
    loadHoldingTags(active.id),
  ])
  const { holdings, summary, quotes, marketDataError, missingFxPairs } = view
  const currency = baseCurrencyOf(active.currency)
  const names = namesFrom(quotes)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("portfolio")}</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        {/*
          The what-if scratchpad. It restates this portfolio at prices and quantities the user
          types, creates nothing, and is discarded by a Reset button — which is what makes it worth
          experimenting in.
        */}
        <Button
          nativeButton={false}
          render={<Link href={`/simulations?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <FlaskConical className="size-3.5" aria-hidden />{t("whatIf")}</Button>
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>
            {marketDataError} Holdings are valued at cost until prices return.
          </AlertDescription>
        </Alert>
      )}

      <CurrencyNotice summary={summary} missingFxPairs={missingFxPairs} />

      <StatGrid>
        <StatCard
          label={t("summary.value")}
          value={formatCurrencyWithCode(summary.marketValue, currency)}
          emphasis
        />
        <StatCard label={t("summary.invested")} value={formatCurrency(summary.investedValue, currency)} emphasis />
        <StatCard
          label={t("summary.unrealizedPnl")}
          value={<Delta value={summary.unrealizedPnl} currency={currency} />}
          emphasis
        />
        <StatCard
          label={t("summary.today")}
          value={
            summary.todayPnl === null ? (
              <span className="text-muted-foreground text-lg">N/A</span>
            ) : (
              <Delta value={summary.todayPnl} currency={currency} />
            )
          }
          emphasis
          hint={summary.todayReturnPct === null ? undefined : <Percent value={summary.todayReturnPct} />}
        />
      </StatGrid>

      <CurrencyExposure summary={summary} />

      {/*
        Density and tags are display concerns: the table receives the same holdings it always did,
        computed by the same engine, and decides only how tightly to pack them and what labels to
        show beside them.
      */}
      <HoldingsTable
        holdings={holdings}
        currency={currency}
        names={names}
        density={preferences.density}
        tags={Object.fromEntries(holdingTags)}
      />

      {holdings.length > 0 && (
        <TagAssigner
          portfolioId={active.id}
          tags={tags}
          holdings={holdings.map((h) => ({ symbol: h.symbol, market: h.market }))}
          assigned={Object.fromEntries([...holdingTags].map(([key, list]) => [key, list.map((t) => t.id)]))}
        />
      )}

      <TranslationNote summary={summary} />
    </div>
  )
}
