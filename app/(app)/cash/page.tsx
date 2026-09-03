import type { Metadata } from "next"
import { PaginationNav } from "@/components/pagination-nav"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Metric, Section } from "@/components/metric"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { CashList } from "@/features/cash/components/cash-list"
import { listCashPage } from "@/features/cash/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatPercent } from "@/lib/format"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("cash") }
}

type Props = { searchParams: Promise<{ p?: string; page?: string }> }

export default async function CashPage({ searchParams }: Props) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("cash")
  const { p, page: pageParam } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const [bundle, pageResult] = await Promise.all([
    loadAnalytics(active.id),
    listCashPage(active.id, toPage(pageParam)),
  ])

  const currency = baseCurrencyOf(active.currency)
  const { cash, concentration } = bundle

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("cash")}</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <StatGrid>
        <StatCard label={t("summary.balance")} value={formatCurrency(cash.balance, currency)} emphasis
          hint={<span className="text-muted-foreground">{formatPercent(concentration.cashWeight, { signed: false })} of portfolio</span>} />
        <StatCard label={t("summary.netContributed")} value={formatCurrency(cash.netContributed, currency)} emphasis
          hint={<span className="text-muted-foreground">{t("summary.balanceHint")}</span>} />
        <StatCard label={t("summary.totalPortfolio")} value={formatCurrency(bundle.totalValue, currency)} emphasis
          hint={<span className="text-muted-foreground">{t("summary.totalPortfolioHint")}</span>} />
        <StatCard label={t("summary.dividendsReceived")} value={formatCurrency(cash.dividends, currency)} emphasis
          hint={<span className="text-muted-foreground">{t("summary.dividendsHint")}</span>} />
      </StatGrid>

      {cash.balance < 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-sm">
          Your cash balance is negative, which usually means the deposits that funded these trades
          have not been recorded yet. Adding them makes the balance and the allocation accurate.
        </p>
      )}

      <Section
        title={t("breakdown.title")}
        description={t("breakdown.hint")}
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label={t("breakdown.deposits")} value={formatCurrency(cash.deposits, currency)} />
          <Metric label={t("breakdown.withdrawals")} value={`−${formatCurrency(cash.withdrawals, currency)}`} />
          <Metric label={t("breakdown.buyCosts")} value={`−${formatCurrency(cash.buyCosts, currency)}`} />
          <Metric label={t("breakdown.sellProceeds")} value={`+${formatCurrency(cash.sellProceeds, currency)}`} />
          <Metric label={t("breakdown.dividends")} value={`+${formatCurrency(cash.dividends, currency)}`} />
        </dl>
      </Section>

      <CashList transactions={pageResult.rows} portfolioId={active.id} currency={currency} />

      <PaginationNav
        page={pageResult.page}
        pageCount={pageResult.pageCount}
        total={pageResult.total}
        baseParams={{ p: active.id }}
        label={t("rows")}
      />
    </div>
  )
}
