import { ratio, type FinancialStatement, type FiscalPeriod, periodLabel } from "./fundamentals"
import type { Currency } from "./market"

/**
 * Valuation: what the market is paying for what the company reported.
 *
 * Every figure here is a **price divided by a fundamental**, which makes two things true and both
 * matter:
 *
 * 1. **A valuation multiple has a period attached.** "P/E" is not a number — "P/E (TTM)" and
 *    "P/E (FY2025)" are different numbers, and a screen that shows one labelled as the other is
 *    misleading in a way nobody checks. Every result here carries its period.
 * 2. **A negative denominator makes the multiple meaningless, not negative.** A loss-making company
 *    does not have a P/E of −14; it has no P/E. Reporting the negative number invites sorting a
 *    screener by it and finding the least profitable companies at the top.
 *
 * **Forward multiples are never computed.** They need a forward estimate, and Stockly has no
 * provider that supplies a defensible one — so `forwardPE` does not exist as a field rather than
 * existing and being null, because the strongest way to guarantee a number is never invented is to
 * have nowhere to put it.
 *
 * Pure: no client, no network, no framework import.
 */

export type ValuationInputs = {
  /** Current share price, in the currency the shares trade in. */
  price: number | null
  /** Shares outstanding, for the market capitalisation. */
  sharesOutstanding: number | null
  /** The statement the multiples are measured against. Its period labels every result. */
  statement: FinancialStatement | null
  /** Trailing twelve-month dividends per share, for the yield. */
  dividendPerShare: number | null
  /**
   * The currency the price is quoted in.
   *
   * Compared against the statement's reporting currency: a company that reports in one currency and
   * trades in another produces multiples that are silently an exchange rate, and this is where that
   * is caught.
   */
  priceCurrency: Currency
}

export type Valuation = {
  period: FiscalPeriod | null
  periodLabel: string | null
  marketCap: number | null
  enterpriseValue: number | null

  priceToEarnings: number | null
  priceToSales: number | null
  priceToBook: number | null
  priceToFreeCashFlow: number | null
  evToEbitda: number | null
  evToSales: number | null

  /** The inverse of P/E, which stays meaningful where P/E does not. */
  earningsYield: number | null
  freeCashFlowYield: number | null
  dividendYield: number | null

  /** Set when nothing could be computed, so the UI explains rather than showing a wall of N/A. */
  unavailableReason: string | null
  /** Set when price and reporting currency differ — every multiple then embeds an exchange rate. */
  currencyMismatch: { price: Currency; reporting: Currency } | null
}

const EMPTY: Omit<Valuation, "unavailableReason" | "currencyMismatch" | "period" | "periodLabel"> = {
  marketCap: null,
  enterpriseValue: null,
  priceToEarnings: null,
  priceToSales: null,
  priceToBook: null,
  priceToFreeCashFlow: null,
  evToEbitda: null,
  evToSales: null,
  earningsYield: null,
  freeCashFlowYield: null,
  dividendYield: null,
}

/**
 * A multiple, or null when the denominator is not positive.
 *
 * The rule that keeps a screener honest: a company losing money has **no** price-to-earnings ratio.
 * Returning −14 would let "P/E < 10" match every loss-making company in the market.
 */
function multiple(price: number | null, perShare: number | null): number | null {
  if (price === null || perShare === null) return null
  if (!Number.isFinite(price) || !Number.isFinite(perShare)) return null
  if (perShare <= 0) return null
  return price / perShare
}

/** Same rule against a whole-company figure rather than a per-share one. */
function companyMultiple(value: number | null, fundamental: number | null): number | null {
  if (value === null || fundamental === null) return null
  if (!Number.isFinite(value) || !Number.isFinite(fundamental)) return null
  if (fundamental <= 0) return null
  return value / fundamental
}

export function computeValuation(inputs: ValuationInputs): Valuation {
  const { price, statement, sharesOutstanding } = inputs

  if (statement === null) {
    return {
      ...EMPTY,
      period: null,
      periodLabel: null,
      unavailableReason: "No financial statements are available for this instrument.",
      currencyMismatch: null,
    }
  }
  if (price === null) {
    return {
      ...EMPTY,
      period: statement.period,
      periodLabel: periodLabel(statement.period),
      unavailableReason: "No current price is available, so nothing can be measured against it.",
      currencyMismatch: null,
    }
  }

  /*
   * A company reporting in one currency and trading in another.
   *
   * Every multiple below would then be a price in one currency over a fundamental in another —
   * a number that is mostly an exchange rate. Translating needs the rate on the statement's period
   * end, which Stockly does not store (see docs/fx-attribution.md), so the honest answer is to
   * report the mismatch and compute nothing.
   */
  if (statement.currency !== inputs.priceCurrency) {
    return {
      ...EMPTY,
      period: statement.period,
      periodLabel: periodLabel(statement.period),
      unavailableReason: `The shares trade in ${inputs.priceCurrency} and the company reports in ${statement.currency}. Comparing them needs an exchange rate for the reporting date, which Stockly does not store.`,
      currencyMismatch: { price: inputs.priceCurrency, reporting: statement.currency },
    }
  }

  const { income, balance, cashFlow } = statement

  const marketCap =
    sharesOutstanding !== null && Number.isFinite(sharesOutstanding) && sharesOutstanding > 0
      ? price * sharesOutstanding
      : null

  const capex = cashFlow.capitalExpenditure === null ? null : Math.abs(cashFlow.capitalExpenditure)
  const freeCashFlow =
    cashFlow.operatingCashFlow === null || capex === null ? null : cashFlow.operatingCashFlow - capex

  /*
   * Enterprise value = market cap + debt − cash.
   *
   * Null unless all three are present. A partial EV — market cap plus debt, with cash missing —
   * overstates the figure and there is no way for a reader to tell.
   */
  const enterpriseValue =
    marketCap === null || balance.totalDebt === null || balance.cashAndEquivalents === null
      ? null
      : marketCap + balance.totalDebt - balance.cashAndEquivalents

  const bookValuePerShare =
    sharesOutstanding !== null && sharesOutstanding > 0 && balance.totalEquity !== null
      ? balance.totalEquity / sharesOutstanding
      : null

  const salesPerShare =
    sharesOutstanding !== null && sharesOutstanding > 0 && income.revenue !== null
      ? income.revenue / sharesOutstanding
      : null

  const fcfPerShare =
    sharesOutstanding !== null && sharesOutstanding > 0 && freeCashFlow !== null
      ? freeCashFlow / sharesOutstanding
      : null

  const priceToEarnings = multiple(price, income.epsDiluted ?? income.eps)

  return {
    period: statement.period,
    periodLabel: periodLabel(statement.period),
    marketCap,
    enterpriseValue,
    priceToEarnings,
    priceToSales: multiple(price, salesPerShare),
    priceToBook: multiple(price, bookValuePerShare),
    priceToFreeCashFlow: multiple(price, fcfPerShare),
    evToEbitda: companyMultiple(enterpriseValue, income.ebitda),
    evToSales: companyMultiple(enterpriseValue, income.revenue),
    /*
     * Earnings yield is the inverse of P/E and **stays meaningful where P/E does not**: a company
     * losing money has a negative earnings yield, which is a true and readable statement, whereas a
     * negative P/E is a number nobody can interpret.
     */
    earningsYield: ratio(income.epsDiluted ?? income.eps, price) === null ? null : ratio(income.epsDiluted ?? income.eps, price)! * 100,
    freeCashFlowYield: fcfPerShare === null ? null : (fcfPerShare / price) * 100,
    dividendYield:
      inputs.dividendPerShare === null ? null : (inputs.dividendPerShare / price) * 100,
    unavailableReason: null,
    currencyMismatch: null,
  }
}

// ---------------------------------------------------------------- historical context

/**
 * The fewest observations a historical range is worth reporting from.
 *
 * A "5-year median P/E" computed from three readings is not a median of anything, and presenting
 * one invites a comparison that reads as authoritative and is noise.
 */
export const MIN_VALUATION_HISTORY = 8

export type ValuationContext = {
  current: number | null
  median: number | null
  low: number | null
  high: number | null
  observations: number
  /** Percentage points above or below the median. Null when either side is missing. */
  vsMedianPct: number | null
  /** A factual sentence, never a judgement. */
  description: string | null
}

/**
 * Where a current multiple sits against its own history.
 *
 * The wording matters more than the arithmetic here. "Current P/E is below its five-year median" is
 * a fact about two numbers. "The stock is undervalued" is a conclusion that requires knowing why
 * the multiple moved — whether earnings collapsed, whether the business changed — and Stockly does
 * not know that. `valuation.test.ts` holds these sentences to the insights engine's forbidden
 * vocabulary.
 */
export function valuationContext(
  current: number | null,
  history: readonly (number | null)[],
  label: string,
): ValuationContext {
  const usable = history.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)

  if (usable.length < MIN_VALUATION_HISTORY) {
    return {
      current,
      median: null,
      low: null,
      high: null,
      observations: usable.length,
      vsMedianPct: null,
      description: null,
    }
  }

  const sorted = [...usable].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]

  const vsMedianPct = current === null || median === 0 ? null : ((current - median) / median) * 100

  return {
    current,
    median,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    observations: usable.length,
    vsMedianPct,
    description:
      current === null || vsMedianPct === null
        ? null
        : `Current ${label} is ${Math.abs(vsMedianPct).toFixed(0)}% ${
            vsMedianPct >= 0 ? "above" : "below"
          } its median of ${median.toFixed(1)} over ${usable.length} periods.`,
  }
}

/**
 * The disclaimer every valuation screen carries.
 *
 * Explicit about the thing a valuation screen most invites a reader to assume.
 */
export const VALUATION_DISCLAIMER =
  "Valuation multiples describe what the market currently pays for reported figures. A low or high " +
  "multiple is a comparison, not a judgement about whether an investment is worthwhile."
