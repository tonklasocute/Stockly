import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { AuthForm } from "@/features/auth/components/auth-form"

export const metadata: Metadata = { title: "Sign in" }

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground text-sm">Sign in to your portfolio.</p>
      </div>
      {/* useSearchParams reads ?next=, which forces a client bailout during prerender. */}
      <Suspense fallback={<div className="h-[17.5rem]" />}>
        <AuthForm mode="login" />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        No account yet?{" "}
        <Link href="/register" className="text-foreground font-medium underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  )
}
