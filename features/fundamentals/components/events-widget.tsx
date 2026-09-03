import Link from "next/link"
import { CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { Section } from "@/components/metric"
import { describeEvent } from "@/domain/corporate-events"
import { eventSentence } from "../event-sentence"
import type { PortfolioEventsBundle } from "@/features/fundamentals/events-loader"
import { getTranslations } from "next-intl/server"

/**
 * Upcoming events for what the reader owns and watches.
 *
 * Ordered by relation before date — a held position's earnings outranks a watched one's on the same
 * day — because the point is not that an event exists but that it is attached to something the
 * reader has money in.
 *
 * Every sentence is `describeEvent`, which carries no portfolio figure: these also reach a lock
 * screen through push, and a lock screen is not a private surface.
 */
export async function EventsWidget({ data }: { data: PortfolioEventsBundle }) {
  const tEnum = await getTranslations("enums")
  const tf = await getTranslations("fundamentals")
  if (!data.covered) {
    return (
      <Section title={tf("events.title")}>
        <p className="text-muted-foreground text-sm">
          This deployment has no corporate events provider configured, so there is nothing to show.
          That is a limitation of Stockly&apos;s setup rather than a statement about your holdings.
        </p>
      </Section>
    )
  }

  if (data.events.length === 0) {
    return (
      <Section title={tf("events.title")}>
        <EmptyState
          icon={CalendarDays}
          title={tf("nothingScheduled")}
          description={tf("nothingScheduledBody")}
        />
      </Section>
    )
  }

  return (
    <Section
      title={tf("events.title")}
      description={tf("forHeldAndWatched")}
      action={
        <Link href="/watchlist" className="text-muted-foreground text-sm underline-offset-4 hover:underline">{tf("watchlist")}</Link>
      }
    >
      <ul className="divide-y">
        {data.events.map((event, index) => (
          <li
            key={`${event.market}:${event.symbol}:${event.type}:${event.date ?? index}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
          >
            <span className="min-w-0">
              <Link
                href={`/stocks/${event.symbol}?market=${event.market}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {event.symbol}
              </Link>
              <span className="text-muted-foreground ml-2">{eventSentence(describeEvent(event), tf, tEnum(`corporateEvent.${event.type}`))}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {/* Relation, not a figure: "held" says why this row is here without saying how much. */}
              <Badge variant={event.relation === "HELD" ? "outline" : "secondary"}>
                {event.relation === "HELD" ? "Held" : "Watching"}
              </Badge>
              {event.estimated && <Badge variant="secondary">{tf("estimated")}</Badge>}
              <span className="text-muted-foreground text-xs">{tEnum(`corporateEvent.${event.type}`)}</span>
            </span>
          </li>
        ))}
      </ul>
      {data.omitted > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          {data.omitted} further instrument{data.omitted === 1 ? "" : "s"} were not checked, to keep
          this page within the provider&apos;s request budget.
        </p>
      )}
    </Section>
  )
}
