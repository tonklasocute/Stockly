"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StressTester } from "./stress-tester"
import type { DrawdownHistory } from "@/domain/drawdown-history"
import type { Currency } from "@/domain/market"
import type { Holding } from "@/domain/types"
import { apiFetch } from "@/lib/api-client"
import { formatTime } from "@/lib/format"
import type { SavedSimulationRow } from "@/types/database"
import { GrowthSimulator } from "./growth-simulator"
import { GoalSimulator, type PlannableGoal } from "./goal-simulator"
import { DividendSimulator } from "./dividend-simulator"
import { WhatIfSimulator } from "./what-if-simulator"
import type { ScenarioState } from "./use-scenario"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

/** `value` is the tab id; `key` names it in the `simulations` namespace. */
const TABS = [
  { value: "growth", key: "growth" },
  { value: "goal", key: "goal" },
  { value: "dividend", key: "dividends" },
  { value: "whatif", key: "whatIf" },
  // Phase 20. Beside what-if because it is the same engine: a stress scenario is a what-if whose
  // assumptions are grouped by market, sector or currency rather than typed in per holding.
  { value: "stress", key: "stress" },
] as const

/**
 * The planning workspace.
 *
 * Every calculation runs in the browser: the engine in `domain/simulation` is pure, so moving a
 * slider recomputes without a round trip, and there is no debounce to tune because there is nothing
 * to debounce. The server is involved only when a scenario is *saved* — and a saved scenario stores
 * the inputs, never the results, so it cannot go stale.
 *
 * The what-if tab is deliberately not saveable. It is a scratchpad over the live portfolio, and its
 * whole value is that it can be discarded; persisting one would turn an experiment into a record.
 */
export function SimulationWorkspace({
  portfolioId,
  currency,
  portfolioValue,
  holdings,
  cash,
  goals,
  suggestedContribution,
  actualTrailingIncome,
  impliedYieldPct,
  costBasis,
  saved,
  pricesAsOf,
  staleCount,
  sectorBySymbol,
  drawdown,
}: {
  portfolioId: string
  currency: Currency
  portfolioValue: number
  holdings: Holding[]
  cash: number
  goals: PlannableGoal[]
  suggestedContribution: number | null
  actualTrailingIncome: number
  impliedYieldPct: number | null
  costBasis: number | null
  saved: SavedSimulationRow[]
  pricesAsOf: string | null
  staleCount: number
  /** Sector per `symbolKey`; null where the provider gave none, which the stress tab reports. */
  sectorBySymbol: Record<string, string | null>
  /** The portfolio's own return history, or null when there is too little of it. */
  drawdown: DrawdownHistory | null
}) {
  const t = useTranslations("simulations")
  const locale = useAppLocale()
  const router = useRouter()
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("growth")
  const [growthState, setGrowthState] = useState<ScenarioState | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const [loadedState, setLoadedState] = useState<Partial<ScenarioState> | undefined>()
  const [name, setName] = useState("")

  // Stable, so the child's effect does not fire on every parent render.
  const handleGrowthChange = useCallback((state: ScenarioState) => setGrowthState(state), [])

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/simulations", {
        method: "POST",
        body: JSON.stringify({
          portfolioId,
          name: name.trim(),
          type: "DCA",
          // Inputs as the user typed them. Nothing computed is sent, so nothing computed is stored.
          inputs: {
            initialValue: Number(growthState?.initialValue ?? 0),
            contribution: Number(growthState?.contribution ?? 0),
            frequency: growthState?.frequency ?? "MONTHLY",
            annualReturnPct: Number(growthState?.annualReturnPct ?? 0),
            years: Number(growthState?.years ?? 10),
            contributionGrowthPct: Number(growthState?.contributionGrowthPct ?? 0),
            inflationPct:
              growthState?.inflationPct && growthState.inflationPct.trim() !== ""
                ? Number(growthState.inflationPct)
                : null,
            currency,
          },
        }),
      }),
    onSuccess: () => {
      toast.success(t("saved.saved"))
      setName("")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/simulations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("saved.deleted"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function load(row: SavedSimulationRow) {
    const inputs = row.inputs as Record<string, unknown> | null
    if (!inputs) return
    const text = (key: string, fallback: string) =>
      inputs[key] === null || inputs[key] === undefined ? fallback : String(inputs[key])

    setLoadedState({
      initialValue: text("initialValue", "0"),
      contribution: text("contribution", "0"),
      frequency: (inputs.frequency as ScenarioState["frequency"]) ?? "MONTHLY",
      annualReturnPct: text("annualReturnPct", "8"),
      years: text("years", "10"),
      contributionGrowthPct: text("contributionGrowthPct", "0"),
      inflationPct: inputs.inflationPct === null ? "" : text("inflationPct", ""),
    })
    // Remount rather than push state downward: one direction of data flow, and no chance of the
    // form and the loaded scenario disagreeing about which is current.
    setLoadKey((previous) => previous + 1)
    setTab("growth")
    toast.success(`Loaded “${row.name}”.`)
  }

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {t(`tabs.${entry.key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="growth" className="mt-6 space-y-6">
          <GrowthSimulator
            key={loadKey}
            currency={currency}
            startingValue={portfolioValue}
            suggestedContribution={suggestedContribution}
            initialState={loadedState}
            onStateChange={handleGrowthChange}
          />

          <div className="bg-card space-y-3 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">{t("saved.title")}</h3>
            <p className="text-muted-foreground text-xs">
              A saved scenario keeps the assumptions you chose, not the numbers they produced —
              opening one recomputes it from scratch, so it can never go stale.
            </p>

            <div className="flex flex-wrap gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("saved.name")}
                aria-label={t("saved.namePlaceholder")}
                className="min-w-40 flex-1"
                maxLength={60}
              />
              <Button
                className="gap-1.5 max-sm:h-11"
                disabled={!name.trim() || !growthState || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Save
              </Button>
            </div>

            {saved.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("saved.none")}</p>
            ) : (
              <ul className="divide-y">
                {saved.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="text-muted-foreground text-xs">
                        Updated {formatTime(row.updated_at, locale)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => load(row)}>{t("saved.load")}</Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${row.name}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Delete “${row.name}”?`)) remove.mutate(row.id)
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="goal" className="mt-6">
          <GoalSimulator
            currency={currency}
            goals={goals}
            suggestedContribution={suggestedContribution}
            portfolioId={portfolioId}
          />
        </TabsContent>

        <TabsContent value="dividend" className="mt-6">
          <DividendSimulator
            currency={currency}
            portfolioValue={portfolioValue}
            actualTrailingIncome={actualTrailingIncome}
            impliedYieldPct={impliedYieldPct}
            costBasis={costBasis}
            suggestedContribution={suggestedContribution}
          />
        </TabsContent>

        <TabsContent value="whatif" className="mt-6">
          <WhatIfSimulator
            holdings={holdings}
            cash={cash}
            baseCurrency={currency}
            asOf={pricesAsOf}
            staleCount={staleCount}
          />
        </TabsContent>

        <TabsContent value="stress" className="mt-6">
          <StressTester
            holdings={holdings}
            cash={cash}
            baseCurrency={currency}
            sectorBySymbol={sectorBySymbol}
            drawdown={drawdown}
            asOf={pricesAsOf}
            staleCount={staleCount}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
