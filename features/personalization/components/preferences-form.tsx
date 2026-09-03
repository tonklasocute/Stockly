"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Section } from "@/components/metric"
import {
  DENSITIES,
  METRICS,
  METRIC_REGISTRY,
  MAX_FAVORITE_METRICS,
  THEMES,
  WIDGET_REGISTRY,
  moveWidget,
  toggleMetric,
  toggleWidget,
  type Density,
  type MetricId,
  type Theme,
  type WidgetPlacement,
} from "@/domain/personalization"
import { LOCALE_META, SUPPORTED_LOCALES, type Locale } from "@/domain/locale"
import { apiFetch } from "@/lib/api-client"
import { useErrorMessage } from "@/lib/i18n/errors"
import { useAppLocale } from "@/lib/i18n/locale"
import { rememberLocale } from "@/features/i18n/set-locale"
import type { PortfolioRow } from "@/types/database"

/**
 * Everything a user can change about how Stockly looks.
 *
 * The whole screen is optimistic-then-confirmed: the domain function computes the next state, it
 * renders immediately, and the PATCH persists it. Every mutation sends only the field it changed —
 * the endpoint is a PATCH precisely so the theme toggle cannot revert the dashboard layout that was
 * saved a second earlier.
 *
 * Reordering is **buttons, not drag-and-drop**. That is the accessible option rather than the
 * fallback: "move up" works with a keyboard, with a screen reader and with a thumb, and a drag
 * gesture is an enhancement that would have to be duplicated for all three anyway.
 */
export function PreferencesForm({
  portfolios,
  initial,
}: {
  portfolios: PortfolioRow[]
  initial: {
    theme: Theme
    density: Density
    defaultPortfolioId: string | null
    favoriteMetrics: MetricId[]
    dashboardLayout: WidgetPlacement[]
    dismissedInsights: string[]
  }
}) {
  const t = useTranslations("settings")
  const tEnum = useTranslations("enums")
  const describeError = useErrorMessage()
  const locale = useAppLocale()
  const router = useRouter()
  const { setTheme } = useTheme()
  const [state, setState] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  const save = async (patch: Record<string, unknown>, next: typeof state) => {
    const previous = state
    setState(next)
    setSaving(true)
    try {
      await apiFetch("/api/preferences", { method: "PATCH", body: JSON.stringify(patch) })
      startTransition(() => router.refresh())
    } catch (error) {
      // Put the control back where it was: a switch that stayed flipped after a failed save is a
      // switch that lies about the state of the account.
      setState(previous)
      toast.error(describeError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Section title={t("appearance.title")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("theme.label")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("theme.label")}>
              {THEMES.map((theme) => (
                <Button
                  key={theme}
                  type="button"
                  variant={state.theme === theme ? "default" : "outline"}
                  size="sm"
                  role="radio"
                  aria-checked={state.theme === theme}
                  disabled={saving}
                  onClick={() => {
                    // next-themes owns the DOM class and the no-flash script; the preference row is
                    // what makes the choice survive a new device rather than living in one browser.
                    setTheme(theme)
                    void save({ theme }, { ...state, theme })
                  }}
                >
                  {tEnum(`theme.${theme}`)}
                </Button>
              ))}
            </div>
          </fieldset>

          {/*
            Language sits beside theme and density because it is the same kind of preference: it
            decides how Stockly reads, never what it calculates. The note under it says so, because
            "changing the language will not change my numbers" is the first thing a user of a
            financial application wants to be sure of.
          */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("language.label")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("language.label")}>
              {SUPPORTED_LOCALES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={locale === option ? "default" : "outline"}
                  size="sm"
                  role="radio"
                  aria-checked={locale === option}
                  disabled={saving}
                  lang={option}
                  onClick={() => {
                    if (option === locale) return
                    // The cookie takes effect on this device immediately; the PATCH is what makes
                    // the choice survive a new one. `router.refresh()` re-renders the route with
                    // the new language without losing the rest of this screen's state.
                    rememberLocale(option, { signedIn: true })
                    startTransition(() => router.refresh())
                  }}
                >
                  {LOCALE_META[option].label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{t("language.description")}</p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("density.label")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("density.label")}>
              {DENSITIES.map((density) => (
                <Button
                  key={density}
                  type="button"
                  variant={state.density === density ? "default" : "outline"}
                  size="sm"
                  role="radio"
                  aria-checked={state.density === density}
                  disabled={saving}
                  onClick={() => void save({ density }, { ...state, density })}
                >
                  {tEnum(`density.${density}`)}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Applies to the holdings, transactions and watchlist tables.
            </p>
          </fieldset>
        </div>

        <div className="mt-5 space-y-1.5">
          <Label htmlFor="defaultPortfolio">Default portfolio</Label>
          <select
            id="defaultPortfolio"
            className="border-input bg-background h-9 w-full max-w-sm rounded-md border px-3 text-sm pointer-coarse:h-11"
            value={state.defaultPortfolioId ?? ""}
            disabled={saving}
            onChange={(event) => {
              const defaultPortfolioId = event.target.value || null
              void save({ defaultPortfolioId }, { ...state, defaultPortfolioId })
            }}
          >
            <option value="">Most recently created</option>
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Where Stockly opens. You can still switch portfolio at any time.
          </p>
        </div>
      </Section>

      <Section
        title="Summary metrics"
        description={`The tiles at the top of your dashboard. Choose up to ${MAX_FAVORITE_METRICS}.`}
      >
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {METRICS.map((id) => {
            const chosen = state.favoriteMetrics.includes(id)
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-start gap-3 py-2 pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={chosen}
                    disabled={saving}
                    onChange={() => {
                      const result = toggleMetric(state.favoriteMetrics, id)
                      if (result.rejected) {
                        toast.error(`You can choose at most ${MAX_FAVORITE_METRICS} metrics.`)
                        return
                      }
                      void save(
                        { favoriteMetrics: result.metrics },
                        { ...state, favoriteMetrics: result.metrics },
                      )
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{METRIC_REGISTRY[id].label}</span>
                    {/* The definition is beside the choice, so "yield on cost" and "yield on
                        current value" are never picked by guessing which one is meant. */}
                    <span className="text-muted-foreground block text-xs">
                      {METRIC_REGISTRY[id].definition}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        title="Dashboard"
        description="What appears, and in what order."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                const result = await apiFetch<{ dashboardLayout: WidgetPlacement[] }>(
                  "/api/preferences",
                  { method: "DELETE" },
                )
                setState((current) => ({ ...current, dashboardLayout: result.dashboardLayout }))
                toast.success("Dashboard reset.")
                startTransition(() => router.refresh())
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not reset that.")
              } finally {
                setSaving(false)
              }
            }}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        }
      >
        <ol className="divide-y">
          {state.dashboardLayout.map((placement, index) => {
            const definition = WIDGET_REGISTRY[placement.id]
            const commit = (dashboardLayout: WidgetPlacement[]) =>
              void save({ dashboardLayout }, { ...state, dashboardLayout })

            return (
              <li key={placement.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className={placement.visible ? "text-sm font-medium" : "text-muted-foreground text-sm"}>
                    {definition.label}
                    {definition.required ? (
                      <span className="text-muted-foreground ml-2 text-xs">Always shown</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">{definition.description}</p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving || index === 0}
                    aria-label={`Move ${definition.label} up`}
                    onClick={() => commit(moveWidget(state.dashboardLayout, placement.id, "up"))}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving || index === state.dashboardLayout.length - 1}
                    aria-label={`Move ${definition.label} down`}
                    onClick={() => commit(moveWidget(state.dashboardLayout, placement.id, "down"))}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving || definition.required}
                    aria-label={`${placement.visible ? "Hide" : "Show"} ${definition.label}`}
                    onClick={() =>
                      commit(toggleWidget(state.dashboardLayout, placement.id, !placement.visible))
                    }
                  >
                    {placement.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      </Section>

      {state.dismissedInsights.length > 0 ? (
        <Section
          title="Hidden observations"
          description="Observations you dismissed. Restoring one brings it back when its rule next applies."
        >
          <ul className="flex flex-wrap gap-2">
            {state.dismissedInsights.map((code) => (
              <li key={code}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    const next = state.dismissedInsights.filter((c) => c !== code)
                    await save({ dismissedInsights: next }, { ...state, dismissedInsights: next })
                  }}
                >
                  Restore {code.toLowerCase().replaceAll("_", " ")}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
