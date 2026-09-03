import type { Metadata } from "next"
import { PaginationNav } from "@/components/pagination-nav"
import { TransactionList } from "@/features/transactions/components/transaction-list"
import { listTransactionsPage } from "@/features/transactions/queries"
import { sellReviewsByTransaction } from "@/features/journal/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("transactions") }
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; page?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const { p, page: pageParam } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  // One page at a time: the holdings engine reads the full history separately, on the pages that
  // need it, so a thousand-row portfolio never ships a thousand rows to the browser.
  //
  // Sell reviews come back in one query for the whole portfolio rather than one per row — the N+1
  // this would otherwise be is exactly the shape phase 8 went hunting for.
  const [pageResult, sellReviews] = await Promise.all([
    listTransactionsPage(active.id, toPage(pageParam)),
    sellReviewsByTransaction(active.id).catch(() => new Map()),
  ])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("transactions")}</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <TransactionList
        transactions={pageResult.rows}
        portfolioId={active.id}
        sellReviews={Object.fromEntries(sellReviews)}
      />

      <PaginationNav
        page={pageResult.page}
        pageCount={pageResult.pageCount}
        total={pageResult.total}
        baseParams={{ p: active.id }}
        label="transactions"
      />
    </div>
  )
}
