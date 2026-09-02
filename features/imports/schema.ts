import { z } from "zod"
import { IMPORT_FIELDS, IMPORT_FORMATS } from "@/domain/import"

/**
 * The wire format for an import.
 *
 * Two steps, both of which carry the whole grid: **preview writes nothing at all**, so there is no
 * server-side session to hold rows between them and no half-finished import to expire. The file is
 * parsed once, and the grid travels with each subsequent request.
 *
 * Everything is capped. A grid is user-supplied, arrives before authentication has narrowed
 * anything, and is the largest thing this application accepts.
 */

/** A file that will not fit through this is a broker export that needs splitting, not a bug. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5_000
export const MAX_IMPORT_COLUMNS = 60
export const MAX_CELL_LENGTH = 500

/** The parsed grid, as the preview step returned it. */
export const gridSchema = z
  .array(z.array(z.string().max(MAX_CELL_LENGTH)).max(MAX_IMPORT_COLUMNS))
  .max(MAX_IMPORT_ROWS, `An import is capped at ${MAX_IMPORT_ROWS} rows.`)

export const mappingSchema = z
  .array(
    z.object({
      field: z.enum(IMPORT_FIELDS),
      columnIndex: z.int().min(0).max(MAX_IMPORT_COLUMNS - 1).nullable(),
    }),
  )
  .max(IMPORT_FIELDS.length)

export const previewRequestSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  rows: gridSchema,
  mapping: mappingSchema,
  /** Which grid row holds the headers. Rows above it are ignored; the ones below are data. */
  headerRow: z.int().min(0).max(MAX_IMPORT_ROWS - 1).default(0),
})

export const applyRequestSchema = previewRequestSchema.extend({
  filename: z.string().trim().min(1).max(255),
  format: z.enum(IMPORT_FORMATS),
  /**
   * Whether to create the valid rows when some are invalid.
   *
   * Explicit, never assumed. Silently importing 95 of 100 rows and reporting success is how a
   * portfolio ends up quietly missing five trades; refusing all 100 because of one typo is how a
   * user gives up. The choice is theirs, and the preview tells them what each one means.
   */
  allowPartial: z.boolean().default(false),
})

export type PreviewRequest = z.output<typeof previewRequestSchema>
export type ApplyRequest = z.output<typeof applyRequestSchema>
