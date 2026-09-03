"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MarketId } from "@/domain/market"
import { JOURNAL_LABELS, SELL_REASON_LABELS } from "@/domain/research"
import { formatDate } from "@/lib/format"
import type { JournalRow } from "@/types/database"
import { JournalDialog } from "./journal-dialog"
import { useAppLocale } from "@/lib/i18n/locale"

/**
 * The last few journal entries for one instrument, with a way to add another.
 *
 * Capped at what the query returns rather than paginated here: the full timeline is a page of its
 * own, and a position page that scrolls through two years of notes is not a position page.
 */
export function PositionJournal({
  portfolioId,
  symbol,
  market,
  entries,
}: {
  portfolioId: string
  symbol: string
  market: MarketId
  entries: JournalRow[]
}) {
  const locale = useAppLocale()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing written about {symbol} yet.
        </p>
      ) : (
        <ol className="divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{entry.title}</span>
                <time className="text-muted-foreground text-xs" dateTime={entry.entry_date}>
                  {formatDate(entry.entry_date, locale)}
                </time>
              </div>
              <p className="text-muted-foreground text-xs">
                {JOURNAL_LABELS[entry.type]}
                {entry.reason ? ` · ${SELL_REASON_LABELS[entry.reason]}` : ""}
              </p>
              {/* Plain text: rendered as a React text node, never parsed as markup. */}
              {entry.content && (
                <p className="text-muted-foreground text-sm whitespace-pre-wrap">{entry.content}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          Add entry
        </Button>
        {entries.length > 0 && (
          <Link
            href={`/journal?p=${portfolioId}&symbol=${symbol}&market=${market}`}
            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            See the full journal
          </Link>
        )}
      </div>

      <JournalDialog
        open={open}
        onOpenChange={setOpen}
        portfolioId={portfolioId}
        defaults={{ symbol, market, type: "POSITION_REVIEW", title: `${symbol} review` }}
      />
    </div>
  )
}
