"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Section } from "@/components/metric"
import { TAG_COLORS } from "@/features/personalization/schema"
import { TAG_CLASSES } from "@/features/personalization/tag-colors"
import { apiFetch } from "@/lib/api-client"
import type { TagRow } from "@/types/database"
import { useTranslations } from "next-intl"

/**
 * Creating and deleting tags.
 *
 * A tag is a label. Deleting one removes it from every position it was on and reaches nothing
 * else — no transaction references a tag, so there is no way for this screen to touch money.
 */
export function TagManager({ tags }: { tags: TagRow[] }) {
  const t = useTranslations("personalization")
  const tc = useTranslations("common")
  const router = useRouter()
  const [name, setName] = useState("")
  const [color, setColor] = useState<(typeof TAG_COLORS)[number]>("slate")
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await work()
      toast.success(done)
      startTransition(() => router.refresh())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title={t("tags.title")}
      description={t("tags.managerDescription")}
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = name.trim()
          if (!trimmed) return
          void run(async () => {
            await apiFetch("/api/tags", { method: "POST", body: JSON.stringify({ name: trimmed, color }) })
            setName("")
          }, "Tag created.")
        }}
      >
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor="tagName">{t("tags.new")}</Label>
          <Input
            id="tagName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={30}
            placeholder={t("tags.examplePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tagColor">{t("tags.colour")}</Label>
          <select
            id="tagColor"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm capitalize pointer-coarse:h-11"
            value={color}
            onChange={(event) => setColor(event.target.value as (typeof TAG_COLORS)[number])}
          >
            {TAG_COLORS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={busy || name.trim().length === 0}>
          <Plus className="size-4" />
          {tc("actions.add")}
        </Button>
      </form>

      {tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${TAG_CLASSES[tag.color] ?? TAG_CLASSES.slate}`}
              >
                {tag.name}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Delete tag ${tag.name}`}
                  className="hover:opacity-70"
                  onClick={() =>
                    void run(
                      () => apiFetch(`/api/tags/${tag.id}`, { method: "DELETE" }),
                      "Tag deleted.",
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">{t("tags.noneYet")}</p>
      )}
    </Section>
  )
}
