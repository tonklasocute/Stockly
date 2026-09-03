import type { Metadata } from "next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { GOAL_DEFINITIONS } from "@/domain/goals"
import { averageMonthlyContribution } from "@/domain/goals"
import { impliedYield } from "@/domain/simulation"
import { drawdownHistory } from "@/domain/drawdown-history"
import { returnIndex } from "@/domain/returns"
import { SimulationWorkspace } from "@/features/simulations/components/simulation-workspace"
import type { PlannableGoal } from "@/features/simulations/components/goal-simulator"
import { listSimulations } from "@/features/simulations/queries"
import { loadIntelligence } from "@/features/intelligence/loader"
import { listCashTransactions } from "@/features/cash/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatTime } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"

export const metadata: Metadata = { title: "Planning" }

/**
 * The CSP is nonce-based, so every route that renders a script must be server-rendered — a
 * statically prerendered page has no nonce and its scripts are blocked in production only.
 */
export const dynamic = "force-dynamic"

export default async function SimulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const locale = await appLocale()
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  // One cached pass for the portfolio's current state, plus two cheap reads. Nothing here is
  // recomputed per slider movement: the page hands the browser a snapshot, and the engine runs
  // against it locally.
  const [bundle, cashRows, saved] = await Promise.all([
    loadIntelligence(active.id),
    listCashTransactions(active.id),
    listSimulations(active.id).catch(() => []),
  ])

  const { analytics, baseCurrency } = bundle

  // Derived from the user's own deposits, and null when there is no history to average — an
  // assumption Stockly cannot ground in something real is one the user has to supply.
  const suggestedContribution = averageMonthlyContribution(
    cashRows.map((row) => ({
      occurredOn: row.occurred_on.slice(0, 10),
      kind: row.kind,
      amount: Number(row.amount),
    })),
  )

  const goals: PlannableGoal[] = bundle.goals.map(({ row, progress }) => ({
    id: row.id,
    type: row.type,
    label: GOAL_DEFINITIONS[row.type].label,
    currentValue: progress.current,
    targetValue: progress.target,
    targetDate: progress.targetDate,
    unit: progress.unit,
  }))

  /**
   * The portfolio's own fall history, for the stress tab's historical scenario.
   *
   * The same two functions the history page uses — `returnIndex` then `drawdownHistory` — on the
   * valuation points `loadIntelligence` already loaded, so this costs no extra query and cannot
   * disagree with that page about what happened. The window is deliberately different and not an
   * oversight: the history page answers "how did the last year go", and this answers "what is the
   * worst this portfolio has ever been through", which is a question about all of it.
   *
   * Null when there are too few observations. Nothing is estimated in the meantime.
   */
  const index = (returnIndex(bundle.valuations) ?? []).map((point) => ({
    date: point.date,
    index: point.index * 100,
  }))
  const drawdown = index.length > 0 ? drawdownHistory(index) : null

  const trailingIncome = analytics.dividends.summary.trailingTwelveMonths
  const yieldPct = impliedYield(trailingIncome, analytics.summary.marketValue)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Planning</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · what the arithmetic says under assumptions you choose
        </p>
      </div>

      {analytics.marketDataError && (
        <Alert>
          <AlertDescription>
            {analytics.marketDataError} Scenarios start from holdings valued at cost until prices
            return.
          </AlertDescription>
        </Alert>
      )}

      <SimulationWorkspace
        portfolioId={active.id}
        currency={baseCurrency}
        portfolioValue={analytics.totalValue}
        holdings={analytics.holdings}
        cash={analytics.cash.balance}
        sectorBySymbol={analytics.sectorBySymbol}
        drawdown={drawdown}
        goals={goals}
        suggestedContribution={suggestedContribution}
        actualTrailingIncome={trailingIncome}
        impliedYieldPct={yieldPct === null ? null : yieldPct * 100}
        costBasis={analytics.summary.investedValue > 0 ? analytics.summary.investedValue : null}
        saved={saved}
        // Simulations start from the portfolio as it stands, so the page says when that was.
        pricesAsOf={analytics.quoteAsOf === null ? null : formatTime(analytics.quoteAsOf, locale)}
        staleCount={analytics.summary.staleCount}
      />

      <p className="text-muted-foreground text-xs">
        Scenarios start from your portfolio as it stands
        {analytics.quoteAgeMinutes !== null
          ? `, priced ${Math.round(analytics.quoteAgeMinutes)} minutes ago`
          : ""}
        . Nothing on this page creates a transaction or changes a holding — every figure is
        recomputed from your assumptions each time you open it.
      </p>
    </div>
  )
}
