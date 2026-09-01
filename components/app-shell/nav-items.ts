import { ArrowLeftRight, BarChart3, Eye, LayoutDashboard, Settings, Wallet } from "lucide-react"

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, mobile: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, mobile: true },
  { href: "/watchlist", label: "Watchlist", icon: Eye, mobile: false },
  { href: "/analytics", label: "Analytics", icon: BarChart3, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
] as const
