import type { Metadata } from "next"
import { PaginationNav } from "@/components/pagination-nav"
import { TransactionList } from "@/features/transactions/components/transaction-list"
import { listTransactionsPage } from "@/features/transactions/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Transactions" }

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; page?: string }>
}) {
  const { p, page: pageParam } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  // One page at a time: the holdings engine reads the full history separately, on the pages that
  // need it, so a thousand-row portfolio never ships a thousand rows to the browser.
  const pageResult = await listTransactionsPage(active.id, toPage(pageParam))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Transactions</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <TransactionList
        transactions={pageResult.rows}
        portfolioId={active.id}
        currency={active.currency}
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
