import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Button } from "@/components/ui/button"

/** Per request, for the CSP nonce — see app/(auth)/layout.tsx. */
export const dynamic = "force-dynamic"

export default async function NotFound() {
  const t = await getTranslations("errors.notFound")
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground max-w-sm text-sm text-balance">{t("body")}</p>
      <Button nativeButton={false}
          render={<Link href="/dashboard" />} className="max-sm:h-11">
        {t("home")}
      </Button>
    </main>
  )
}
