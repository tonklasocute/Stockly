"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import type { NotificationPreferencesRow } from "@/types/database"
import { useTranslations } from "next-intl"

type Preferences = {
  price: boolean
  portfolio: boolean
  dividend: boolean
  system: boolean
  push: boolean
}

/** `key` is the preference column and, with a suffix, its label and hint in the namespace. */
const CATEGORIES = ["price", "portfolio", "dividend", "system"] as const

/** A switch with a visible on/off word — state never rests on colour or position alone. */
function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "inline-flex min-h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-16 pointer-coarse:px-3",
          checked ? "border-gain/40 text-gain" : "text-muted-foreground",
        )}
      >
        <span
          className={cn("size-1.5 rounded-full", checked ? "bg-gain" : "bg-muted-foreground/50")}
          aria-hidden
        />
        {checked ? "On" : "Off"}
      </button>
    </div>
  )
}

export function PreferencesForm({ initial }: { initial: NotificationPreferencesRow | null }) {
  const t = useTranslations("notifications")
  const router = useRouter()
  const [preferences, setPreferences] = useState<Preferences>({
    price: initial?.price ?? true,
    portfolio: initial?.portfolio ?? true,
    dividend: initial?.dividend ?? true,
    system: initial?.system ?? true,
    push: initial?.push ?? true,
  })

  const save = useMutation({
    mutationFn: (next: Preferences) =>
      apiFetch("/api/notifications/preferences", { method: "PUT", body: JSON.stringify(next) }),
    onSuccess: () => {
      toast.success(t("prefs.saved"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function set<K extends keyof Preferences>(key: K, value: boolean) {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="space-y-4">
      <div className="divide-y">
        {CATEGORIES.map((category) => (
          <Toggle
            key={category}
            id={`pref-${category}`}
            checked={preferences[category]}
            onChange={(next) => set(category, next)}
            label={t(`prefs.${category}`)}
            hint={t(`prefs.${category}Hint`)}
          />
        ))}
        <Toggle
          id="pref-push"
          checked={preferences.push}
          onChange={(next) => set("push", next)}
          label={t("prefs.asPush")}
          hint="Turning this off keeps everything in the app only, on every device."
        />
      </div>

      <Button className="gap-2 max-sm:w-full" disabled={save.isPending} onClick={() => save.mutate(preferences)}>
        {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Save preferences
      </Button>
    </div>
  )
}
