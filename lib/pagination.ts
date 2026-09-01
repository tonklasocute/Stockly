export const PAGE_SIZE = 25

export type Page<T> = {
  rows: T[]
  page: number
  pageSize: number
  total: number
  pageCount: number
}

/** Clamps a page number from a URL to something a query can safely use. */
export function toPage(value: string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

/** Inclusive Postgres range for a page — what `.range()` expects. */
export function pageRange(page: number, pageSize = PAGE_SIZE): { from: number; to: number } {
  const from = (page - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

export function toPageResult<T>(
  rows: T[],
  total: number,
  page: number,
  pageSize = PAGE_SIZE,
): Page<T> {
  return { rows, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}
