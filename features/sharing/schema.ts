import { z } from "zod"
import {
  LINK_DURATIONS,
  RESERVED_SLUGS,
  SHARE_TEMPLATES,
  SHARE_VISIBILITIES,
} from "@/domain/sharing"

/**
 * What a request may contain. Nothing here accepts a user id, and nothing accepts a figure — a
 * shared page's numbers are computed on the server from the portfolio, never posted by a client.
 */

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters.")
  .max(48, "At most 48 characters.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only.")
  .refine((value) => !RESERVED_SLUGS.includes(value), "That address is reserved.")

export const shareConfigSchema = z.object({
  portfolioId: z.uuid(),
  visibility: z.enum(SHARE_VISIBILITIES),
  slug: slug.nullable().default(null),
  displayName: z.string().trim().min(1).max(60).nullable().default(null),
  description: z.string().trim().max(280).nullable().default(null),
  ownerDisplayName: z.string().trim().min(1).max(40).nullable().default(null),

  showOverview: z.boolean().default(false),
  showHoldings: z.boolean().default(false),
  showAllocation: z.boolean().default(false),
  showPerformance: z.boolean().default(false),
  showRisk: z.boolean().default(false),
  showDividends: z.boolean().default(false),
  showBenchmark: z.boolean().default(false),
  showInsights: z.boolean().default(false),
  showGoals: z.boolean().default(false),

  showAbsoluteValues: z.boolean().default(false),
  showQuantity: z.boolean().default(false),
  showUnrealizedPnl: z.boolean().default(false),
  showRealizedPnl: z.boolean().default(false),
  showCash: z.boolean().default(false),

  allowSearchIndexing: z.boolean().default(false),
})
  // The database says the same thing with check constraints. Saying it here as well turns a 500
  // from Postgres into a field error the form can render next to the control that caused it.
  .refine((value) => value.visibility !== "PUBLIC" || value.slug !== null, {
    message: "A public portfolio needs a public address.",
    path: ["slug"],
  })
  .refine((value) => !value.allowSearchIndexing || value.visibility === "PUBLIC", {
    message: "Only a public portfolio can be indexed.",
    path: ["allowSearchIndexing"],
  })

export type ShareConfigInput = z.infer<typeof shareConfigSchema>

export const applyTemplateSchema = z.object({
  portfolioId: z.uuid(),
  template: z.enum(SHARE_TEMPLATES),
})

export const createLinkSchema = z.object({
  portfolioId: z.uuid(),
  label: z.string().trim().min(1).max(60).nullable().default(null),
  duration: z.enum(LINK_DURATIONS.map((d) => d.key) as [string, ...string[]]).default("30D"),
})

export const createSnapshotSchema = z.object({
  portfolioId: z.uuid(),
  label: z.string().trim().min(1).max(60).nullable().default(null),
})

/**
 * The most links and snapshots one portfolio may hold.
 *
 * Both are cheap rows, but both are capabilities: a hundred live links is a portfolio whose owner
 * has lost track of who can see it, and unbounded snapshots is unbounded storage of rendered
 * figures. Enforced against a count, so it holds across instances.
 */
export const MAX_LINKS_PER_PORTFOLIO = 20
export const MAX_SNAPSHOTS_PER_PORTFOLIO = 50
