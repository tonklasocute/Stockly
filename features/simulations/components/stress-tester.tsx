"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Info, Plus, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Metric, Section } from "@/components/metric"
import {
  DEFAULT_MATRIX_SHOCKS,
  EXCLUSION_REASONS,
  STRESS_DISCLAIMER,
  historicalScenario,
  runStress,
  stressMatrix,
  type ShockComponent,
  type StressInput,
} from "@/domain/stress"
import { MARKETS, type Currency, type MarketId } from "@/domain/market"
import type { DrawdownHistory } from "@/domain/drawdown-history"
import type { Holding } from "@/domain/types"
import {
  formatCurrency,
  formatOptionalCurrency,
  formatOptionalPercent,
  formatPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/**
 * Stress testing.
 *
 * Runs entirely in the browser, like the rest of the planning workspace: `domain/stress.ts` is pure
 * and delegates every figure to the phase 11 what-if engine, so moving a slider costs no request
 * and reaches no database. There is no endpoint behind this page, which is also why nothing it
 * produces can be stored as a financial figure.
 *
 * The screen states three things it must never stop stating: that a scenario is hypothetical, what
 * it assumed, and which holdings it could not reach.
 */

type Draft = { kind: ShockComponent["kind"]; target: string; changePct: string }

const KIND_LABELS: Record<ShockComponent["kind"], string> = {
  UNIFORM: "Every holding",
  MARKET: "A market",
  SECTOR: "A sector",
  INSTRUMENT: "One holding",
  CURRENCY: "A currency",
}

function toComponent(draft: Draft, holdings: readonly Holding[]): ShockComponent | null {
  const changePct = Number(draft.changePct)
  if (!Number.isFinite(changePct) || changePct === 0) return null

  switch (draft.kind) {
    case "UNIFORM":
      return { kind: "UNIFORM", changePct }
    case "MARKET":
      return MARKETS.includes(draft.target as MarketId)
        ? { kind: "MARKET", market: draft.target as MarketId, changePct }
        : null
    case "SECTOR":
      return draft.target ? { kind: "SECTOR", sector: draft.target, changePct } : null
    case "INSTRUMENT": {
      const holding = holdings.find((h) => `${h.market}:${h.symbol}` === draft.target)
      return holding
        ? { kind: "INSTRUMENT", symbol: holding.symbol, market: holding.market, changePct }
        : null
    }
    case "CURRENCY":
      return draft.target ? { kind: "CURRENCY", currency: draft.target as Currency, changePct } : null
  }
}

export function StressTester({
  holdings,
  cash,
  baseCurrency,
  sectorBySymbol,
  drawdown,
  asOf,
  staleCount,
}: {
  holdings: Holding[]
  cash: number
  baseCurrency: Currency
  sectorBySymbol: Record<string, string | null>
  drawdown: DrawdownHistory | null
  asOf: string | null
  staleCount: number
}) {
  const t = useTranslations("simulations")
  const [drafts, setDrafts] = useState<Draft[]>([{ kind: "UNIFORM", target: "", changePct: "-20" }])

  const sectors = useMemo(
    () => [...new Set(Object.values(sectorBySymbol).filter((s): s is string => Boolean(s)))].sort(),
    [sectorBySymbol],
  )
  const currencies = useMemo(
    () => [...new Set(holdings.map((h) => h.currency))].filter((c) => c !== baseCurrency),
    [holdings, baseCurrency],
  )

  const input: StressInput = useMemo(
    () => ({ holdings, baseCurrency, cash, sectors: sectorBySymbol, dataAsOf: asOf }),
    [holdings, baseCurrency, cash, sectorBySymbol, asOf],
  )

  const components = useMemo(
    () => drafts.map((draft) => toComponent(draft, holdings)).filter((c): c is ShockComponent => c !== null),
    [drafts, holdings],
  )

  const result = useMemo(
    () =>
      components.length === 0
        ? null
        : runStress(input, {
            name: "Custom scenario",
            type: components.length > 1 ? "COMBINED_SHOCK" : "UNIFORM_SHOCK",
            components,
          }),
    [input, components],
  )

  const matrix = useMemo(() => stressMatrix(input), [input])
  const historical = useMemo(() => historicalScenario(drawdown), [drawdown])
  const historicalResult = useMemo(
    () => (historical ? runStress(input, historical) : null),
    [input, historical],
  )

  if (holdings.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">{t("stress.needsHolding")}</p>
    )
  }

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="size-4" aria-hidden />
        <AlertDescription>
          <strong>{STRESS_DISCLAIMER}</strong> Every figure below is arithmetic on assumptions you
          chose. Nothing here is bought, sold or changed — your transactions and holdings are
          untouched.
        </AlertDescription>
      </Alert>

      {/* ---------------------------------------------------------------- matrix */}
      <Section
        title={t("stress.matrix")}
        description={t("stress.matrixHint")}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">
              Portfolio value and impact under uniform price falls of{" "}
              {DEFAULT_MATRIX_SHOCKS.join(", ")} percent, with the gain required to return to the
              starting value.
            </caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="py-2 pr-3 font-medium">{t("stress.priceFall")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.portfolioValue")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.impact")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.portfolioChange")}</th>
                <th scope="col" className="py-2 text-right font-medium">{t("stress.gainNeeded")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {matrix.map((row) => (
                <tr key={row.changePct}>
                  <th scope="row" className="tabular py-2 pr-3 text-left font-medium">
                    {formatPercent(row.changePct)}
                  </th>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatCurrency(row.stressedValue, baseCurrency)}
                  </td>
                  <td className="tabular text-loss py-2 pr-3 text-right">
                    {formatCurrency(row.absoluteImpact, baseCurrency)}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatOptionalPercent(row.percentageImpact)}
                  </td>
                  <td className="tabular py-2 text-right">
                    {formatOptionalPercent(row.requiredGainPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          A fall needs a larger rise to undo it, because the rise is measured against the smaller
          amount left. A 50% fall needs a 100% gain to get back to where it started.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- builder */}
      <Section
        title={t("stress.build")}
        description={t("stress.buildHint")}
      >
        <div className="space-y-3">
          {drafts.map((draft, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[10rem_1fr_7rem_auto]">
              <div className="space-y-1">
                <Label htmlFor={`stress-kind-${index}`} className="sr-only">{t("stress.assumptionType")}</Label>
                <select
                  id={`stress-kind-${index}`}
                  value={draft.kind}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((d, i) =>
                        i === index ? { ...d, kind: event.target.value as Draft["kind"], target: "" } : d,
                      ),
                    )
                  }
                  className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  {(Object.keys(KIND_LABELS) as ShockComponent["kind"][]).map((kind) => (
                    <option key={kind} value={kind} disabled={kind === "SECTOR" && sectors.length === 0}>
                      {KIND_LABELS[kind]}
                      {kind === "SECTOR" && sectors.length === 0 ? " (no sector data)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`stress-target-${index}`} className="sr-only">{t("stress.appliesTo")}</Label>
                <select
                  id={`stress-target-${index}`}
                  value={draft.target}
                  disabled={draft.kind === "UNIFORM"}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((d, i) => (i === index ? { ...d, target: event.target.value } : d)),
                    )
                  }
                  className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <option value="">
                    {draft.kind === "UNIFORM" ? "The whole portfolio" : "Choose…"}
                  </option>
                  {draft.kind === "MARKET" &&
                    MARKETS.map((market) => (
                      <option key={market} value={market}>
                        {market}
                      </option>
                    ))}
                  {draft.kind === "SECTOR" &&
                    sectors.map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  {draft.kind === "INSTRUMENT" &&
                    holdings.map((holding) => (
                      <option key={`${holding.market}:${holding.symbol}`} value={`${holding.market}:${holding.symbol}`}>
                        {holding.symbol} · {holding.market}
                      </option>
                    ))}
                  {draft.kind === "CURRENCY" &&
                    currencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`stress-pct-${index}`} className="sr-only">{t("stress.percentageMove")}</Label>
                <Input
                  id={`stress-pct-${index}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="tabular"
                  value={draft.changePct}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((d, i) => (i === index ? { ...d, changePct: event.target.value } : d)),
                    )
                  }
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove assumption ${index + 1}`}
                disabled={drafts.length === 1}
                onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDrafts((current) => [...current, { kind: "MARKET", target: "", changePct: "-10" }])}
          >
            <Plus className="size-4" aria-hidden />{t("stress.addAssumption")}</Button>
        </div>

        {currencies.length > 0 ? (
          <p className="text-muted-foreground mt-3 text-xs">
            A currency move is separate from a price move: a positive figure means one unit of that
            currency is worth more {baseCurrency}, so holdings denominated in it are worth more —
            without any instrument&rsquo;s own price changing.
          </p>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------------- result */}
      {result ? (
        <>
          <Section title={t("stress.result")} description={result.scenario.name}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label={t("stress.portfolioNow")} value={formatCurrency(result.baseValue, baseCurrency)} />
              <Metric
                label={t("stress.underScenario")}
                value={formatCurrency(result.stressedValue, baseCurrency)}
              />
              <Metric
                label={t("stress.impact")}
                value={formatCurrency(result.absoluteImpact, baseCurrency)}
                hint={formatOptionalPercent(result.percentageImpact)}
              />
              <Metric
                label={t("stress.gainNeeded")}
                value={formatOptionalPercent(result.recovery?.requiredGainPct ?? null)}
                hint={
                  result.recovery
                    ? "to get back to where it started"
                    : "not applicable — nothing was lost"
                }
              />
            </dl>
          </Section>

          {result.components.length > 0 ? (
            <Section
              title={t("stress.decomposition")}
              description={t("stress.decompositionHint")}
            >
              <ul className="divide-y">
                {result.components.map((component, index) => (
                  <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span>
                      {component.label}
                      <span className="text-muted-foreground ml-2 text-xs">
                        {component.positionsAffected} position
                        {component.positionsAffected === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className={cn("tabular", component.impact < 0 ? "text-loss" : "text-gain")}>
                      {formatCurrency(component.impact, baseCurrency)}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-2 py-2 text-sm font-semibold">
                  <span>{t("stress.total")}</span>
                  <span className="tabular">{formatCurrency(result.absoluteImpact, baseCurrency)}</span>
                </li>
              </ul>
            </Section>
          ) : null}

          <Section
            title={t("stress.byPosition")}
            description={t("stress.byPositionHint")}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th scope="col" className="py-2 pr-3 font-medium">{t("stress.holding")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.priceMove")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.valueNow")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("stress.scenarioValue")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("stress.impact")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.positions
                    .filter((position) => position.impact !== null && position.impact !== 0)
                    .sort((a, b) => (a.impact ?? 0) - (b.impact ?? 0))
                    .map((position) => (
                      <tr key={`${position.market}:${position.symbol}`}>
                        <th scope="row" className="py-2 pr-3 text-left font-medium">
                          {position.symbol}
                          <span className="text-muted-foreground ml-1.5 text-xs">{position.market}</span>
                        </th>
                        <td className="tabular py-2 pr-3 text-right">
                          {formatPercent(position.priceChangePct)}
                        </td>
                        <td className="tabular py-2 pr-3 text-right">
                          {formatOptionalCurrency(position.currentBaseValue, baseCurrency)}
                        </td>
                        <td className="tabular py-2 pr-3 text-right">
                          {formatOptionalCurrency(position.scenarioBaseValue, baseCurrency)}
                        </td>
                        <td className="tabular py-2 text-right">
                          {formatOptionalCurrency(position.impact, baseCurrency)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title={t("stress.assumed")} description={t("stress.assumedHint")}>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              {result.assumptions.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>

            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label={t("stress.coverage")}
                value={`${result.coverage.shocked} / ${result.coverage.total}`}
                hint="holdings moved by this scenario"
              />
              <Metric
                label={t("stress.outOfScope")}
                value={result.coverage.unaffected}
                hint="correctly untouched"
              />
              <Metric
                label={t("stress.excluded")}
                value={result.coverage.excluded.length}
                hint={result.coverage.excluded.length > 0 ? "data gaps — see below" : "none"}
              />
              <Metric
                label={t("stress.pricesAsOf")}
                value={result.dataAsOf ?? "N/A"}
                hint={staleCount > 0 ? `${staleCount} priced from cost` : undefined}
              />
            </dl>

            {result.coverage.excluded.length > 0 ? (
              <Alert className="mt-4">
                <AlertTriangle className="size-4" aria-hidden />
                <AlertDescription>
                  <p className="font-medium">
                    {result.coverage.excluded.length} holding
                    {result.coverage.excluded.length === 1 ? "" : "s"} could not be included
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {result.coverage.excluded.map((excluded) => (
                      <li key={`${excluded.market}:${excluded.symbol}:${excluded.reason}`}>
                        {excluded.symbol} · {EXCLUSION_REASONS[excluded.reason]}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </Section>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t("stress.needsPercentage")}</p>
      )}

      {/* ---------------------------------------------------------------- historical */}
      <Section
        title={t("stress.historical")}
        description={t("stress.historicalHint")}
      >
        {historicalResult && historical ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Metric
                label={t("stress.observedFall")}
                value={formatPercent(historical.components[0].changePct as number)}
              />
              <Metric
                label={t("stress.sameFallToday")}
                value={formatCurrency(historicalResult.stressedValue, baseCurrency)}
                hint={formatCurrency(historicalResult.absoluteImpact, baseCurrency)}
              />
              <Metric
                label={t("stress.gainNeeded")}
                value={formatOptionalPercent(historicalResult.recovery?.requiredGainPct ?? null)}
              />
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">{historical.note}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            N/A — there is not enough recorded history to identify a fall. This appears once the
            portfolio has enough daily snapshots; nothing is estimated in the meantime.
          </p>
        )}
      </Section>
    </div>
  )
}
