import Link from "next/link"
import { getTranslations } from "next-intl/server"

/**
 * The signed-out shell for the legal pages.
 *
 * Deliberately separate from the app shell: these have to render for someone who has no account,
 * and pulling in the portfolio switcher and the notification badge would mean a database query on
 * a page that needs none.
 */
export const dynamic = "force-dynamic"

/** `label` is a key into `legal.nav`. */
const LINKS = [
  { href: "/privacy", label: "privacy" },
  { href: "/terms", label: "terms" },
  { href: "/disclaimer", label: "disclaimer" },
] as const

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("legal")

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-md text-xs font-bold">
            S
          </span>
          <span className="font-semibold tracking-tight">Stockly</span>
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">{children}</main>

      <footer className="mx-auto w-full max-w-2xl px-5 py-8">
        <nav className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 border-t pt-6 text-sm">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground underline-offset-4 hover:underline">
              {t(`nav.${link.label}`)}
            </Link>
          ))}
          <Link href="/login" className="hover:text-foreground ml-auto underline-offset-4 hover:underline">
            {t("nav.signIn")}
          </Link>
        </nav>
      </footer>
    </div>
  )
}
