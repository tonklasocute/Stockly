import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  ClipboardCheck,
  Coins,
  Eye,
  FileUp,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  Share2,
  ShieldCheck,
  History,
  Newspaper,
  Scale,
  Sparkles,
  Target,
  Telescope,
  Wallet,
} from "lucide-react"

/**
 * `mobile: true` promotes an item to the bottom tab bar, which fits exactly four before the labels
 * start truncating. Everything else stays one tap away in the menu.
 *
 * `badge` names the counter the shell should render beside it, if any.
 *
 * `label` is a **key into the `navigation` namespace**, not a word. This module is imported by both
 * navigation components and has no translator of its own; keeping the key here and resolving it at
 * the render site is what lets one list drive a sidebar, a sheet and a tab bar in two languages.
 * The completeness test requires every one of these keys in both files, so a nav item added without
 * a Thai label fails the suite rather than shipping in English.
 */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "dashboard", icon: LayoutDashboard, mobile: true, badge: null },
  { href: "/portfolio", label: "portfolio", icon: Wallet, mobile: true, badge: null },
  { href: "/transactions", label: "transactions", icon: ArrowLeftRight, mobile: true, badge: null },
  { href: "/notifications", label: "notifications", icon: Bell, mobile: true, badge: "unread" },
  { href: "/ai", label: "ai", icon: Sparkles, mobile: false, badge: null },
  { href: "/analytics", label: "analytics", icon: BarChart3, mobile: false, badge: null },
  // Phase 16. Sits beside analytics: both answer "how did this do", one for now and one over time.
  { href: "/portfolio/history", label: "history", icon: History, mobile: false, badge: null },
  // Phase 10. All three stay off the bottom bar: it fits exactly four before the labels truncate,
  // and a review is something you sit down to, not something you tap between screens.
  { href: "/review", label: "review", icon: ClipboardCheck, mobile: false, badge: null },
  { href: "/goals", label: "goals", icon: Target, mobile: false, badge: null },
  // Phase 11. Planning is somewhere you sit down with a set of assumptions, not a screen you tap
  // between — so it stays off the four-item bottom bar like the rest of the analysis pages.
  { href: "/simulations", label: "planning", icon: Calculator, mobile: false, badge: null },
  { href: "/journal", label: "journal", icon: BookOpen, mobile: false, badge: null },
  // Phase 12. Import is something you do occasionally with a file in hand, and data quality is
  // somewhere you go when a figure reads N/A — neither belongs on the four-item bottom bar.
  { href: "/imports", label: "import", icon: FileUp, mobile: false, badge: null },
  { href: "/data-quality", label: "dataQuality", icon: ShieldCheck, mobile: false, badge: null },
  // Phase 19. Beside import and data quality — the three places you go when you are checking
  // records rather than reading numbers. Reconciliation is a sit-down task, not a tab.
  { href: "/operations", label: "reconciliation", icon: Scale, mobile: false, badge: null },
  // Phase 13. Sharing is a settings-shaped decision made once and revisited rarely, so it sits
  // beside the other configuration rather than on the bottom bar.
  { href: "/sharing", label: "sharing", icon: Share2, mobile: false, badge: null },
  { href: "/alerts", label: "alerts", icon: Bell, mobile: false, badge: null },
  { href: "/screener", label: "screener", icon: Telescope, mobile: false, badge: null },
  { href: "/dividends", label: "dividends", icon: Coins, mobile: false, badge: null },
  { href: "/cash", label: "cash", icon: Banknote, mobile: false, badge: null },
  // Phase 18. Context around holdings, not a feed to browse — so it sits with the analysis pages
  // rather than on the four-item bottom bar.
  { href: "/news", label: "news", icon: Newspaper, mobile: false, badge: null },
  { href: "/watchlist", label: "watchlist", icon: Eye, mobile: false, badge: null },
  // Phase 15. Beside Settings rather than on the bottom bar: personalization is something you
  // configure once and revisit rarely, and the bar fits exactly four before labels truncate.
  { href: "/settings/preferences", label: "preferences", icon: SlidersHorizontal, mobile: false, badge: null },
  { href: "/settings", label: "settings", icon: Settings, mobile: false, badge: null },
] as const
