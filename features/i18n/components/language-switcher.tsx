"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Languages } from "lucide-react"
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
import { LOCALE_META, SUPPORTED_LOCALES, type Locale } from "@/domain/locale"
import { useAppLocale } from "@/lib/i18n/locale"
import { rememberLocale } from "../set-locale"

/**
 * Changing the language, without losing the page.
 *
 * `router.refresh()` rather than a reload or a navigation. It re-renders the current route on the
 * server with the new cookie and reconciles the result into the existing React tree, so the URL,
 * the query string, the scroll position, the open dialog, the React Query cache and any half-filled
 * form all survive. A `location.reload()` would take every one of them with it — and in a PWA it
 * would also throw away the running document, which is the thing the user installed.
 *
 * Every label is written in its own language, and stays that way in both. Somebody who has landed
 * in a script they cannot read must still be able to find the way back, and "ภาษาอังกฤษ" does not
 * help them do that.
 */
export function LanguageSwitcher({
  signedIn,
  label,
  className,
}: {
  /** Whether to also persist the choice to the user's preference row. */
  signedIn: boolean
  /** The menu heading — "Language" / "ภาษา" — supplied by the caller that has a translator. */
  label: string
  className?: string
}) {
  const active = useAppLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function choose(locale: Locale) {
    if (locale === active) return
    rememberLocale(locale, { signedIn })
    startTransition(() => router.refresh())
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={className}
            /*
             * The label names the control, not its state. It is written in both languages so it is
             * useful to a screen reader in either — the one place in the application where mixing
             * them is the accessible choice rather than a leak.
             */
            aria-label="เปลี่ยนภาษา / Change language"
            disabled={pending}
          />
        }
      >
        <Languages className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/*
          The group is not decoration. `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which
          reads the group's context to associate itself with the items it names — outside one it
          throws rather than degrading, and it is what gives a screen reader "Language, list, 2
          items" instead of two unattached options.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuItem
              key={locale}
              className="gap-2"
              onSelect={() => choose(locale)}
              aria-current={locale === active ? "true" : undefined}
              lang={locale}
            >
              <Check
                className={locale === active ? "size-4" : "size-4 opacity-0"}
                aria-hidden
              />
              <span className="flex-1">{LOCALE_META[locale].label}</span>
              <span className="text-muted-foreground text-xs">{LOCALE_META[locale].short}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
