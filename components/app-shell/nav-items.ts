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
  LayoutDashboard,
  Settings,
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
 */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true, badge: null },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, mobile: true, badge: null },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, mobile: true, badge: null },
  { href: "/notifications", label: "Notifications", icon: Bell, mobile: true, badge: "unread" },
  { href: "/ai", label: "Stockly AI", icon: Sparkles, mobile: false, badge: null },
  { href: "/analytics", label: "Analytics", icon: BarChart3, mobile: false, badge: null },
  // Phase 10. All three stay off the bottom bar: it fits exactly four before the labels truncate,
  // and a review is something you sit down to, not something you tap between screens.
  { href: "/review", label: "Review", icon: ClipboardCheck, mobile: false, badge: null },
  { href: "/goals", label: "Goals", icon: Target, mobile: false, badge: null },
  // Phase 11. Planning is somewhere you sit down with a set of assumptions, not a screen you tap
  // between — so it stays off the four-item bottom bar like the rest of the analysis pages.
  { href: "/simulations", label: "Planning", icon: Calculator, mobile: false, badge: null },
  { href: "/journal", label: "Journal", icon: BookOpen, mobile: false, badge: null },
  { href: "/alerts", label: "Alerts", icon: Bell, mobile: false, badge: null },
  { href: "/screener", label: "Screener", icon: Telescope, mobile: false, badge: null },
  { href: "/dividends", label: "Dividends", icon: Coins, mobile: false, badge: null },
  { href: "/cash", label: "Cash", icon: Banknote, mobile: false, badge: null },
  { href: "/watchlist", label: "Watchlist", icon: Eye, mobile: false, badge: null },
  { href: "/settings", label: "Settings", icon: Settings, mobile: false, badge: null },
] as const
