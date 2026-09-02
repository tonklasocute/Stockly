"use client"

import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiFetch } from "@/lib/api-client"
// From the types module, not the barrel: the barrel is `server-only`.
import type { BenchmarkDefinition } from "@/services/benchmark/types"

const NONE = "__none"

/**
 * Choosing which index a portfolio is measured against.
 *
 * Every benchmark is listed with the currency it is quoted in, because a mismatch with the
 * portfolio's base currency is what makes the difference figure unavailable — better to see that
 * before choosing than to wonder why the comparison reads "N/A" afterwards.
 */
export function BenchmarkPicker({
  portfolioId,
  benchmarks,
  selectedId,
}: {
  portfolioId: string
  benchmarks: BenchmarkDefinition[]
  selectedId: string | null
}) {
  const router = useRouter()

  const select = useMutation({
    mutationFn: (benchmarkId: string | null) =>
      apiFetch("/api/benchmarks", {
        method: "PUT",
        body: JSON.stringify({ portfolioId, benchmarkId }),
      }),
    onSuccess: () => {
      toast.success("Benchmark updated.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (benchmarks.length === 0) return null

  return (
    <Select
      value={selectedId ?? NONE}
      onValueChange={(value) => select.mutate(value === NONE || !value ? null : value)}
      disabled={select.isPending}
    >
      <SelectTrigger aria-label="Benchmark" className="w-48">
        <SelectValue>
          {(value) =>
            value === NONE
              ? "No benchmark"
              : (benchmarks.find((b) => b.id === value)?.name ?? "No benchmark")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No benchmark</SelectItem>
        {benchmarks.map((benchmark) => (
          <SelectItem key={benchmark.id} value={benchmark.id}>
            {benchmark.name} · {benchmark.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
