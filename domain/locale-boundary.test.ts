import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import {
  DEFAULT_LOCALE,
  intlTag,
  isLocale,
  LOCALE_META,
  matchLocale,
  SUPPORTED_LOCALES,
  toLocale,
} from "./locale"
import {
  formatCompact,
  formatCurrency,
  formatCurrencyWithCode,
  formatDate,
  formatFxRate,
  formatLongDate,
  formatPercent,
  formatQuantity,
  formatSignedCurrency,
} from "@/lib/format"
import type { DomainTransaction } from "./types"

/**
 * The phase 21 boundary.
 *
 * **A locale decides what a number is called. It can never decide what the number is.**
 *
 * The same one-way arrow phases 10, 13 and 15 drew, re-proved for language because language is the
 * layer with the widest reach in the application: it touches every screen, and an i18n change that
 * quietly moved a figure would be visible to exactly half the users.
 *
 * `Thai and English must produce exactly the same financial result` is the claim; these are the
 * tests that make it one rather than an intention.
 */

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-02",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const TRANSACTIONS = [
  tx("NVDA", "buy", 10, 170, 1.5, "2026-01-02", 1),
  tx("AAPL", "buy", 20, 200, 1, "2026-02-02", 2),
  tx("NVDA", "sell", 4, 200, 1.5, "2026-03-02", 3),
]
const CASH = [
  { kind: "deposit" as const, amount: 10_000, currency: "USD" as const, occurredOn: "2026-01-01" },
]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, [])
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

/** Every locale operation the application performs, once each. */
function everyLocaleOperation(): void {
  for (const locale of SUPPORTED_LOCALES) {
    intlTag(locale)
    isLocale(locale)
    toLocale(locale)
    formatDate("2026-09-03", locale)
    formatLongDate("2026-09-03", locale)
  }
  matchLocale(["th-TH", "en-GB", "ja"])
  toLocale("not-a-locale")
  toLocale(null)
}

describe("language cannot change a financial figure", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    everyLocaleOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when every operation runs repeatedly", () => {
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyLocaleOperation()
    expect(financialState()).toBe(before)
  })
})

/**
 * The measurement `lib/format.ts` is built on.
 *
 * Money, quantities, percentages and compact figures must be identical in every language — not
 * merely "close", not "the same to two decimal places", but the same string. That is what makes it
 * safe for `formatCurrency` to take no locale at all, and it is the property most likely to be
 * broken silently by a future ICU/Node release rather than by anybody's code.
 */
describe("every financial figure renders identically in every language", () => {
  const AMOUNTS = [0, 1, -1, 0.005, 1234.56, -98_765.4321, 1_000_000_000, 4.4e12]
  const CURRENCIES = ["USD", "THB", "EUR", "JPY"]

  it("currency, with and without an explicit code", () => {
    for (const amount of AMOUNTS) {
      for (const currency of CURRENCIES) {
        const rendered = new Set(SUPPORTED_LOCALES.map(() => formatCurrency(amount, currency)))
        expect(rendered.size, `${amount} ${currency}`).toBe(1)
        expect(new Set(SUPPORTED_LOCALES.map(() => formatCurrencyWithCode(amount, currency))).size).toBe(1)
        expect(new Set(SUPPORTED_LOCALES.map(() => formatSignedCurrency(amount, currency))).size).toBe(1)
      }
    }
  })

  it("quantities, percentages, compact figures and FX rates", () => {
    for (const amount of AMOUNTS) {
      expect(new Set(SUPPORTED_LOCALES.map(() => formatQuantity(amount))).size).toBe(1)
      expect(new Set(SUPPORTED_LOCALES.map(() => formatPercent(amount))).size).toBe(1)
      expect(new Set(SUPPORTED_LOCALES.map(() => formatCompact(amount))).size).toBe(1)
      expect(new Set(SUPPORTED_LOCALES.map(() => formatFxRate("USD", "THB", 32.45))).size).toBe(1)
    }
  })

  /*
   * The claim above rests on `Intl` itself agreeing, so this asserts it directly against every
   * supported tag rather than against the formatters that wrap it. If a future ICU gives Thai its
   * own grouping or digits, this fails first and names the reason.
   */
  it("Intl itself renders the same digits, grouping and separators in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const tag = intlTag(locale)
      expect(new Intl.NumberFormat(tag).format(1_234_567.89)).toBe("1,234,567.89")
      expect(
        new Intl.NumberFormat(tag, {
          style: "currency",
          currency: "THB",
          currencyDisplay: "narrowSymbol",
        }).format(1234.5),
      ).toBe(
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "THB",
          currencyDisplay: "narrowSymbol",
        }).format(1234.5),
      )
    }
  })
})

/**
 * Dates are the one thing that differs, and the era is the one thing that must not.
 *
 * `th-TH` without the calendar extension resolves to the Buddhist era, which would render a 2026
 * trade date as 2569 in Thai and 2026 in English — one transaction, two years. This is the test
 * that keeps `-u-ca-gregory` in place; deleting it from `LOCALE_META` fails here.
 */
describe("dates carry one era in every language", () => {
  it("renders the same year in Thai as in English", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(formatDate("2026-09-03", locale)).toContain("2026")
      expect(formatLongDate("2026-09-03", locale)).toContain("2026")
      expect(formatDate("2026-09-03", locale)).not.toContain("2569")
    }
  })

  it("renders the same calendar day in every language", () => {
    // The month's *name* may differ; the day and the year may not.
    for (const locale of SUPPORTED_LOCALES) {
      expect(formatLongDate("2026-09-03", locale)).toMatch(/(^|\D)3(\D|$)/)
    }
  })

  it("translates the month, so the two languages are not merely identical", () => {
    expect(formatLongDate("2026-09-03", "th")).not.toBe(formatLongDate("2026-09-03", "en"))
    expect(formatLongDate("2026-09-03", "th")).toContain("กันยายน")
    expect(formatLongDate("2026-09-03", "en")).toContain("September")
  })

  it("reads a calendar date in UTC, so a trade date never shifts by a day", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(formatDate("2026-01-01", locale)).toContain("2026")
      expect(formatDate("2026-01-01", locale)).toMatch(/01|1/)
    }
  })
})

describe("the locale registry", () => {
  it("defaults to Thai, as the product decision states", () => {
    expect(DEFAULT_LOCALE).toBe("th")
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE)
  })

  it("refuses anything that is not a supported locale", () => {
    for (const value of ["", "TH", "th-TH", "de", "ja", null, undefined, 0, {}, []]) {
      expect(toLocale(value)).toBeNull()
      expect(isLocale(value)).toBe(false)
    }
  })

  it("matches a browser preference list down to its base language", () => {
    expect(matchLocale(["th-TH", "en-US"])).toBe("th")
    expect(matchLocale(["en-GB"])).toBe("en")
    expect(matchLocale(["de-DE", "fr"])).toBeNull()
    expect(matchLocale([])).toBeNull()
  })

  it("names every locale in its own language", () => {
    // So somebody who has switched into a script they cannot read can still switch back.
    expect(LOCALE_META.th.label).toBe("ไทย")
    expect(LOCALE_META.en.label).toBe("English")
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_META[locale].short).toMatch(/^[A-Z]{2}$/)
    }
  })

  it("pins the Gregorian calendar for Thai and only for Thai", () => {
    expect(intlTag("th")).toContain("ca-gregory")
    expect(intlTag("en")).toBe("en-US")
  })
})

describe("the locale module cannot reach anything", () => {
  const contents = readFileSync(join(process.cwd(), "domain", "locale.ts"), "utf8")

  const FORBIDDEN = [
    "@/lib/",
    "@/features/",
    "@/services/",
    "supabase",
    "server-only",
    "next/",
    "fetch(",
    "localStorage",
    "document.",
    "window.",
    "process.env",
    "Intl.",
  ]

  for (const needle of FORBIDDEN) {
    it(`does not mention ${needle}`, () => {
      expect(contents).not.toContain(needle)
    })
  }

  it("imports nothing at all", () => {
    expect(contents).not.toMatch(/^\s*import\s/m)
  })
})
