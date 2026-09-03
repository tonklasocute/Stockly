import type { AlertDescription } from "@/domain/alerts"

/**
 * The one-line description of a rule, composed where there is a reader.
 *
 * `domain/alerts.ts` states the shape — which instrument, which condition, which threshold — and
 * this turns it into a line. A portfolio-wide rule has no subject in the data, so the word for
 * "Portfolio" is chosen here rather than baked into the engine, and `DIVIDEND_RECEIVED` gets its
 * own sentence because it is the one rule with no threshold to state.
 */
export function alertSentence(
  facts: AlertDescription,
  t: (key: string, values?: Record<string, string | number>) => string,
  condition: string,
): string {
  if (facts.type === "DIVIDEND_RECEIVED") return t("describe.anyDividend")

  const subject = facts.subject ?? t("describe.portfolio")
  return facts.target
    ? t("describe.withTarget", { subject, condition, target: facts.target })
    : t("describe.withoutTarget", { subject, condition })
}
