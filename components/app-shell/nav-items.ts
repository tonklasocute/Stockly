import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  Coins,
  Eye,
  LayoutDashboard,
  Settings,
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
  { href: "/analytics", label: "Analytics", icon: BarChart3, mobile: false, badge: null },
  { href: "/alerts", label: "Alerts", icon: Bell, mobile: false, badge: null },
  { href: "/screener", label: "Screener", icon: Telescope, mobile: false, badge: null },
  { href: "/dividends", label: "Dividends", icon: Coins, mobile: false, badge: null },
  { href: "/cash", label: "Cash", icon: Banknote, mobile: false, badge: null },
  { href: "/watchlist", label: "Watchlist", icon: Eye, mobile: false, badge: null },
  { href: "/settings", label: "Settings", icon: Settings, mobile: false, badge: null },
] as const
