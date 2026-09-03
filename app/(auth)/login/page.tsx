import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { AuthForm } from "@/features/auth/components/auth-form"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.signIn") }
}

export default async function LoginPage() {
  const t = await getTranslations("auth")
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t("welcomeBack")}</h1>
        <p className="text-muted-foreground text-sm">{t("signInHint")}</p>
      </div>
      {/* useSearchParams reads ?next=, which forces a client bailout during prerender. */}
      <Suspense fallback={<div className="h-[17.5rem]" />}>
        <AuthForm mode="login" />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        No account yet?{" "}
        <Link href="/register" className="text-foreground font-medium underline-offset-4 hover:underline">{t("createOne")}</Link>
      </p>
    </div>
  )
}
