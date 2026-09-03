import { describe, expect, it } from "vitest"
import {
  applyView,
  canDismiss,
  DEFAULT_LAYOUT,
  DEFAULT_METRICS,
  DEFAULT_VIEW_CONFIG,
  dismissInsight,
  isPinned,
  matchesViewFilter,
  MAX_FAVORITE_METRICS,
  MAX_PINNED,
  MAX_RECENT,
  METRIC_REGISTRY,
  METRICS,
  moveWidget,
  recordRecent,
  reorderWidgets,
  resolveLayout,
  resolveMetrics,
  restoreInsight,
  toggleMetric,
  togglePin,
  toggleWidget,
  UNDISMISSABLE_INSIGHTS,
  UNGROUPED,
  visibleWidgets,
  WIDGET_REGISTRY,
  WIDGETS,
  withoutDismissed,
  type ViewRow,
  type WidgetPlacement,
} from "./personalization"

const row = (overrides: Partial<ViewRow> = {}): ViewRow => ({
  symbol: "NVDA",
  market: "US",
  quantity: 10,
  marketValue: 1_800,
  weight: 40,
  unrealizedPnl: 100,
  returnPct: 5.9,
  sector: "Technology",
  tags: ["Growth"],
  ...overrides,
})

describe("the default dashboard", () => {
  it("is not empty", () => {
    // A dashboard that starts blank and asks to be configured is a dashboard nobody configures.
    expect(visibleWidgets(DEFAULT_LAYOUT).length).toBeGreaterThan(4)
  })

  it("leads with the summary", () => {
    expect(DEFAULT_LAYOUT[0].id).toBe("summary")
  })

  it("mentions every widget in the registry, so none can be unreachable", () => {
    expect(DEFAULT_LAYOUT.map((w) => w.id).sort()).toEqual([...WIDGETS].sort())
  })

  it("has a definition for every widget", () => {
    for (const id of WIDGETS) {
      expect(WIDGET_REGISTRY[id].label.length).toBeGreaterThan(0)
      expect(WIDGET_REGISTRY[id].description.length).toBeGreaterThan(0)
    }
  })
})

describe("resolving a stored layout", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(resolveLayout(null)).toEqual([...DEFAULT_LAYOUT])
    expect(resolveLayout([])).toEqual([...DEFAULT_LAYOUT])
  })

  it("keeps the user's order", () => {
    const stored: WidgetPlacement[] = [
      { id: "summary", visible: true },
      { id: "watchlist", visible: true },
      { id: "allocation", visible: false },
    ]
    const resolved = resolveLayout(stored)
    expect(resolved.slice(0, 3).map((w) => w.id)).toEqual(["summary", "watchlist", "allocation"])
    expect(resolved[2].visible).toBe(false)
  })

  it("appends a widget added since the layout was saved, rather than displacing anything", () => {
    // A release that adds a widget must not rearrange a dashboard somebody set up.
    const stored: WidgetPlacement[] = [{ id: "summary", visible: true }, { id: "movers", visible: true }]
    const resolved = resolveLayout(stored)
    expect(resolved[0].id).toBe("summary")
    expect(resolved[1].id).toBe("movers")
    expect(resolved).toHaveLength(WIDGETS.length)
  })

  it("appends a new widget in its default visibility, not switched on", () => {
    const stored: WidgetPlacement[] = [{ id: "summary", visible: true }]
    const resolved = resolveLayout(stored)
    const dataQuality = resolved.find((w) => w.id === "dataQuality")
    expect(dataQuality?.visible).toBe(false)
  })

  it("drops a widget that no longer exists rather than rendering a blank card", () => {
    const stored = [
      { id: "summary", visible: true },
      { id: "removedWidget", visible: true },
    ] as unknown as WidgetPlacement[]
    expect(resolveLayout(stored).some((w) => String(w.id) === "removedWidget")).toBe(false)
  })

  it("ignores a duplicate id", () => {
    const stored: WidgetPlacement[] = [
      { id: "summary", visible: true },
      { id: "summary", visible: false },
    ]
    expect(resolveLayout(stored).filter((w) => w.id === "summary")).toHaveLength(1)
  })

  it("keeps a required widget visible whatever the stored row says", () => {
    const resolved = resolveLayout([{ id: "summary", visible: false }])
    expect(resolved.find((w) => w.id === "summary")?.visible).toBe(true)
  })
})

describe("customising the layout", () => {
  const layout = resolveLayout(null)

  it("hides and shows a widget", () => {
    const hidden = toggleWidget(layout, "movers", false)
    expect(hidden.find((w) => w.id === "movers")?.visible).toBe(false)
    expect(toggleWidget(hidden, "movers", true).find((w) => w.id === "movers")?.visible).toBe(true)
  })

  it("refuses to hide a required widget, without erroring", () => {
    expect(toggleWidget(layout, "summary", false).find((w) => w.id === "summary")?.visible).toBe(true)
  })

  it("moves a widget up and down", () => {
    const moved = moveWidget(layout, "performance", "up")
    expect(moved[1].id).toBe("performance")
    expect(moveWidget(moved, "performance", "down")[2].id).toBe("performance")
  })

  it("does nothing at the ends rather than wrapping", () => {
    expect(moveWidget(layout, layout[0].id, "up")).toEqual(layout)
    expect(moveWidget(layout, layout[layout.length - 1].id, "down")).toEqual(layout)
  })

  it("does nothing for a widget that is not there", () => {
    expect(moveWidget(layout, "movers", "up").length).toBe(layout.length)
  })

  it("never mutates the layout it was given", () => {
    const before = JSON.stringify(layout)
    toggleWidget(layout, "movers", false)
    moveWidget(layout, "movers", "up")
    reorderWidgets(layout, ["watchlist", "summary"])
    expect(JSON.stringify(layout)).toBe(before)
  })

  it("reorders to an explicit sequence and keeps the rest", () => {
    const reordered = reorderWidgets(layout, ["watchlist", "summary"])
    expect(reordered[0].id).toBe("watchlist")
    expect(reordered[1].id).toBe("summary")
    // A partial order must not lose the widgets it did not mention.
    expect(reordered).toHaveLength(layout.length)
  })

  it("ignores an unknown or repeated id in a reorder request", () => {
    const reordered = reorderWidgets(layout, ["summary", "summary", "nope" as never])
    expect(reordered).toHaveLength(layout.length)
    expect(reordered.filter((w) => w.id === "summary")).toHaveLength(1)
  })

  it("resets by resolving nothing, so the default is never frozen in storage", () => {
    // Reset stores `[]`. If it stored a copy of the default instead, a user who reset today would
    // be pinned to whatever the default was today, forever.
    expect(resolveLayout([])).toEqual([...DEFAULT_LAYOUT])
  })
})

describe("metrics", () => {
  it("names every one unambiguously", () => {
    // "Profit", "Return" and "Yield" are each two different numbers in a portfolio tracker.
    for (const id of METRICS) {
      const label = METRIC_REGISTRY[id].label
      expect(["Profit", "Return", "Yield", "Gain"]).not.toContain(label)
      expect(METRIC_REGISTRY[id].definition.length).toBeGreaterThan(20)
    }
  })

  it("distinguishes the two yields by name", () => {
    expect(METRIC_REGISTRY.yieldOnCost.label).toBe("Yield on cost")
    expect(METRIC_REGISTRY.yieldOnValue.label).toBe("Yield on current value")
  })

  it("falls back to the default when nothing is chosen", () => {
    expect(resolveMetrics(null)).toEqual([...DEFAULT_METRICS])
    expect(resolveMetrics([])).toEqual([...DEFAULT_METRICS])
  })

  it("drops a metric that no longer exists", () => {
    expect(resolveMetrics(["totalValue", "gone" as never])).toEqual(["totalValue"])
  })

  it("adds and removes a favourite", () => {
    const added = toggleMetric(["totalValue"], "cashRatio")
    expect(added.metrics).toEqual(["totalValue", "cashRatio"])
    expect(toggleMetric(added.metrics, "cashRatio").metrics).toEqual(["totalValue"])
  })

  it("refuses past the limit rather than silently dropping one", () => {
    const full = METRICS.slice(0, MAX_FAVORITE_METRICS)
    const result = toggleMetric(full, METRICS[MAX_FAVORITE_METRICS])
    expect(result.rejected).toBe("LIMIT")
    expect(result.metrics).toEqual([...full])
  })
})

describe("saved views — filtering", () => {
  it("matches a tag case-insensitively", () => {
    expect(matchesViewFilter(row(), { field: "tag", operator: "is", value: "growth" })).toBe(true)
    expect(matchesViewFilter(row(), { field: "tag", operator: "isNot", value: "growth" })).toBe(false)
  })

  it("matches a market exactly", () => {
    expect(matchesViewFilter(row(), { field: "market", operator: "is", value: "US" })).toBe(true)
    expect(matchesViewFilter(row({ market: "SET" }), { field: "market", operator: "is", value: "US" })).toBe(false)
  })

  it("compares numbers", () => {
    expect(matchesViewFilter(row(), { field: "weight", operator: "gt", value: 30 })).toBe(true)
    expect(matchesViewFilter(row(), { field: "weight", operator: "lt", value: 30 })).toBe(false)
  })

  it("excludes a null from every numeric comparison, in both directions", () => {
    // A holding no exchange rate reached has an *unknown* weight, not a small one. It must not
    // appear in "weight > 10" and it must not appear in "weight < 10" either.
    const untranslated = row({ weight: null })
    expect(matchesViewFilter(untranslated, { field: "weight", operator: "gt", value: 10 })).toBe(false)
    expect(matchesViewFilter(untranslated, { field: "weight", operator: "lt", value: 10 })).toBe(false)
  })

  it("refuses a non-numeric filter value rather than coercing it", () => {
    expect(matchesViewFilter(row(), { field: "weight", operator: "gt", value: "lots" })).toBe(false)
  })
})

describe("saved views — sorting and grouping", () => {
  const rows = [
    row({ symbol: "NVDA", marketValue: 1_800, weight: 40, tags: ["Growth", "Core"] }),
    row({ symbol: "AAPL", marketValue: 3_000, weight: 55, tags: ["Core"], sector: "Technology" }),
    row({ symbol: "PTT", market: "SET", marketValue: null, weight: null, tags: [], sector: null }),
  ]

  it("sorts descending by default", () => {
    const { groups } = applyView(rows, DEFAULT_VIEW_CONFIG)
    expect(groups[0].rows.map((r) => r.symbol)).toEqual(["AAPL", "NVDA", "PTT"])
  })

  it("sorts nulls last in both directions", () => {
    const asc = applyView(rows, { ...DEFAULT_VIEW_CONFIG, sortDirection: "asc" })
    expect(asc.groups[0].rows.at(-1)?.symbol).toBe("PTT")
    const desc = applyView(rows, { ...DEFAULT_VIEW_CONFIG, sortDirection: "desc" })
    expect(desc.groups[0].rows.at(-1)?.symbol).toBe("PTT")
  })

  it("puts a row under every tag it carries", () => {
    const { groups } = applyView(rows, { ...DEFAULT_VIEW_CONFIG, groupBy: "tag" })
    const core = groups.find((g) => g.key === "Core")
    expect(core?.rows.map((r) => r.symbol).sort()).toEqual(["AAPL", "NVDA"])
    expect(groups.find((g) => g.key === "Growth")?.rows).toHaveLength(1)
  })

  it("always provides an Ungrouped bucket and puts it last", () => {
    const { groups } = applyView(rows, { ...DEFAULT_VIEW_CONFIG, groupBy: "tag" })
    expect(groups.at(-1)?.key).toBe(UNGROUPED)
    expect(groups.at(-1)?.rows.map((r) => r.symbol)).toEqual(["PTT"])
  })

  it("never guesses a sector from a symbol", () => {
    const { groups } = applyView(rows, { ...DEFAULT_VIEW_CONFIG, groupBy: "sector" })
    expect(groups.find((g) => g.key === UNGROUPED)?.rows.map((r) => r.symbol)).toEqual(["PTT"])
  })

  it("filters before grouping, and reports the count after filtering", () => {
    const result = applyView(rows, {
      ...DEFAULT_VIEW_CONFIG,
      filters: [{ field: "market", operator: "is", value: "US" }],
    })
    expect(result.total).toBe(2)
  })

  it("never alters a row", () => {
    const before = JSON.stringify(rows)
    applyView(rows, { ...DEFAULT_VIEW_CONFIG, groupBy: "tag", sortDirection: "asc" })
    expect(JSON.stringify(rows)).toBe(before)
  })

  it("returns everything under one group when grouping is off", () => {
    const { groups } = applyView(rows, DEFAULT_VIEW_CONFIG)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(3)
  })
})

describe("pinned and recent", () => {
  const stock = { kind: "stock" as const, ref: "US:NVDA", label: "NVDA" }

  it("pins and unpins", () => {
    const pinned = togglePin([], stock)
    expect(isPinned(pinned.items, "stock", "US:NVDA")).toBe(true)
    expect(togglePin(pinned.items, stock).items).toEqual([])
  })

  it("refuses past the limit rather than evicting something the user pinned", () => {
    const full = Array.from({ length: MAX_PINNED }, (_, i) => ({ ...stock, ref: `US:S${i}` }))
    const result = togglePin(full, stock)
    expect(result.rejected).toBe("LIMIT")
    expect(result.items).toHaveLength(MAX_PINNED)
  })

  it("records recent items most-recent-first and deduplicates", () => {
    const one = recordRecent([], stock)
    const two = recordRecent(one, { kind: "stock", ref: "US:AAPL", label: "AAPL" })
    const again = recordRecent(two, stock)
    expect(again.map((r) => r.ref)).toEqual(["US:NVDA", "US:AAPL"])
  })

  it("is bounded, so it is a way back and not a history", () => {
    let recent = [] as ReturnType<typeof recordRecent>
    for (let i = 0; i < 30; i += 1) {
      recent = recordRecent(recent, { kind: "stock", ref: `US:S${i}`, label: `S${i}` })
    }
    expect(recent).toHaveLength(MAX_RECENT)
    expect(recent[0].ref).toBe("US:S29")
  })
})

describe("dismissing an insight", () => {
  it("stores the rule code, not the sentence", () => {
    // Dismissing "your largest position is 24.5%" must not bring it back at 24.6%.
    expect(dismissInsight([], "CONCENTRATION_HIGH")).toEqual(["CONCENTRATION_HIGH"])
  })

  it("is idempotent", () => {
    const once = dismissInsight([], "CONCENTRATION_HIGH")
    expect(dismissInsight(once, "CONCENTRATION_HIGH")).toEqual(once)
  })

  it("restores", () => {
    expect(restoreInsight(["CONCENTRATION_HIGH"], "CONCENTRATION_HIGH")).toEqual([])
  })

  it("refuses to hide anything that explains why a figure is wrong", () => {
    for (const code of UNDISMISSABLE_INSIGHTS) {
      expect(canDismiss(code)).toBe(false)
      expect(dismissInsight([], code)).toEqual([])
    }
  })

  it("filters a rendered list, and keeps the undismissable ones whatever is stored", () => {
    const insights = [
      { code: "CONCENTRATION_HIGH" },
      { code: "DATA_STALE_PRICES" },
      { code: "ACTIVITY_QUIET" },
    ]
    const shown = withoutDismissed(insights, ["CONCENTRATION_HIGH", "DATA_STALE_PRICES"])
    expect(shown.map((i) => i.code)).toEqual(["DATA_STALE_PRICES", "ACTIVITY_QUIET"])
  })
})
