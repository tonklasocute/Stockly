"use client"

import { useMemo, useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MarketBadge } from "@/components/market-badge"
import type { Currency } from "@/domain/market"
import { symbolKey } from "@/domain/market"
import { simulateWhatIf, uniformPriceShock } from "@/domain/simulation"
import type { Holding } from "@/domain/types"
import { formatCurrency, formatCurrencyWithCode, formatPercent, formatQuantity } from "@/lib/format"
import { DataLabel } from "./assumptions"
import { NumberField } from "./inputs"
import { useTranslations } from "next-intl"

/**
 * Portfolio what-if.
 *
 * Everything is local state and pure arithmetic: nothing is sent anywhere, nothing is saved unless
 * the user asks, and **Reset discards the whole scenario** — which is the guarantee that makes a
 * user willing to experiment. The real portfolio is not reachable from this component; the engine
 * takes `readonly Holding[]` and returns new objects.
 *
 * The wording is deliberate throughout: a **scenario price**, never an expected or target one.
 */
export function WhatIfSimulator({
  holdings,
  cash,
  baseCurrency,
  asOf,
  staleCount,
}: {
  holdings: Holding[]
  cash: number
  baseCurrency: Currency
  /** When the prices behind these figures were taken. */
  asOf: string | null
  /** Holdings valued at cost because no quote was available. */
  staleCount: number
}) {
  const t = useTranslations("simulations")
  const tc = useTranslations("common")
  const [cashDelta, setCashDelta] = useState("0")
  const [shockPct, setShockPct] = useState("0")
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reductions, setReductions] = useState<Record<string, string>>({})
  const [fx, setFx] = useState<Record<string, string>>({})

  const foreignCurrencies = useMemo(
    () => [...new Set(holdings.map((h) => h.currency).filter((c) => c !== baseCurrency))],
    [holdings, baseCurrency],
  )

  function reset() {
    setCashDelta("0")
    setShockPct("0")
    setPrices({})
    setQuantities({})
    setReductions({})
    setFx({})
  }

  const result = useMemo(() => {
    const shock = Number(shockPct)
    const uniform = Number.isFinite(shock) && shock !== 0 ? uniformPriceShock(holdings, shock) : []

    // A per-holding price overrides the uniform shock: the more specific instruction wins.
    const perHolding = holdings
      .map((holding) => {
        const key = symbolKey(holding.symbol, holding.market)
        const raw = prices[key]
        if (raw === undefined || raw.trim() === "") return null
        const changePct = Number(raw)
        return Number.isFinite(changePct)
          ? { symbol: holding.symbol, market: holding.market, changePct }
          : null
      })
      .filter((a) => a !== null)

    const overridden = new Set(perHolding.map((a) => symbolKey(a.symbol, a.market)))

    const quantityAdjustments = holdings
      .map((holding) => {
        const key = symbolKey(holding.symbol, holding.market)
        const amount = Number(quantities[key] ?? "")
        const reduce = Number(reductions[key] ?? "")
        const hasAmount = (quantities[key] ?? "").trim() !== "" && Number.isFinite(amount)
        const hasReduce = (reductions[key] ?? "").trim() !== "" && Number.isFinite(reduce)
        if (!hasAmount && !hasReduce) return null
        return {
          symbol: holding.symbol,
          market: holding.market,
          ...(hasAmount ? { amountDelta: amount } : {}),
          ...(hasReduce ? { reducePct: reduce } : {}),
        }
      })
      .filter((a) => a !== null)

    const fxOverrides: Partial<Record<Currency, number>> = {}
    for (const [currency, raw] of Object.entries(fx)) {
      const parsed = Number(raw)
      // The user types "35 baht to the dollar"; the engine wants dollars per baht.
      if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
        fxOverrides[currency as Currency] = 1 / parsed
      }
    }

    return simulateWhatIf({
      holdings,
      baseCurrency,
      cash,
      cashDelta: Number.isFinite(Number(cashDelta)) ? Number(cashDelta) : 0,
      priceAdjustments: [
        ...uniform.filter((a) => !overridden.has(symbolKey(a.symbol, a.market))),
        ...perHolding,
      ],
      quantityAdjustments,
      fxOverrides,
    })
  }, [holdings, baseCurrency, cash, cashDelta, shockPct, prices, quantities, reductions, fx])

  const touched =
    cashDelta !== "0" ||
    shockPct !== "0" ||
    Object.values({ ...prices, ...quantities, ...reductions, ...fx }).some((v) => v?.trim())

  if (holdings.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">{t("whatIf.empty")}</p>
    )
  }

  return (
    <div className="space-y-6">
      <Section
        title={t("inputs.title")}
        description={t("whatIf.hint")}
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reset} disabled={!touched}>
            <RotateCcw className="size-3.5" aria-hidden />{tc("actions.reset")}</Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="whatif-cash"
            label={t("whatIf.addCash")}
            suffix={baseCurrency}
            value={cashDelta}
            onChange={setCashDelta}
            hint="Negative to take money out."
          />
          <NumberField
            id="whatif-shock"
            label={t("whatIf.moveEveryPrice")}
            suffix="%"
            value={shockPct}
            onChange={setShockPct}
            hint="A per-holding figure below overrides this."
          />
          {foreignCurrencies.map((currency) => (
            <div key={currency} className="space-y-2">
              <Label htmlFor={`whatif-fx-${currency}`}>
                Scenario {currency}/{baseCurrency}
              </Label>
              <Input
                id={`whatif-fx-${currency}`}
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                className="tabular"
                placeholder={t("whatIf.todaysRate")}
                value={fx[currency] ?? ""}
                onChange={(event) => setFx((p) => ({ ...p, [currency]: event.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                Units of {currency} per one {baseCurrency}. Blank uses today&apos;s rate.
              </p>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("whatIf.scenarioPortfolio")}</h2>
        <DataLabel kind="SCENARIO" />
      </div>

      <StatGrid>
        <StatCard
          label={t("whatIf.portfolioToday")}
          value={formatCurrencyWithCode(result.currentTotal, baseCurrency)}
          emphasis
          hint={
            <span className="text-muted-foreground flex items-center gap-1.5">
              <DataLabel kind="ACTUAL" />
              {asOf ? `as of ${asOf}` : "no price timestamp"}
            </span>
          }
        />
        <StatCard
          label={t("whatIf.scenarioPortfolio")}
          value={formatCurrencyWithCode(result.scenarioTotal, baseCurrency)}
          emphasis
        />
        <StatCard
          label={t("whatIf.difference")}
          value={formatCurrency(result.difference, baseCurrency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {result.differencePct === null ? "N/A" : formatPercent(result.differencePct)}
            </span>
          }
        />
        <StatCard
          label={t("whatIf.scenarioCash")}
          value={formatCurrency(result.scenarioCash, baseCurrency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              from {formatCurrency(result.currentCash, baseCurrency)}
            </span>
          }
        />
      </StatGrid>

      {(staleCount > 0 || result.untranslatedCount > 0) && (
        <p className="text-muted-foreground text-xs">
          {staleCount > 0 &&
            `${staleCount} holding${staleCount === 1 ? " is" : "s are"} valued at cost because no live price was available; the scenario inherits that. `}
          {result.untranslatedCount > 0 &&
            `${result.untranslatedCount} holding${result.untranslatedCount === 1 ? " has" : "s have"} no exchange rate and is excluded from both totals — supply a scenario rate above to include it.`}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("whatIf.position")}</TableHead>
              <TableHead className="text-right">{t("whatIf.priceMovePct")}</TableHead>
              <TableHead className="text-right">Add ({baseCurrency})</TableHead>
              <TableHead className="text-right">{t("whatIf.reducePct")}</TableHead>
              <TableHead className="text-right">{t("whatIf.scenarioPrice")}</TableHead>
              <TableHead className="text-right">{t("whatIf.scenarioValue")}</TableHead>
              <TableHead className="text-right">{t("whatIf.weight")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.holdings.map((holding) => {
              const key = symbolKey(holding.symbol, holding.market)
              return (
                <TableRow key={key}>
                  <TableCell>
                    <span className="font-medium">{holding.symbol}</span>
                    <MarketBadge
                      market={holding.market}
                      currency={holding.currency}
                      className="ml-2"
                    />
                    <p className="text-muted-foreground text-xs">
                      {formatQuantity(holding.currentQuantity)} →{" "}
                      {formatQuantity(holding.scenarioQuantity)}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`Price move for ${holding.symbol}`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="tabular ml-auto w-24 text-right"
                      placeholder="0"
                      value={prices[key] ?? ""}
                      onChange={(event) =>
                        setPrices((p) => ({ ...p, [key]: event.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`Amount to add to ${holding.symbol}`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="tabular ml-auto w-28 text-right"
                      placeholder="0"
                      value={quantities[key] ?? ""}
                      onChange={(event) =>
                        setQuantities((p) => ({ ...p, [key]: event.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`Percent of ${holding.symbol} to reduce`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      max={100}
                      className="tabular ml-auto w-20 text-right"
                      placeholder="0"
                      value={reductions[key] ?? ""}
                      onChange={(event) =>
                        setReductions((p) => ({ ...p, [key]: event.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatCurrency(holding.scenarioPrice, holding.currency)}
                    <p className="text-muted-foreground text-xs">
                      from {formatCurrency(holding.currentPrice, holding.currency)}
                    </p>
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {holding.scenarioBaseValue === null
                      ? "N/A"
                      : formatCurrency(holding.scenarioBaseValue, baseCurrency)}
                    {holding.baseValueDelta !== null && holding.baseValueDelta !== 0 && (
                      <p
                        className={
                          holding.baseValueDelta > 0
                            ? "text-gain text-xs"
                            : "text-loss text-xs"
                        }
                      >
                        {holding.baseValueDelta > 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(holding.baseValueDelta), baseCurrency)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground text-right">
                    {holding.scenarioWeightPct === null
                      ? "N/A"
                      : formatPercent(holding.scenarioWeightPct, { signed: false })}
                    {holding.currentWeightPct !== null && (
                      <p className="text-xs">
                        from {formatPercent(holding.currentWeightPct, { signed: false })}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="bg-muted/40 space-y-2 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t("whatIf.whatThisIs")}</h3>
          <DataLabel kind="SCENARIO" />
        </div>
        <p className="text-muted-foreground text-xs">
          A restatement of your portfolio at the prices, quantities and exchange rates you typed. It
          is arithmetic, not a forecast: nothing here says a price will move, and no transaction is
          created. Cost basis is scaled with each position — shares added are costed at the scenario
          price, shares removed release a proportional share of what you paid.
        </p>
        <dl className="grid gap-4 pt-1 sm:grid-cols-3">
          <Metric label={t("whatIf.positions")} value={String(result.holdings.length)} />
          <Metric
            label={t("whatIf.excludedNoRate")}
            value={String(result.untranslatedCount)}
            hint="Never counted at a made-up rate"
          />
          <Metric label={t("inputs.currency")} value={baseCurrency} />
        </dl>
      </div>
    </div>
  )
}
