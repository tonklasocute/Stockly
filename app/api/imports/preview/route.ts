import { ApiError, MAX_IMPORT_REQUEST_BYTES, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { suggestMapping, looksLikeHeader, type ColumnMapping } from "@/domain/import"
import { ImportParseError, parseImportFile } from "@/features/imports/parse"
import { previewImport } from "@/features/imports/queries"
import { MAX_IMPORT_BYTES, previewRequestSchema } from "@/features/imports/schema"
import { logger } from "@/lib/log"

/**
 * Parse a file, or re-preview a grid the client already has.
 *
 * **This endpoint writes nothing.** No session, no row, no transaction — a preview is a pure
 * function of the file and the fingerprints already stored, which is what makes it safe to put in
 * front of a user before they commit, and what lets them change the mapping as often as they like.
 *
 * Two shapes, decided by the content type: multipart for the first upload, JSON afterwards. The
 * file is parsed in this request and the bytes are dropped — nothing is stored, so there is no
 * bucket of other people's brokerage statements to secure or expire.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    // Parsing a workbook is real CPU, and the endpoint accepts megabytes.
    enforceRateLimit(`imports:preview:${userId}`, 30, 60)

    const contentType = request.headers.get("content-type") ?? ""

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null)
      if (!form) throw new ApiError("VALIDATION_ERROR", "That upload could not be read.")

      const file = form.get("file")
      if (!(file instanceof File)) throw new ApiError("VALIDATION_ERROR", "Attach a file.")
      if (file.size > MAX_IMPORT_BYTES) {
        throw new ApiError(
          "PAYLOAD_TOO_LARGE",
          `That file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB. Split it and import the parts.`,
        )
      }

      const sheet = form.get("sheet")
      let parsed
      try {
        parsed = parseImportFile(
          Buffer.from(await file.arrayBuffer()),
          typeof sheet === "string" && sheet ? { sheet } : {},
        )
      } catch (error) {
        if (error instanceof ImportParseError) {
          // The parser's messages are written for a user; internal ones never reach here.
          throw new ApiError("VALIDATION_ERROR", error.message)
        }
        throw error
      }

      // The name is never logged and never used as a path. Only its size and shape are.
      logger.info("import.parsed", {
        format: parsed.format,
        rows: parsed.rows.length,
        bytes: file.size,
      })

      const headerRow = parsed.rows.findIndex((row) => looksLikeHeader(row))
      const resolvedHeader = headerRow >= 0 ? headerRow : 0

      return ok({
        format: parsed.format,
        sheets: parsed.sheets,
        sheet: parsed.sheet,
        delimiter: parsed.delimiter,
        blankRows: parsed.blankRows,
        rows: parsed.rows,
        headerRow: resolvedHeader,
        // A suggestion the user confirms. A wrong guess here is a wrong transaction, so it is never
        // applied on its own.
        mapping: suggestMapping(parsed.rows[resolvedHeader] ?? []),
      })
    }

    const body = await parseBody(request, previewRequestSchema, {
      maxBytes: MAX_IMPORT_REQUEST_BYTES,
    })
    // RLS scopes the fingerprint read, so a portfolio belonging to someone else contributes none —
    // and the apply path enforces ownership again through the composite foreign key.
    const preview = await previewImport(
      body.rows,
      body.mapping as ColumnMapping[],
      body.headerRow,
      body.portfolioId,
    )
    return ok({ preview })
  })
}
