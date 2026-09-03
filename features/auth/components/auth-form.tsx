"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { credentialsSchema, type Credentials } from "../schema"
import { useTranslations } from "next-intl"

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const t = useTranslations("auth")
  const router = useRouter()
  const searchParams = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const [checkYourEmail, setCheckYourEmail] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) })

  async function onSubmit(values: Credentials) {
    setFormError(null)
    const supabase = createClient()

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword(values)
      // Deliberately vague: a precise message tells an attacker which emails are registered.
      if (error) return setFormError("Incorrect email or password.")
    } else {
      const { data, error } = await supabase.auth.signUp(values)
      if (error) return setFormError(error.message)
      // Email confirmation on: there is no session yet, so tell the user rather than redirecting.
      if (!data.session) return setCheckYourEmail(true)
    }

    const next = searchParams.get("next")
    router.replace(next?.startsWith("/") ? next : "/dashboard")
    router.refresh()
  }

  if (checkYourEmail) {
    return (
      <Alert>
        <AlertDescription>{t("confirmEmail")}</AlertDescription>
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
        {errors.email && (
          <p id="email-error" className="text-destructive text-sm">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        {errors.password && (
          <p id="password-error" className="text-destructive text-sm">
            {errors.password.message}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full max-sm:h-11" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  )
}
