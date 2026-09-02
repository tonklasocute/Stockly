/**
 * The review period.
 *
 * A separate module from `loader.ts` because the loader is `server-only` and the range tabs are a
 * client component — importing the list of ranges must not drag a Supabase client into the browser
 * bundle. Small, pure, and importable from either side.
 */
export const REVIEW_RANGES = ["1M", "3M", "6M", "YTD", "1Y", "MAX"] as const

export type ReviewRange = (typeof REVIEW_RANGES)[number]

export function toReviewRange(value: string | null | undefined): ReviewRange {
  return REVIEW_RANGES.includes(value as ReviewRange) ? (value as ReviewRange) : "1Y"
}
