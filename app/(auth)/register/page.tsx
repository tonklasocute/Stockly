import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { AuthForm } from "@/features/auth/components/auth-form"

export const metadata: Metadata = { title: "Create account" }

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground text-sm">Start tracking your holdings in a minute.</p>
      </div>
      {/* useSearchParams reads ?next=, which forces a client bailout during prerender. */}
      <Suspense fallback={<div className="h-[17.5rem]" />}>
        <AuthForm mode="register" />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
