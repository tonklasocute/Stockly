"use client"

import { Fragment, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ImportPreview, ImportSeverity, RowOutcome } from "@/domain/import"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

const OUTCOME_LABELS: Record<RowOutcome, string> = {
  CREATE: "Will import",
  DUPLICATE: "Already imported",
  REJECT: "Rejected",
}

/** Never colour alone: the outcome is spelled out in its own column on every row. */
const OUTCOME_TONE: Record<RowOutcome, string> = {
  CREATE: "text-gain",
  DUPLICATE: "text-muted-foreground",
  REJECT: "text-loss",
}

const SEVERITY_TONE: Record<ImportSeverity, string> = {
  ERROR: "text-loss",
  WARNING: "text-foreground",
  INFO: "text-muted-foreground",
}

/**
 * What each row will do, and why.
 *
 * Problem rows first and shown by default; the ones that will simply import are collapsed behind a
 * toggle. A user reviewing an import needs to see what is wrong, not scroll past four hundred rows
 * that are fine.
 *
 * Cards below `lg`, because a seven-column table is unreadable at 390px and this flow has to work
 * on a phone.
 */
export function PreviewTable({ preview }: { preview: ImportPreview }) {
  const t = useTranslations("imports")
  const [showAll, setShowAll] = useState(false)

  const problems = preview.rows.filter(
    (row) => row.outcome !== "CREATE" || row.issues.length > 0,
  )
  const visible = showAll ? preview.rows : problems.slice(0, 50)

  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border py-8 text-center text-sm">{t("allPassed")}</p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {showAll
            ? `All ${preview.rows.length} rows`
            : `${problems.length} row${problems.length === 1 ? "" : "s"} needing attention`}
          {!showAll && problems.length > 50 ? " · first 50 shown" : ""}
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowAll((previous) => !previous)}>
          {showAll ? "Show only problems" : "Show every row"}
        </Button>
      </div>

      {/* Mobile: cards. A seven-column table cannot be read at 390px. */}
      <ul className="grid gap-2 lg:hidden">
        {visible.map((row) => (
          <li key={row.row.rowNumber} className="bg-card space-y-2 rounded-xl border p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Row {row.row.rowNumber}</span>
              <span className={cn("text-xs font-medium", OUTCOME_TONE[row.outcome])}>
                {OUTCOME_LABELS[row.outcome]}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {[
                row.row.tradeDate ?? "no date",
                row.row.symbol ?? "no symbol",
                row.row.side ?? "no side",
                row.row.quantity ?? "no quantity",
                row.row.price ?? "no price",
              ].join(" · ")}
            </p>
            {row.issues.map((issue, index) => (
              <p key={index} className={cn("text-xs", SEVERITY_TONE[issue.severity])}>
                {issue.severity}: {issue.message}
              </p>
            ))}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border lg:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16">{t("row")}</TableHead>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("symbol")}</TableHead>
              <TableHead>{t("side")}</TableHead>
              <TableHead className="text-right">{t("quantity")}</TableHead>
              <TableHead className="text-right">{t("price")}</TableHead>
              <TableHead className="text-right">{t("fee")}</TableHead>
              <TableHead>{t("outcome")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              // A keyed Fragment: a row and its issues are two <tr>s that belong together.
              <Fragment key={row.row.rowNumber}>
                <TableRow>
                  <TableCell className="tabular text-muted-foreground">
                    {row.row.rowNumber}
                  </TableCell>
                  <TableCell className="tabular">{row.row.tradeDate ?? "—"}</TableCell>
                  <TableCell className="font-medium">{row.row.symbol ?? "—"}</TableCell>
                  <TableCell className="capitalize">{row.row.side ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{row.row.quantity ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{row.row.price ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{row.row.fee ?? "—"}</TableCell>
                  <TableCell className={cn("text-xs font-medium", OUTCOME_TONE[row.outcome])}>
                    {OUTCOME_LABELS[row.outcome]}
                  </TableCell>
                </TableRow>
                {row.issues.length > 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={7} className="pt-0">
                      {row.issues.map((issue, index) => (
                        <p key={index} className={cn("text-xs", SEVERITY_TONE[issue.severity])}>
                          {issue.field ? `${issue.field}: ` : ""}
                          {issue.message}
                        </p>
                      ))}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
