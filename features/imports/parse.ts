import "server-only"

import { detectDelimiter, parseCsv } from "@/lib/csv"
import { XlsxError, looksLikeXlsx, readWorkbook } from "@/lib/xlsx"
import type { ImportFormat } from "@/domain/import"
import { MAX_CELL_LENGTH, MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "./schema"

/**
 * Turning an uploaded file into a grid of strings.
 *
 * Everything about the file is untrusted: the extension, the name, the declared type and the bytes.
 * So the **content** decides which parser runs \u2014 a `.csv` that is really a workbook is read as
 * one, and a `.xlsx` that is really text fails with a sentence rather than a stack trace. Nothing
 * is ever executed, and the bytes are dropped when the request ends.
 *
 * The grid is capped on both axes before it leaves this function, so nothing downstream has to
 * defend itself against a hundred-thousand-row sheet.
 */

export class ImportParseError extends Error {
  constructor(
    readonly code: "EMPTY" | "TOO_LARGE" | "UNREADABLE" | "NO_ROWS",
    message: string,
  ) {
    super(message)
    this.name = "ImportParseError"
  }
}

export type ParsedFile = {
  format: ImportFormat
  /** The grid, capped. Row 0 is whatever the file's first non-blank line was. */
  rows: string[][]
  /** Sheet names, for a workbook. Empty for a CSV. */
  sheets: string[]
  /** Which sheet the rows came from. Null for a CSV. */
  sheet: string | null
  delimiter: string | null
  blankRows: number
}

function cap(rows: string[][]): string[][] {
  return rows
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) => row.slice(0, MAX_IMPORT_COLUMNS).map((cell) => cell.slice(0, MAX_CELL_LENGTH)))
}

/** The replacement character, which is what binary looks like once it has been decoded as UTF-8. */
const REPLACEMENT = "\uFFFD"

/**
 * Parses an uploaded file.
 *
 * `sheet` selects a worksheet by name; without it the first sheet that has rows is used, which is
 * what a single-sheet export needs and a sensible default for the rest.
 */
export function parseImportFile(
  bytes: Buffer,
  { sheet }: { sheet?: string } = {},
): ParsedFile {
  if (bytes.length === 0) throw new ImportParseError("EMPTY", "That file is empty.")

  if (looksLikeXlsx(bytes)) {
    let workbook
    try {
      workbook = readWorkbook(bytes)
    } catch (error) {
      // The reader's messages are already written for a user; anything else becomes a generic
      // sentence rather than leaking an internal one.
      throw new ImportParseError(
        error instanceof XlsxError && error.code === "TOO_LARGE" ? "TOO_LARGE" : "UNREADABLE",
        error instanceof XlsxError ? error.message : "That workbook could not be read.",
      )
    }

    const chosen =
      (sheet ? workbook.sheets.find((s) => s.name === sheet) : undefined) ??
      workbook.sheets.find((s) => s.rows.length > 0) ??
      workbook.sheets[0]

    if (!chosen || chosen.rows.length === 0) {
      throw new ImportParseError("NO_ROWS", "That worksheet has no rows.")
    }

    return {
      format: "XLSX",
      rows: cap(chosen.rows),
      sheets: workbook.sheets.map((s) => s.name),
      sheet: chosen.name,
      delimiter: null,
      blankRows: 0,
    }
  }

  // Not a zip, so it is text. Decoded as UTF-8; the parser handles a byte-order mark.
  const text = bytes.toString("utf8")
  // A binary file that is not a zip decodes to replacement characters rather than to columns.
  if (text.includes(REPLACEMENT)) {
    throw new ImportParseError("UNREADABLE", "That file is not a CSV or an .xlsx workbook.")
  }

  const parsed = parseCsv(text)
  if (parsed.rows.length === 0) throw new ImportParseError("NO_ROWS", "That file has no rows.")

  return {
    format: "CSV",
    rows: cap(parsed.rows),
    sheets: [],
    sheet: null,
    delimiter: detectDelimiter(text),
    blankRows: parsed.blankRows,
  }
}
