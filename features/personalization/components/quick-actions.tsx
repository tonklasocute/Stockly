import Link from "next/link"
import { ArrowLeftRight, Banknote, Bell, Coins, Eye, FileUp } from "lucide-react"
import { getTranslations } from "next-intl/server"

/**
 * The things somebody opens Stockly to do.
 *
 * Links, not a floating action button. A FAB covers content and, on a phone, sits exactly where the
 * bottom tab bar already is — so this is a row that scrolls with the page and reaches the same
 * routes the navigation does. There is no new action here: every one of these is a screen that
 * already existed, given a shorter path to it.
 */
/** `label` is a key into the `personalization` namespace — the same pattern as `NAV_ITEMS`. */
const ACTIONS = [
  { href: "/transactions", label: "addTransaction", icon: ArrowLeftRight, portfolioScoped: true },
  { href: "/dividends", label: "addDividend", icon: Coins, portfolioScoped: true },
  { href: "/cash", label: "cash", icon: Banknote, portfolioScoped: true },
  { href: "/imports", label: "import", icon: FileUp, portfolioScoped: true },
  { href: "/alerts", label: "newAlert", icon: Bell, portfolioScoped: false },
  { href: "/watchlist", label: "watchlist", icon: Eye, portfolioScoped: false },
] as const

export async function QuickActions({ portfolioId }: { portfolioId: string }) {
  const t = await getTranslations("personalization")

  return (
    <nav aria-label={t("quickActions.title")}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ACTIONS.map(({ href, label, icon: Icon, portfolioScoped }) => (
          <li key={href}>
            <Link
              href={portfolioScoped ? `${href}?p=${portfolioId}` : href}
              // 44px whenever the pointer is coarse — a tablet is a touch device and a small desktop
              // window is not, so this keys off the pointer rather than a width breakpoint.
              className="bg-card hover:bg-muted/60 flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors pointer-coarse:min-h-16"
            >
              <Icon className="text-muted-foreground size-4" aria-hidden />
              <span className="text-xs font-medium">{t(`quickActions.${label}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
