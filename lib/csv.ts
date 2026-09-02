/**
 * Minimal RFC 4180 CSV, both directions. A dependency for this would be a dependency for a hundred
 * lines, and the reader has to be conservative about untrusted input anyway.
 *
 * The escaping matters: a note containing a comma, a quote or a newline must not shift every later
 * column, and a value beginning with =, +, - or @ is prefixed with a quote so a spreadsheet treats
 * it as text rather than executing it as a formula.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  let text = String(value)
  // CSV injection: a cell starting with a formula character is executed by Excel and Sheets.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")]
  for (const row of rows) lines.push(row.map(escapeCell).join(","))
  // CRLF and a UTF-8 BOM, so Excel opens accented company names correctly.
  return `﻿${lines.join("\r\n")}\r\n`
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

// ---------------------------------------------------------------- reading
//
// The writer above exists so Stockly's exports open cleanly in Excel. The reader below exists so a
// file from somebody else's broker can be imported — which is a different problem: everything about
// it is untrusted, and the failure mode of a wrong guess is a wrong transaction.

/** Delimiters a real broker export uses. Detected rather than assumed — see `detectDelimiter`. */
export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number]

/**
 * Guesses the delimiter from the first few lines.
 *
 * Counted **outside quotes only**: a European export with `"Smith, John"` in a semicolon-separated
 * file would otherwise look comma-separated, and every column after that one would shift.
 *
 * Ties break toward the comma, which is what an unhelpful file is most likely to be.
 */
export function detectDelimiter(text: string, sampleLines = 5): CsvDelimiter {
  const sample = text.split(/\r?\n/).slice(0, sampleLines).join("\n")
  let best: CsvDelimiter = ","
  let bestCount = 0

  for (const delimiter of CSV_DELIMITERS) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < sample.length; i += 1) {
      const character = sample[i]
      if (character === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not a terminator.
        if (inQuotes && sample[i + 1] === '"') i += 1
        else inQuotes = !inQuotes
      } else if (!inQuotes && character === delimiter) count += 1
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/** Strips a UTF-8 byte-order mark, which Excel writes and which would corrupt the first header. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export type ParsedCsv = {
  rows: string[][]
  delimiter: CsvDelimiter
  /** Rows dropped because they were entirely empty. Reported rather than silently skipped. */
  blankRows: number
}

/**
 * Parses CSV into a grid of strings.
 *
 * Deliberately does **no** type inference: every cell comes out as text, and turning it into a
 * date, a decimal or a side is the import layer's job, where a failure becomes a validation error
 * against a row number instead of a silent coercion.
 *
 * Handles the cases a broker export actually contains: a BOM, CRLF or LF, quoted fields containing
 * the delimiter or a newline, doubled quotes, and a trailing newline. A quoted field left unclosed
 * at end of input is terminated rather than throwing — the row will fail validation with its
 * number attached, which is more useful than losing the whole file.
 */
export function parseCsv(
  input: string,
  { delimiter }: { delimiter?: CsvDelimiter } = {},
): ParsedCsv {
  const text = stripBom(input)
  const separator = delimiter ?? detectDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let blankRows = 0

  const endField = () => {
    row.push(field)
    field = ""
  }
  const endRow = () => {
    endField()
    // A trailing newline produces one empty field, which is not a row.
    if (row.length === 1 && row[0].trim() === "") blankRows += 1
    else if (row.every((cell) => cell.trim() === "")) blankRows += 1
    else rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]

    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field === "") {
      inQuotes = true
    } else if (character === separator) {
      endField()
    } else if (character === "\n") {
      endRow()
    } else if (character === "\r") {
      // CRLF: the \n does the work. A lone CR is treated as a line ending too.
      if (text[i + 1] === "\n") i += 1
      endRow()
    } else {
      field += character
    }
  }

  // Whatever is left after the last line ending, including an unterminated quoted field.
  if (field !== "" || row.length > 0) endRow()

  return { rows, delimiter: separator, blankRows }
}
