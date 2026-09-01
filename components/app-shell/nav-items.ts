import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Coins,
  Eye,
  LayoutDashboard,
  Settings,
  Wallet,
} from "lucide-react"

/**
 * `mobile: true` promotes an item to the bottom tab bar, which fits exactly four before the labels
 * start truncating. Everything else stays one tap away in the menu.
 */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, mobile: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, mobile: true },
  { href: "/analytics", label: "Analytics", icon: BarChart3, mobile: true },
  { href: "/dividends", label: "Dividends", icon: Coins, mobile: false },
  { href: "/cash", label: "Cash", icon: Banknote, mobile: false },
  { href: "/watchlist", label: "Watchlist", icon: Eye, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: false },
] as const
