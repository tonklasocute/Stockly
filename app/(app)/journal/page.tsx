import type { Metadata } from "next"
import { PaginationNav } from "@/components/pagination-nav"
import { JournalTimeline } from "@/features/journal/components/journal-timeline"
import { journalInstruments, listJournalPage } from "@/features/journal/queries"
import { journalFilterSchema } from "@/features/journal/schema"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("journal") }
}

type Props = {
  searchParams: Promise<{
    p?: string
    page?: string
    type?: string
    symbol?: string
    market?: string
    q?: string
  }>
}

export default async function JournalPage({ searchParams }: Props) {
  const tNav = await getTranslations("navigation")
  const query = await searchParams
  const { active } = await resolveActivePortfolio(query.p)
  if (!active) return <NoPortfolio />

  // Filters come from the URL and are validated like any other external input; an unusable one is
  // dropped rather than failing the page, because a bad query string should not lose the journal.
  const parsed = journalFilterSchema.safeParse({
    portfolioId: active.id,
    type: query.type,
    symbol: query.symbol,
    market: query.market,
    q: query.q,
  })
  const filter = parsed.success ? parsed.data : { portfolioId: active.id }

  const [page, instruments] = await Promise.all([
    listJournalPage(filter, toPage(query.page)),
    journalInstruments(active.id),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("journal")}</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · why you did what you did, kept beside the numbers
        </p>
      </div>

      <JournalTimeline
        portfolioId={active.id}
        entries={page.rows}
        instruments={instruments}
        total={page.total}
      />

      {page.pageCount > 1 && (
        <PaginationNav
          page={page.page}
          pageCount={page.pageCount}
          total={page.total}
          // Filters survive paging: without them page 2 of a filtered list is page 2 of everything.
          baseParams={{
            p: active.id,
            type: query.type,
            symbol: query.symbol,
            market: query.market,
            q: query.q,
          }}
          label="entries"
        />
      )}
    </div>
  )
}
