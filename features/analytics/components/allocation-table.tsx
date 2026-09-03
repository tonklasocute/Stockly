import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AllocationSlice } from "@/domain/analytics"
import { formatCurrency, formatPercent } from "@/lib/format"
import { getTranslations } from "next-intl/server"

/**
 * The table, not the donut, is the accessible representation of an allocation: it is readable by a
 * screen reader, sortable by eye, and works in greyscale. The chart sits beside it, not instead.
 */
export async function AllocationTable({
  slices,
  currency,
  label,
}: {
  slices: AllocationSlice[]
  currency: string
  /** Already translated by the caller — it names the dimension being allocated over. */
  label: string
}) {
  const t = await getTranslations("analytics")

  if (slices.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        {t("allocation.emptyFor", { label })}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">{t("allocation.value")}</TableHead>
            <TableHead className="w-40 text-right">{t("allocation.weight")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slices.map((slice) => (
            <TableRow key={slice.key}>
              <TableCell className="font-medium">{slice.label}</TableCell>
              <TableCell className="tabular text-right">
                {formatCurrency(slice.value, currency)}
              </TableCell>
              <TableCell className="text-right">
                <span className="flex items-center justify-end gap-2">
                  {/* A bar as well as a number, so magnitude is visible without reading every row. */}
                  <span className="bg-muted hidden h-1.5 w-20 overflow-hidden rounded-full sm:block">
                    <span
                      className="bg-chart-1 block h-full rounded-full"
                      style={{ width: `${Math.min(slice.weight, 100)}%` }}
                    />
                  </span>
                  <span className="tabular w-16 text-right">
                    {formatPercent(slice.weight, { signed: false })}
                  </span>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
