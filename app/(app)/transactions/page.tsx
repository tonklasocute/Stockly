import type { Metadata } from "next"
import { TransactionList } from "@/features/transactions/components/transaction-list"
import { listTransactions } from "@/features/transactions/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Transactions" }

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const transactions = await listTransactions(active.id)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Transactions</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <TransactionList
        transactions={transactions}
        portfolioId={active.id}
        currency={active.currency}
      />
    </div>
  )
}
