"use client"

import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const t = useTranslations("settings")

  return (
    <Button
      variant="ghost"
      size="icon"
      /* A static label: the resolved theme is unknown on the server, and a label that changes
         after hydration is worse for a screen reader than one that always describes the action. */
      aria-label={t("theme.toggle")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Both icons are always rendered; CSS picks one, so server and client markup match. */}
      <Sun className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
    </Button>
  )
}
