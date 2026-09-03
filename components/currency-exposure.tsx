import { Alert, AlertDescription } from "@/components/ui/alert"
import { FxNote } from "@/components/market-badge"
import type { PortfolioSummary } from "@/domain/types"
import { formatCurrency, formatOptionalCurrency, formatOptionalPercent } from "@/lib/format"

/**
 * What a mixed-currency portfolio is actually exposed to.
 *
 * Rendered only when there is more than one currency in it — a US-only portfolio gains nothing from
 * a panel saying "USD: 100%", and phase 9 is not licence to clutter a page that was fine.
 *
 * Both figures are shown for each currency: the real amount in the currency it is held in, and what
 * that comes to in the base currency at today's rate, with the rate itself beside it. A converted
 * number with no rate attached is one the user cannot check.
 */
export async function CurrencyExposure({
  summary,
  className,
}: {
  summary: PortfolioSummary
  className?: string
}) {
  if (summary.exposures.length <= 1) return null

  return (
    <section className={className}>
      <h2 className="mb-3 text-sm font-semibold">
        Currency exposure{" "}
        <span className="text-muted-foreground font-normal">
          · shown in {summary.currency}
        </span>
      </h2>
      <ul className="bg-border grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2">
        {summary.exposures.map((exposure) => (
          <li key={exposure.currency} className="bg-card space-y-1 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{exposure.currency}</span>
              <span className="text-muted-foreground tabular text-xs">
                {formatOptionalPercent(exposure.weight, { signed: false })}
              </span>
            </div>
            <p className="tabular font-semibold">
              {formatCurrency(exposure.nativeValue, exposure.currency)}
            </p>
            {exposure.currency !== summary.currency && (
              <p className="text-muted-foreground tabular text-xs">
                ≈ {formatOptionalCurrency(exposure.baseValue, summary.currency)}
              </p>
            )}
            <FxNote from={exposure.currency} to={summary.currency} fx={exposure.fx} />
            <p className="text-muted-foreground text-xs">
              {exposure.holdings} holding{exposure.holdings === 1 ? "" : "s"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Says out loud when a total is incomplete or translated at a delayed rate.
 *
 * The rule this enforces: a figure that had to leave something out must say what it left out.
 * `untranslatedCount` holdings are missing from every total on the page — not worth zero, missing —
 * and a page that quietly under-reported them would be the exact fabricated-confidence failure the
 * null-over-zero rule exists to prevent.
 */
export function CurrencyNotice({
  summary,
  missingFxPairs = [],
}: {
  summary: PortfolioSummary
  missingFxPairs?: readonly string[]
}) {
  if (summary.untranslatedCount === 0 && summary.fxStaleCount === 0) return null

  return (
    <Alert>
      <AlertDescription>
        {summary.untranslatedCount > 0 && (
          <>
            No exchange rate for {missingFxPairs.length > 0 ? missingFxPairs.join(", ") : "one or more currencies"}
            , so {summary.untranslatedCount} holding{summary.untranslatedCount === 1 ? " is" : "s are"}{" "}
            shown as N/A and left out of the totals below.{" "}
          </>
        )}
        {summary.fxStaleCount > 0 && (
          <>
            {summary.fxStaleCount} holding{summary.fxStaleCount === 1 ? " was" : "s were"} converted at
            a rate over an hour old.
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}

/**
 * The one-line disclosure that belongs under any total built from more than one currency: these
 * figures are a translation at today's rate, not a record of what the money was worth when it was
 * spent. Stockly stores no historical rates, which is also why `summary.fxEffect` is null.
 */
export function TranslationNote({ summary }: { summary: PortfolioSummary }) {
  const translated = summary.exposures.some((e) => e.fx && !e.fx.identity)
  if (!translated) return null

  return (
    <p className="text-muted-foreground text-xs">
      Figures in {summary.currency} are translated at today&apos;s exchange rate. Stockly does not
      store past rates, so currency movement is not separated from stock performance.
    </p>
  )
}
