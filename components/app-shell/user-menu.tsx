"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { Loader2, LogOut, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { clearServiceWorkerCaches } from "@/features/pwa/components/service-worker"
import { clearInstallDismissal } from "@/features/pwa/use-pwa"

export function UserMenu({ email }: { email: string }) {
  const t = useTranslations("navigation")
  const router = useRouter()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)

  /**
   * Signing out clears everything this device holds for the user before the session ends.
   *
   * No authenticated response is ever written to the service worker cache, so this is
   * belt-and-braces — but on a shared device the cost of being wrong is another person's portfolio,
   * and the cost of being careful is three lines.
   */
  async function signOut() {
    setSigningOut(true)
    queryClient.clear()
    await clearServiceWorkerCaches()
    clearInstallDismissal()
    // A POST, so a prefetch or a crawler can never sign the user out.
    await fetch("/auth/signout", { method: "POST" })
    router.replace("/login")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("accountMenu")} />}>
        <User className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Same reason as the language switcher: `Menu.GroupLabel` requires a group context. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-normal">
            <span className="text-muted-foreground block text-xs">{t("signedInAs")}</span>
            <span className="truncate text-sm font-medium">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2"
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault()
            void signOut()
          }}
        >
          {signingOut ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogOut className="size-4" aria-hidden />
          )}
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
