import type { EventDescription } from "@/domain/corporate-events"

/**
 * The facts become a sentence here, and in one place.
 *
 * `domain/corporate-events.ts` reports what an event *is*; this decides how to say it. Two
 * components render the same sentence — the dashboard widget and the stock page panel — and a
 * second copy of this composition is how they would come to disagree.
 *
 * `kind` is the event type's own name from the `enums` namespace, so "share split" and
 * "การแตกพาร์" both land in a sentence built for their own grammar rather than in an English
 * skeleton.
 */
export function eventSentence(
  facts: EventDescription,
  t: (key: string, values?: Record<string, string | number>) => string,
  kind: string,
): string {
  const when = facts.date === null ? t("events.dateUnannounced") : t("events.onDate", { date: facts.date })
  const qualifier = facts.estimated ? t("events.estimated") : ""

  return t(`events.${facts.shape}`, {
    symbol: facts.symbol,
    when,
    qualifier,
    kind,
    ratio: facts.ratio ?? "",
    amount: facts.amountPerShare ?? "",
    currency: facts.currency ?? "",
  })
}
