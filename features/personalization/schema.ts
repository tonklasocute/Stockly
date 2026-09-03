import { z } from "zod"
import {
  DENSITIES,
  GROUPINGS,
  METRICS,
  MAX_FAVORITE_METRICS,
  PINNABLE_KINDS,
  SORT_DIRECTIONS,
  THEMES,
  VIEW_COLUMNS,
  VIEW_FILTER_FIELDS,
  VIEW_FILTER_OPERATORS,
  WIDGETS,
} from "@/domain/personalization"

/**
 * What a request may contain.
 *
 * Every field is a **closed enum from the domain registry** — a widget id, a metric id, a filter
 * field. Nothing here accepts a free string the server later interprets, and nothing accepts a
 * `userId`: ownership comes from the session and from RLS, never from a body.
 *
 * These are validated server-side even though the same schemas run in the browser. A persisted
 * configuration is read back and rendered later, so a client that posted an unknown widget id would
 * be storing something the next render has to cope with.
 */

export const widgetPlacementSchema = z.object({
  id: z.enum(WIDGETS),
  visible: z.boolean(),
})

export const preferencesSchema = z.object({
  theme: z.enum(THEMES).optional(),
  density: z.enum(DENSITIES).optional(),
  defaultPortfolioId: z.uuid().nullable().optional(),
  favoriteMetrics: z.array(z.enum(METRICS)).max(MAX_FAVORITE_METRICS).optional(),
  // Bounded by the number of widgets that exist: a longer array is either a duplicate or an
  // invention, and `resolveLayout` would drop it anyway.
  dashboardLayout: z.array(widgetPlacementSchema).max(WIDGETS.length).optional(),
  dismissedInsights: z.array(z.string().max(60)).max(40).optional(),
})

export type PreferencesInput = z.infer<typeof preferencesSchema>

export const pinnedItemSchema = z.object({
  kind: z.enum(PINNABLE_KINDS),
  ref: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(60),
})

export const viewFilterSchema = z.object({
  field: z.enum(VIEW_FILTER_FIELDS),
  operator: z.enum(VIEW_FILTER_OPERATORS),
  // A string or a number, and nothing else. Never an object, never an array — a filter value that
  // could be a structure is a filter value that could be a query.
  value: z.union([z.string().max(40), z.number()]),
})

export const viewConfigSchema = z.object({
  filters: z.array(viewFilterSchema).max(10).default([]),
  sortBy: z.enum(VIEW_COLUMNS).default("marketValue"),
  sortDirection: z.enum(SORT_DIRECTIONS).default("desc"),
  columns: z.array(z.enum(VIEW_COLUMNS)).min(1).max(VIEW_COLUMNS.length).default(["symbol", "marketValue"]),
  groupBy: z.enum(GROUPINGS).default("none"),
})

export const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(40),
  portfolioId: z.uuid().nullable().default(null),
  config: viewConfigSchema,
})

export const TAG_COLORS = ["slate", "blue", "green", "amber", "red", "violet", "teal", "pink"] as const

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(30),
  color: z.enum(TAG_COLORS).default("slate"),
})

export const holdingTagSchema = z.object({
  portfolioId: z.uuid(),
  tagId: z.uuid(),
  market: z.enum(["US", "SET"]),
  symbol: z.string().trim().min(1).max(20),
})

/**
 * Caps a user can reach.
 *
 * Enforced against a database count rather than in memory, so they hold across serverless instances
 * — the same reasoning as the alert and scenario caps.
 */
export const MAX_TAGS_PER_USER = 40
export const MAX_SAVED_VIEWS = 30
