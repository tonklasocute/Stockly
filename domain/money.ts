/**
 * Money arithmetic without floating-point drift.
 *
 * The problem: `0.1 + 0.2 === 0.30000000000000004`. Summing a few hundred transaction amounts as
 * IEEE-754 doubles leaves dust in the low bits, and a portfolio total that renders as
 * `$12,340.000000000002` — or, worse, a realized P&L that is `-0.0000000001` instead of exactly 0 —
 * destroys trust in every other number on the page.
 *
 * The approach: storage is PostgreSQL `numeric(20,8)`, and every accumulation in the engine happens
 * over integers. A value is scaled to a whole number of micro-units, added as an integer, and scaled
 * back once at the end. No dependency, no rewrite of the calculation formulas — only the points
 * where values accumulate change.
 *
 * `ponytail:` ceiling — this is exact for the range a personal portfolio occupies (below ~$9 billion
 * at six decimal places). A system handling larger sums, or needing banker's rounding for tax
 * reporting, should move to decimal.js; every call site already goes through this module.
 */

/** Six decimal places: finer than any currency's minor unit, and safe to about $9,000,000,000. */
export const MONEY_SCALE = 1_000_000

/** Eight decimal places, matching `numeric(20,8)` — enough for fractional-share quantities. */
export const QUANTITY_SCALE = 100_000_000

/** Snaps a value to the scale grid, discarding the float dust an arithmetic chain leaves behind. */
export function quantize(value: number, scale: number = MONEY_SCALE): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * scale) / scale
}

/**
 * Sums over integers rather than doubles, so the error cannot compound across rows.
 * `sum([0.1, 0.2])` is exactly `0.3`, and a thousand additions of `0.01` is exactly `10`.
 */
export function sum(values: Iterable<number>, scale: number = MONEY_SCALE): number {
  let total = 0
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    total += Math.round(value * scale)
  }
  return total / scale
}

/** `sum` over a projection, so call sites do not build a throwaway array. */
export function sumBy<T>(
  items: Iterable<T>,
  select: (item: T) => number,
  scale: number = MONEY_SCALE,
): number {
  let total = 0
  for (const item of items) {
    const value = select(item)
    if (!Number.isFinite(value)) continue
    total += Math.round(value * scale)
  }
  return total / scale
}

export function add(a: number, b: number, scale: number = MONEY_SCALE): number {
  return sum([a, b], scale)
}

export function subtract(a: number, b: number, scale: number = MONEY_SCALE): number {
  return sum([a, -b], scale)
}

/** Multiplication quantized once at the end — quantity × price is the archetypal case. */
export function multiply(a: number, b: number, scale: number = MONEY_SCALE): number {
  return quantize(a * b, scale)
}

/** Division that returns 0 rather than Infinity or NaN when the denominator is 0. */
export function divide(a: number, b: number, scale: number = MONEY_SCALE): number {
  if (!b || !Number.isFinite(b)) return 0
  return quantize(a / b, scale)
}

/**
 * A percentage of a base, or null when the base is zero. Null rather than 0 because "no return
 * because nothing was invested" is not the same statement as "a return of zero".
 */
export function percentOf(part: number, base: number): number | null {
  if (!base || !Number.isFinite(base)) return null
  return quantize((part / base) * 100)
}

/** Rounds for display or for a stored aggregate. Half away from zero, so -0.5 becomes -1. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  return Math.sign(value) * (Math.round(Math.abs(value) * factor) / factor)
}
