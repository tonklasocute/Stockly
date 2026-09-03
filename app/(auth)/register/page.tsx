import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { AuthForm } from "@/features/auth/components/auth-form"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.createAccount") }
}

export default async function RegisterPage() {
  const t = await getTranslations("auth")
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">{t("signUp")}</h1>
        <p className="text-muted-foreground text-sm">{t("signUpHint")}</p>
      </div>
      {/* useSearchParams reads ?next=, which forces a client bailout during prerender. */}
      <Suspense fallback={<div className="h-[17.5rem]" />}>
        <AuthForm mode="register" />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">{t("signIn")}</Link>
      </p>
    </div>
  )
}
