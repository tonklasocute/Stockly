/**
 * Minimal RFC 4180 CSV writer. A dependency for this would be a dependency for twenty lines.
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
