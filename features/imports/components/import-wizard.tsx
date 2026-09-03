"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Metric } from "@/components/metric"
import {
  FIELD_HELP,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  type ColumnMapping,
  type ImportField,
  type ImportFormat,
  type ImportPreview,
} from "@/domain/import"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { MAX_IMPORT_BYTES } from "../schema"
import { PreviewTable } from "./preview-table"
import { useTranslations } from "next-intl"

type ParsedResponse = {
  format: ImportFormat
  sheets: string[]
  sheet: string | null
  delimiter: string | null
  blankRows: number
  rows: string[][]
  headerRow: number
  mapping: ColumnMapping[]
}

type Step = "upload" | "map" | "review" | "done"

/** `id` is the step and, with one exception, its translation key. */
const STEPS: Array<{ id: Step; key: string }> = [
  { id: "upload", key: "upload" },
  { id: "map", key: "mapColumns" },
  { id: "review", key: "review" },
  { id: "done", key: "done" },
]

/**
 * The import flow, as four steps.
 *
 * A step at a time rather than one dense table, because the whole thing has to work on a phone —
 * and because the order is the safety property: a user maps, then sees exactly what will happen,
 * then confirms. **No transaction is created by uploading a file**; the preview endpoint writes
 * nothing at all, so backing out at any point leaves the portfolio untouched.
 */
export function ImportWizard({
  portfolioId,
  portfolioName,
}: {
  portfolioId: string
  portfolioName: string
}) {
  const t = useTranslations("imports")
  const tEnum = useTranslations("enums")
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [parsed, setParsed] = useState<ParsedResponse | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping[]>([])
  const [headerRow, setHeaderRow] = useState(0)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [allowPartial, setAllowPartial] = useState(false)
  const [result, setResult] = useState<{
    created: number
    duplicates: number
    rejected: number
    totalRows: number
    sessionId: string
  } | null>(null)

  const header = parsed?.rows[headerRow] ?? []

  const upload = useMutation({
    mutationFn: async (chosen: File) => {
      const body = new FormData()
      body.set("file", chosen)
      // Not `apiFetch`: multipart must not carry a JSON content type, and the browser has to set
      // its own boundary.
      const response = await fetch("/api/imports/preview", { method: "POST", body })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload?.error?.message ?? "That file could not be read.")
      }
      return payload.data as ParsedResponse
    },
    onSuccess: (data) => {
      setParsed(data)
      setMapping(data.mapping)
      setHeaderRow(data.headerRow)
      setPreview(null)
      setStep("map")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const validate = useMutation({
    mutationFn: () =>
      apiFetch<{ preview: ImportPreview }>("/api/imports/preview", {
        method: "POST",
        body: JSON.stringify({ portfolioId, rows: parsed?.rows ?? [], mapping, headerRow }),
      }),
    onSuccess: ({ preview: result }) => {
      setPreview(result)
      setStep("review")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const apply = useMutation({
    mutationFn: () =>
      apiFetch<{
        sessionId: string
        created: number
        duplicates: number
        rejected: number
        totalRows: number
      }>("/api/imports", {
        method: "POST",
        body: JSON.stringify({
          portfolioId,
          rows: parsed?.rows ?? [],
          mapping,
          headerRow,
          filename: file?.name ?? "import",
          format: parsed?.format ?? "CSV",
          allowPartial,
        }),
      }),
    onSuccess: (data) => {
      setResult(data)
      setStep("done")
      // Holdings and every analytic derive from the transaction set that just changed.
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const setField = useCallback((field: ImportField, columnIndex: number | null) => {
    setMapping((previous) => {
      const next = previous.filter((entry) => entry.field !== field)
      // A column can fill one field only; claiming it releases whoever had it.
      return [
        ...next.map((entry) => (entry.columnIndex === columnIndex ? { ...entry, columnIndex: null } : entry)),
        { field, columnIndex },
      ]
    })
    setPreview(null)
  }, [])

  const missingRequired = REQUIRED_FIELDS.filter(
    (field) => (mapping.find((entry) => entry.field === field)?.columnIndex ?? null) === null,
  )

  function reset() {
    setStep("upload")
    setFile(null)
    setParsed(null)
    setMapping([])
    setPreview(null)
    setResult(null)
    setAllowPartial(false)
    if (fileInput.current) fileInput.current.value = ""
  }

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-1.5" aria-label={t("steps")}>
        {STEPS.map((entry, index) => {
          const position = STEPS.findIndex((s) => s.id === step)
          const state = index < position ? "done" : index === position ? "current" : "todo"
          return (
            <li
              key={entry.id}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-xs font-medium",
                state === "current" && "border-primary bg-primary/5",
                state === "done" && "text-muted-foreground",
                state === "todo" && "text-muted-foreground opacity-60",
              )}
            >
              <span className="text-muted-foreground mr-1.5">{index + 1}</span>
              {t(entry.key)}
            </li>
          )
        })}
      </ol>

      {/* ---------------------------------------------------------------- upload */}
      {step === "upload" && (
        <div className="bg-card space-y-4 rounded-xl border p-6 text-center">
          <FileUp className="text-muted-foreground mx-auto size-8" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Import trades into {portfolioName}</p>
            <p className="text-muted-foreground text-sm">
              A CSV or .xlsx file from your broker. Nothing is created until you confirm, and the
              file itself is never stored.
            </p>
          </div>

          <input
            ref={fileInput}
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              if (!chosen) return
              if (chosen.size > MAX_IMPORT_BYTES) {
                toast.error(
                  `That file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB. Split it and import the parts.`,
                )
                return
              }
              setFile({ name: chosen.name, size: chosen.size })
              upload.mutate(chosen)
            }}
          />
          <Button
            className="gap-2 max-sm:h-11"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {upload.isPending ? "Reading…" : "Choose a file"}
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- mapping */}
      {step === "map" && parsed && (
        <div className="space-y-4">
          <div className="bg-card space-y-1 rounded-xl border p-4">
            <p className="text-sm font-medium">{file?.name}</p>
            <p className="text-muted-foreground text-xs">
              {parsed.format}
              {parsed.sheet ? ` · sheet “${parsed.sheet}”` : ""}
              {parsed.delimiter ? ` · delimiter “${parsed.delimiter === "\t" ? "tab" : parsed.delimiter}”` : ""}{" "}
              · {parsed.rows.length} rows read
              {parsed.blankRows > 0 ? `, ${parsed.blankRows} blank skipped` : ""}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-header-row">{t("headerRow")}</Label>
              <Select
                value={String(headerRow)}
                onValueChange={(value) => {
                  setHeaderRow(Number(value))
                  setPreview(null)
                }}
              >
                <SelectTrigger id="import-header-row" className="w-full">
                  <SelectValue>{(value) => `Row ${Number(value) + 1}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {parsed.rows.slice(0, 10).map((row, index) => (
                    <SelectItem key={index} value={String(index)}>
                      Row {index + 1}: {row.slice(0, 3).join(", ").slice(0, 40)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-card space-y-4 rounded-xl border p-4">
            <div>
              <h2 className="text-sm font-semibold">{t("mapYourColumns")}</h2>
              <p className="text-muted-foreground text-xs">
                Suggested from the header row. Check them — a wrong column here is a wrong
                transaction, so nothing is applied on a guess.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => {
                const current = mapping.find((entry) => entry.field === field)?.columnIndex ?? null
                const required = REQUIRED_FIELDS.includes(field)
                return (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`map-${field}`}>
                      {tEnum(`importField.${field}`)}
                      {required ? (
                        <span className="text-loss ml-1" aria-label="required">
                          *
                        </span>
                      ) : null}
                    </Label>
                    <Select
                      value={current === null ? "__none" : String(current)}
                      onValueChange={(value) =>
                        setField(field, value === "__none" ? null : Number(value))
                      }
                    >
                      <SelectTrigger
                        id={`map-${field}`}
                        className="w-full"
                        aria-invalid={required && current === null}
                      >
                        <SelectValue>
                          {(value) =>
                            value === "__none"
                              ? t("notInFile")
                              : (header[Number(value)] || `Column ${Number(value) + 1}`)
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t("notInFile")}</SelectItem>
                        {header.map((name, index) => (
                          <SelectItem key={index} value={String(index)}>
                            {name || `Column ${index + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">{FIELD_HELP[field]}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {missingRequired.length > 0 && (
            <Alert>
              <AlertDescription>
                {t("mapBefore", {
                  fields: missingRequired.map((field) => tEnum(`importField.${field}`)).join(", "),
                })}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="max-sm:h-11" onClick={reset}>{t("startOver")}</Button>
            <Button
              className="gap-2 max-sm:h-11"
              disabled={missingRequired.length > 0 || validate.isPending}
              onClick={() => validate.mutate()}
            >
              {validate.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Check the file
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- review */}
      {step === "review" && preview && (
        <div className="space-y-4">
          <dl className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-4">
            {[
              { label: t("rowsRead"), value: preview.totalRows },
              { label: t("willBeCreated"), value: preview.createCount },
              { label: t("alreadyImported"), value: preview.duplicateCount },
              { label: t("rejected"), value: preview.rejectCount },
            ].map((entry) => (
              <div key={entry.label} className="bg-card space-y-0.5 p-4">
                <dt className="text-muted-foreground text-xs">{entry.label}</dt>
                <dd className="tabular text-xl font-semibold">{entry.value}</dd>
              </div>
            ))}
          </dl>

          {preview.duplicateCount > 0 && preview.createCount === 0 && (
            <Alert>
              <AlertDescription>
                Every row in this file is already in {portfolioName}. Importing it again would
                create nothing.
              </AlertDescription>
            </Alert>
          )}

          {preview.rejectCount > 0 && (
            <Alert>
              <AlertDescription className="space-y-2">
                <p>
                  {preview.rejectCount} row{preview.rejectCount === 1 ? "" : "s"} did not pass
                  validation and will not be imported. Fix the file and upload it again, or import
                  only the rows that passed.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={allowPartial}
                    onChange={(event) => setAllowPartial(event.target.checked)}
                  />
                  Import the {preview.createCount} valid row
                  {preview.createCount === 1 ? "" : "s"} and skip the rest
                </label>
              </AlertDescription>
            </Alert>
          )}

          <PreviewTable preview={preview} />

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="max-sm:h-11" onClick={() => setStep("map")}>{t("backToMapping")}</Button>
            <Button
              className="gap-2 max-sm:h-11"
              disabled={
                apply.isPending ||
                preview.createCount === 0 ||
                (preview.rejectCount > 0 && !allowPartial)
              }
              onClick={() => apply.mutate()}
            >
              {apply.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Import {preview.createCount} transaction{preview.createCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- done */}
      {step === "done" && result && (
        <div className="bg-card space-y-4 rounded-xl border p-6">
          <div className="flex items-start gap-3">
            {result.rejected > 0 ? (
              <AlertTriangle className="text-loss mt-0.5 size-5 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="text-gain mt-0.5 size-5 shrink-0" aria-hidden />
            )}
            <div>
              <p className="font-medium">
                {result.created} transaction{result.created === 1 ? "" : "s"} imported
              </p>
              <p className="text-muted-foreground text-sm">
                Out of {result.totalRows} rows: {result.duplicates} already existed,{" "}
                {result.rejected} rejected. Your holdings and every figure derived from them have
                been recalculated from the transactions.
              </p>
            </div>
          </div>

          <dl className="grid gap-4 sm:grid-cols-3">
            <Metric label={t("created")} value={String(result.created)} />
            <Metric
              label={t("skippedDuplicates")}
              value={String(result.duplicates)}
              hint="Importing this file again would create nothing"
            />
            <Metric label={t("rejected")} value={String(result.rejected)} />
          </dl>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button className="max-sm:h-11" onClick={reset}>{t("importAnother")}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
