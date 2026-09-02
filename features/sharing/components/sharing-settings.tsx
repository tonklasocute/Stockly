"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Section } from "@/components/metric"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  LINK_DURATIONS,
  SHARE_TEMPLATES,
  SHARE_VISIBILITIES,
  TEMPLATE_HELP,
  TEMPLATE_LABELS,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
  linkState,
  normalizeSlug,
  type ShareConfig,
  type ShareVisibility,
} from "@/domain/sharing"
import { apiFetch } from "@/lib/api-client"
import { formatDate } from "@/lib/format"
import type { PortfolioShareLinkRow, ShareSnapshotRow } from "@/types/database"

type Snapshot = Omit<ShareSnapshotRow, "payload">

/**
 * The owner's controls.
 *
 * Two things about the shape of this screen are deliberate:
 *
 * 1. **Visibility is chosen before anything else, and the consequence is spelled out next to it.**
 *    A person turning a portfolio public should read what that means at the moment they do it, not
 *    in a help page afterwards.
 * 2. **A section toggle and a figure toggle are separated.** "Show my holdings" and "show what they
 *    are worth" are different decisions, and a UI that bundles them is a UI that shares an account
 *    balance because somebody wanted to show a stock list.
 *
 * The preview is the page itself, rendered by the server from the same projection, and lives beside
 * this component rather than inside it.
 */
export function SharingSettings({
  portfolioId,
  initialConfig,
  links,
  snapshots,
  publishedAt,
  origin,
}: {
  portfolioId: string
  initialConfig: ShareConfig
  links: PortfolioShareLinkRow[]
  snapshots: Snapshot[]
  publishedAt: string | null
  origin: string
}) {
  const router = useRouter()
  const [config, setConfig] = useState(initialConfig)
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [issuedToken, setIssuedToken] = useState<{ token: string; kind: "LINK" | "SNAPSHOT" } | null>(null)

  const set = <K extends keyof ShareConfig>(key: K, value: ShareConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }))

  const run = async (work: () => Promise<void>, done: string) => {
    setSaving(true)
    try {
      await work()
      toast.success(done)
      startTransition(() => router.refresh())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.")
    } finally {
      setSaving(false)
    }
  }

  const save = () =>
    run(async () => {
      await apiFetch("/api/shares", {
        method: "PUT",
        body: JSON.stringify({ portfolioId, ...config }),
      })
    }, "Sharing settings saved.")

  const busy = saving || pending

  return (
    <div className="space-y-4">
      <Section title="Who can see this portfolio">
        <div className="space-y-2">
          {SHARE_VISIBILITIES.map((visibility) => (
            <label
              key={visibility}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 pointer-coarse:min-h-11"
            >
              <input
                type="radio"
                name="visibility"
                className="mt-1"
                checked={config.visibility === visibility}
                onChange={() => set("visibility", visibility as ShareVisibility)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{VISIBILITY_LABELS[visibility]}</span>
                <span className="text-muted-foreground block text-xs">
                  {VISIBILITY_HELP[visibility]}
                </span>
              </span>
            </label>
          ))}
        </div>

        {config.visibility === "PUBLIC" ? (
          <Alert className="mt-3">
            <AlertDescription>
              Anyone who finds your address can open this page. Only the sections you switch on
              below are included — your transactions, journal, theses and notes are never shared.
            </AlertDescription>
          </Alert>
        ) : null}

        {config.visibility !== "PRIVATE" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="slug">Public address</Label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground shrink-0 text-xs">{origin}/p/</span>
                <Input
                  id="slug"
                  value={config.slug ?? ""}
                  onChange={(event) => set("slug", normalizeSlug(event.target.value))}
                  placeholder="my-portfolio"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Changing this makes the old address stop working. It never points at anyone else.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Page title</Label>
              <Input
                id="displayName"
                value={config.displayName ?? ""}
                onChange={(event) => set("displayName", event.target.value || null)}
                placeholder="Growth portfolio"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ownerDisplayName">Your name on the page</Label>
              <Input
                id="ownerDisplayName"
                value={config.ownerDisplayName ?? ""}
                onChange={(event) => set("ownerDisplayName", event.target.value || null)}
                placeholder="Optional"
                maxLength={40}
              />
              <p className="text-muted-foreground text-xs">
                Free text. Your email address is never shown.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={config.description ?? ""}
                onChange={(event) => set("description", event.target.value || null)}
                maxLength={280}
              />
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Start from a preset" description="A preset fills in the switches below. You can then change any of them.">
        <div className="flex flex-wrap gap-2">
          {SHARE_TEMPLATES.map((template) => (
            <Button
              key={template}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await apiFetch<{ config: ShareConfig }>("/api/shares", {
                    method: "PATCH",
                    body: JSON.stringify({ portfolioId, template }),
                  })
                  setConfig(result.config)
                }, `Applied the ${TEMPLATE_LABELS[template].toLowerCase()} preset.`)
              }
              title={TEMPLATE_HELP[template]}
            >
              {TEMPLATE_LABELS[template]}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Sections" description="Nothing is shared until you switch it on.">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Toggle label="Overview" checked={config.showOverview} onChange={(v) => set("showOverview", v)} />
          <Toggle label="Holdings" checked={config.showHoldings} onChange={(v) => set("showHoldings", v)} />
          <Toggle label="Allocation" checked={config.showAllocation} onChange={(v) => set("showAllocation", v)} />
          <Toggle label="Performance" checked={config.showPerformance} onChange={(v) => set("showPerformance", v)} />
          <Toggle label="Benchmark" checked={config.showBenchmark} onChange={(v) => set("showBenchmark", v)} />
          <Toggle label="Risk" checked={config.showRisk} onChange={(v) => set("showRisk", v)} />
          <Toggle label="Dividends" checked={config.showDividends} onChange={(v) => set("showDividends", v)} />
          <Toggle label="Observations" checked={config.showInsights} onChange={(v) => set("showInsights", v)} />
          <Toggle
            label="Goal progress"
            hint="Progress only. Your notes are never shared."
            checked={config.showGoals}
            onChange={(v) => set("showGoals", v)}
          />
        </div>
      </Section>

      <Section
        title="Figures"
        description="What the sections above are allowed to say. Each is off until you turn it on."
      >
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Toggle
            label="Amounts"
            hint="Portfolio value and money figures. Off means percentages only."
            checked={config.showAbsoluteValues}
            onChange={(v) => set("showAbsoluteValues", v)}
          />
          <Toggle
            label="Quantities"
            hint="How many shares you hold."
            checked={config.showQuantity}
            onChange={(v) => set("showQuantity", v)}
          />
          <Toggle
            label="Unrealised P&L"
            checked={config.showUnrealizedPnl}
            onChange={(v) => set("showUnrealizedPnl", v)}
          />
          <Toggle
            label="Realised P&L"
            checked={config.showRealizedPnl}
            onChange={(v) => set("showRealizedPnl", v)}
          />
          <Toggle label="Cash balance" checked={config.showCash} onChange={(v) => set("showCash", v)} />
          <Toggle
            label="Allow search engines"
            hint={
              config.visibility === "PUBLIC"
                ? "Lets Google and others index your public page."
                : "Only available for a public portfolio."
            }
            disabled={config.visibility !== "PUBLIC"}
            checked={config.allowSearchIndexing}
            onChange={(v) => set("allowSearchIndexing", v)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save and publish
          </Button>
          {publishedAt ? (
            <span className="text-muted-foreground text-xs">
              Visitors currently see figures published {formatDate(publishedAt)}.
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Nothing is published yet.</span>
          )}
        </div>
      </Section>

      {publishedAt ? (
        <Section
          title="Published figures"
          description="A shared page shows what was last published, not a live feed. It says so on the page."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(
                () => apiFetch("/api/shares/publish", { method: "POST", body: JSON.stringify({ portfolioId }) }),
                "Published today's figures.",
              )
            }
          >
            Update published figures
          </Button>
        </Section>
      ) : null}

      <Section
        title="Share links"
        description="A link works whatever your visibility is set to, until it expires or you revoke it."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {LINK_DURATIONS.map((duration) => (
              <Button
                key={duration.key}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await apiFetch<{ token: string }>("/api/shares/links", {
                      method: "POST",
                      body: JSON.stringify({ portfolioId, label: null, duration: duration.key }),
                    })
                    setIssuedToken({ token: result.token, kind: "LINK" })
                  }, "Link created.")
                }
              >
                <Link2 className="size-3.5" />
                {duration.label}
              </Button>
            ))}
          </div>
        }
      >
        {issuedToken ? (
          <CopyOnce
            url={`${origin}/${issuedToken.kind === "LINK" ? "share" : "snapshot"}/${issuedToken.token}`}
            onDismiss={() => setIssuedToken(null)}
          />
        ) : null}

        {links.length === 0 ? (
          <p className="text-muted-foreground text-sm">No links yet.</p>
        ) : (
          <ul className="divide-y">
            {links.map((link) => {
              const state = linkState(
                { expiresAt: link.expires_at, revokedAt: link.revoked_at },
                new Date(),
              )
              return (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{link.label ?? "Share link"}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      Created {formatDate(link.created_at)}
                      {link.expires_at ? ` · expires ${formatDate(link.expires_at)}` : " · no expiry"}
                      {" · "}
                      {link.access_count} view{link.access_count === 1 ? "" : "s"}
                      {link.last_accessed_at ? ` · last ${formatDate(link.last_accessed_at)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={state === "VALID" ? "outline" : "secondary"}>{state}</Badge>
                    {state === "VALID" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => apiFetch(`/api/shares/links/${link.id}`, { method: "DELETE" }),
                            "Link revoked.",
                          )
                        }
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          A link is shown once, when it is created — Stockly stores only a hash of it and cannot show
          it again. Revoke and create a new one if you lose it.
        </p>
      </Section>

      <Section
        title="Snapshots"
        description="A snapshot freezes today's figures at their own address. It never updates."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await apiFetch<{ token: string }>("/api/shares/snapshots", {
                  method: "POST",
                  body: JSON.stringify({ portfolioId, label: null }),
                })
                setIssuedToken({ token: result.token, kind: "SNAPSHOT" })
              }, "Snapshot taken.")
            }
          >
            Take a snapshot
          </Button>
        }
      >
        {snapshots.length === 0 ? (
          <p className="text-muted-foreground text-sm">No snapshots yet.</p>
        ) : (
          <ul className="divide-y">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {snapshot.label ?? "Snapshot"}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatDate(snapshot.calculated_at)} · {snapshot.base_currency} · v{snapshot.version}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => apiFetch(`/api/shares/snapshots/${snapshot.id}`, { method: "DELETE" }),
                      "Snapshot deleted.",
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Delete snapshot</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          Deleting a snapshot removes a page. It never touches a transaction, a holding or a P&L
          figure.
        </p>
      </Section>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2 pointer-coarse:min-h-11">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint ? <span className="text-muted-foreground block text-xs">{hint}</span> : null}
      </span>
    </label>
  )
}

/**
 * The one place a raw token is ever displayed.
 *
 * It is held in component state and nowhere else: not in the URL, not in a toast, not in a log. It
 * disappears on dismissal or navigation, which is the honest consequence of the server storing only
 * a hash.
 */
function CopyOnce({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Alert className="mb-3">
      <AlertDescription className="space-y-2">
        <p className="text-sm font-medium">Copy this link now — it is shown only once.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded px-2 py-1 text-xs">
            {url}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(url).then(
                () => setCopied(true),
                () => toast.error("Could not copy. Select the link and copy it manually."),
              )
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
