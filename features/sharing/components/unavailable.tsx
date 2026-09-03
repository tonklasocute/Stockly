import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { DEFAULT_LOCALE, type Locale } from "@/domain/locale"

/**
 * Every way a shared page can fail to open.
 *
 * The reasons are separate sentences because a person who was given a link deserves to know
 * whether to ask for a new one — but they are only ever chosen by the **route**, never by what the
 * database found. A wrong token, a revoked token and a token for a portfolio that was made private
 * all return the same nothing from `features/sharing/public.ts`, so the page cannot accidentally
 * confirm which one it was.
 *
 * The `locale` prop follows the same rule as `PublicPortfolioView`: the reader is not the owner,
 * so the language comes from `?lang=` and not from whoever's cookie happens to be present. It has
 * a default because two of the three call sites reach here before a locale has been resolved.
 */
export const UNAVAILABLE_REASONS = ["PRIVATE", "LINK", "SNAPSHOT"] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

export async function Unavailable({
  reason,
  locale = DEFAULT_LOCALE,
}: {
  reason: UnavailableReason
  locale?: Locale
}) {
  const t = await getTranslations({ locale, namespace: "sharing" })

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-5 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{t(`unavailable.${reason}.title`)}</h1>
      <p className="text-muted-foreground text-sm">{t(`unavailable.${reason}.detail`)}</p>
      <p className="text-muted-foreground pt-2 text-sm">
        <Link href="/" className="underline-offset-4 hover:underline">
          Stockly
        </Link>
      </p>
    </div>
  )
}
