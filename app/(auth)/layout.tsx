import Link from "next/link"
import { getTranslations } from "next-intl/server"

/**
 * Rendered per request, not prerendered.
 *
 * The Content-Security-Policy is nonce-based, and a nonce can only be stamped onto HTML that is
 * generated for the request that carries it. A build-time page ships without one, so every inline
 * script in it is blocked and the page never hydrates. These are two small server-rendered forms;
 * the cost of rendering them per request is nothing, and it is what keeps the policy enforceable.
 */
export const dynamic = "force-dynamic"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("legal")

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-8">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-lg text-sm font-bold">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight">Stockly</span>
        </Link>
        {children}

        <nav className="text-muted-foreground flex justify-center gap-4 text-xs">
          <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
            {t("nav.terms")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
            {t("nav.privacy")}
          </Link>
          <Link href="/disclaimer" className="hover:text-foreground underline-offset-4 hover:underline">
            {t("nav.disclaimer")}
          </Link>
        </nav>
      </div>
    </main>
  )
}
