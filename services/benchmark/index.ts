import "server-only"

import { cache } from "react"
import { baseCurrencyOf, toMarket } from "@/domain/market"
import { serverEnv } from "@/lib/env.server"
import { createClient } from "@/lib/supabase/server"
import type { BenchmarkRow } from "@/types/database"
import { mockBenchmarkProvider } from "./mock-provider"
import { createMarketDataBenchmarkProvider } from "./twelve-data-provider"
import type { BenchmarkDefinition, BenchmarkProvider } from "./types"

/**
 * The single place a benchmark provider is chosen.
 *
 * `BENCHMARK_PROVIDER` defaults to the market-data provider, because that is where an index series
 * would come from. Set it to `mock` to get a deterministic synthetic index — which is what a
 * deployment on a free tier needs, since index data is not on one.
 */
export const getBenchmarkProvider = cache((): BenchmarkProvider => {
  switch (serverEnv.benchmarkProvider) {
    case "mock":
      return mockBenchmarkProvider
    default:
      return createMarketDataBenchmarkProvider()
  }
})

/** The benchmarks this deployment knows about — shared reference data, readable by any user. */
export const listBenchmarks = cache(async (): Promise<BenchmarkDefinition[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from("benchmarks").select("*").order("code")
  if (error) throw error
  return (data ?? []).map(toDefinition)
})

export function toDefinition(row: BenchmarkRow): BenchmarkDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    market: toMarket(row.market),
    currency: baseCurrencyOf(row.currency),
  }
}

export { rebase } from "./types"
export type { BenchmarkDefinition, BenchmarkProvider } from "./types"
