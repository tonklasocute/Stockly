import { execSync } from "node:child_process"
import { describe, expect, it } from "vitest"

/**
 * The phase 21 audit, kept running.
 *
 * A one-off sweep migrates the strings that exist today; this is what stops tomorrow's from
 * arriving untranslated. It runs the same extractor the migration used
 * (`scripts/i18n-extract.mjs`) and holds its output to a fixed allowlist — so a new
 * `<h1>Positions</h1>` fails the suite with the file and the sentence, rather than shipping in one
 * language.
 *
 * ## What is deliberately allowed
 *
 * The extractor matches shapes, not meaning, so a handful of things it reports are correct as they
 * are. Each is listed with the reason, and a bare addition to this list should be argued for in
 * review:
 *
 * - **"Stockly"** — a brand name. It is the same word in every language.
 * - **"N/A"** — the single representation of "not computable", settled in phase 17.5. It is two
 *   letters, it is understood in both languages, and `common.state.notApplicable` carries it for
 *   anywhere that needs the string rather than the literal.
 * - **Ticker symbols and slug examples** — `NVDA`, `AAPL`, `my-portfolio`. A symbol is not prose.
 * - **The bilingual fatal-error screen** — `app/global-error.tsx` renders without a provider and
 *   says everything twice on purpose.
 * - **Indicator names** — `RSI`, `MACD`, `EMA 20`. Written the same way on every chart in the world.
 * - **TypeScript fragments** the shape-matcher mistakes for text.
 */

const ALLOWED = new Set([
  // Brand and shared notation.
  "Stockly",
  "N/A",
  "Stockly could not load",
  "Not available",

  // An environment variable and a filename, quoted in an instruction. Both are literal strings a
  // reader types, not words to translate — the sentence around them is in the `ai` namespace.
  "AI_ENABLED=true",

  // Indicator and axis names.
  "EMA 20",
  "EMA 50",
  "EMA 200",
  "RSI",
  "MACD",

  // Type-level fragments the matcher cannot tell from prose.
  "Promise",
  "return (",
  "new Set",
  "type Tc = Awaited",
  "searchParams: Promise",
  "userChoice: Promise",
  "technicals?: Record",
  "technicals: Map",
  "widgets[id] ?",
  "z.coerce.number",
  "export type ApplyRequest = z.output",
  "export type AlertInput = z.output",
  "export type CashInput = z.output",
  "export type DividendInput = z.output",
  "export type GoalInput = z.output",
  "export type JournalInput = z.output",
  "export type PortfolioInput = z.output",
  "export type ThesisInput = z.output",
  "export type TransactionInput = z.output",
  "export type WatchlistInput = z.output",
  "const addQuotes = (found: Map",
  "contributors: ReturnType",
  "turnover: ReturnType",
  "fees: ReturnType",
  "from && at",
  "previous && f.occurredOn",
  "holdingsWithoutMetadata: Array",
  'if (unit === "percent") return',
  "value.periodStart === null || value.periodEnd === null || value.periodStart",
])

describe("no new hardcoded user-facing text", () => {
  const found = new Map<string, string[]>()

  const output = execSync("node scripts/i18n-extract.mjs app components features", {
    encoding: "utf8",
    cwd: process.cwd(),
  })

  let current = ""
  for (const line of output.split("\n")) {
    if (line.startsWith("### ")) {
      current = line.slice(4)
      continue
    }
    if (!line.startsWith("  ") || line.startsWith("---")) continue
    const value = line.trim()
    if (!value || ALLOWED.has(value)) continue
    found.set(current, [...(found.get(current) ?? []), value])
  }

  it("finds none", () => {
    const report = [...found.entries()]
      .map(([file, strings]) => `${file}\n    ${strings.join("\n    ")}`)
      .join("\n  ")

    expect(
      found.size,
      report
        ? `Hardcoded user-facing text. Move each into a namespace and use t():\n  ${report}`
        : "",
    ).toBe(0)
  })
})
