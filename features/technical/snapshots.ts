import { staleAfterMinutes } from "@/domain/freshness"
import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { analyze, type TechnicalSnapshot } from "@/domain/technical"
import type { TechnicalReading } from "@/domain/alerts"
import { symbolKey, toMarket, type MarketId } from "@/domain/market"
import { getMarketDataProvider, isMarketDataError } from "@/services/market-data"
import { createClient } from "@/lib/supabase/server"
import type { Database, TechnicalSnapshotRow } from "@/types/database"
import { resolveUniverse } from "./universe"
import { logger } from "@/lib/log"

/**
 * Cached technical snapshots.
 *
 * Indicators need an OHLCV history, which is far more expensive than a quote — one request per
 * symbol, with no batching available. Recomputing on every screener run or page load would exhaust
 * the provider's quota in minutes, so the snapshot is computed once by the scheduled job and read
 * from the database by everything else.
 *
 * A snapshot is shared reference data: NVDA's RSI is the same for every user. That is what makes
 * the storage worth having, and why there is nothing user-specific in the table.
 */

/** Beyond this, a snapshot is shown as stale rather than presented as current. */
export const SNAPSHOT_STALE_MINUTES = staleAfterMinutes("snapshot")

export type StoredSnapshot = {
  snapshot: TechnicalSnapshot
  /** The venue the indicators were computed from. Prices in a snapshot are in that market's currency. */
  market: MarketId
  calculatedAt: string
  stale: boolean
}

function rowToSnapshot(row: TechnicalSnapshotRow): TechnicalSnapshot {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    symbol: row.symbol,
    price: n(row.price),
    asOf: row.source_timestamp,
    rsi: n(row.rsi),
    macd: n(row.macd),
    macdSignal: n(row.macd_signal),
    macdHistogram: n(row.macd_histogram),
    macdCross: row.macd_cross,
    emaCross5020: null,
    emaCross50200: row.ema_cross_50_200,
    adx: n(row.adx),
    plusDi: n(row.plus_di),
    minusDi: n(row.minus_di),
    atr: n(row.atr),
    atrPct: n(row.atr_pct),
    relativeVolume: n(row.relative_volume),
    averageVolume: n(row.average_volume),
    bollingerUpper: n(row.bollinger_upper),
    bollingerMiddle: n(row.bollinger_middle),
    bollingerLower: n(row.bollinger_lower),
    ema: { 20: n(row.ema_20), 50: n(row.ema_50), 200: n(row.ema_200) },
    sma: { 50: n(row.sma_50), 200: n(row.sma_200) },
    trend: row.trend ?? "neutral",
    stage: (row.stage as TechnicalSnapshot["stage"]) ?? "unknown",
    signals: (row.signals ?? []) as TechnicalSnapshot["signals"],
    score: row.score,
    scoreVersion: row.score_version,
    components: [], // recomputed on demand; storing the prose would duplicate the rules
    candleCount: row.candle_count,
    dataIssues: (row.data_issues ?? []) as TechnicalSnapshot["dataIssues"],
  }
}

function snapshotToRow(snapshot: TechnicalSnapshot, market: MarketId): TechnicalSnapshotRow {
  return {
    symbol: snapshot.symbol,
    market,
    timeframe: "1D",
    source_timestamp: snapshot.asOf ? `${snapshot.asOf.slice(0, 10)}T00:00:00Z` : null,
    calculated_at: new Date().toISOString(),
    price: snapshot.price,
    rsi: snapshot.rsi,
    macd: snapshot.macd,
    macd_signal: snapshot.macdSignal,
    macd_histogram: snapshot.macdHistogram,
    macd_cross: snapshot.macdCross,
    ema_cross_50_200: snapshot.emaCross50200,
    adx: snapshot.adx,
    plus_di: snapshot.plusDi,
    minus_di: snapshot.minusDi,
    atr: snapshot.atr,
    atr_pct: snapshot.atrPct,
    relative_volume: snapshot.relativeVolume,
    average_volume: snapshot.averageVolume,
    ema_20: snapshot.ema[20] ?? null,
    ema_50: snapshot.ema[50] ?? null,
    ema_200: snapshot.ema[200] ?? null,
    sma_50: snapshot.sma[50] ?? null,
    sma_200: snapshot.sma[200] ?? null,
    bollinger_upper: snapshot.bollingerUpper,
    bollinger_middle: snapshot.bollingerMiddle,
    bollinger_lower: snapshot.bollingerLower,
    trend: snapshot.trend,
    stage: snapshot.stage,
    score: snapshot.score,
    score_version: snapshot.scoreVersion,
    signals: snapshot.signals,
    candle_count: snapshot.candleCount,
    data_issues: snapshot.dataIssues,
  }
}

function isStale(calculatedAt: string, now = Date.now()): boolean {
  const at = Date.parse(calculatedAt)
  return Number.isNaN(at) || now - at > SNAPSHOT_STALE_MINUTES * 60_000
}

/**
 * Reads cached snapshots for the given instruments, keyed by `symbolKey` (`"SET:PTT"`). Missing
 * instruments are simply absent.
 *
 * The query filters on symbols and the results are then matched on market, rather than building a
 * composite `in` clause: the symbol list is already narrow, and the extra rows a shared spelling
 * pulls back are a handful at most.
 */
export async function readSnapshots(
  instruments: readonly { symbol: string; market: MarketId }[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, StoredSnapshot>> {
  const out = new Map<string, StoredSnapshot>()
  if (instruments.length === 0) return out

  const wanted = new Set(instruments.map((i) => symbolKey(i.symbol, i.market)))
  const supabase = client ?? (await createClient())
  const { data, error } = await supabase
    .from("technical_snapshots")
    .select("*")
    .eq("timeframe", "1D")
    .in("symbol", [...new Set(instruments.map((i) => i.symbol))])

  if (error) {
    logger.error("technical.snapshot_read_failed", { code: error.code })
    return out
  }

  for (const row of data ?? []) {
    const market = toMarket(row.market)
    const key = symbolKey(row.symbol, market)
    if (!wanted.has(key)) continue
    out.set(key, {
      snapshot: rowToSnapshot(row),
      market,
      calculatedAt: row.calculated_at,
      stale: isStale(row.calculated_at),
    })
  }
  return out
}

/** Every cached snapshot — the screener's universe as it currently stands. */
export async function readAllSnapshots(
  client?: SupabaseClient<Database>,
): Promise<Map<string, StoredSnapshot>> {
  const supabase = client ?? (await createClient())
  const { data, error } = await supabase
    .from("technical_snapshots")
    .select("*")
    .eq("timeframe", "1D")

  const out = new Map<string, StoredSnapshot>()
  if (error) {
    logger.error("technical.snapshot_read_failed", { code: error.code })
    return out
  }
  for (const row of data ?? []) {
    const market = toMarket(row.market)
    out.set(symbolKey(row.symbol, market), {
      snapshot: rowToSnapshot(row),
      market,
      calculatedAt: row.calculated_at,
      stale: isStale(row.calculated_at),
    })
  }
  return out
}

export type RefreshSummary = {
  symbols: number
  computed: number
  skippedNoHistory: number
  failed: number
  marketDataError: string | null
  durationMs: number
}

/**
 * Recomputes the universe's snapshots. Called by the scheduled job, never by a page.
 *
 * Sequential rather than parallel on purpose: the provider's limit is eight requests a minute, and
 * firing sixty at once earns a 429 for fifty-two of them. `budget` caps the run so it fits inside a
 * serverless function's time limit.
 */
export async function refreshSnapshots(
  supabase: SupabaseClient<Database>,
  budget = 20,
): Promise<RefreshSummary> {
  const startedAt = Date.now()
  const summary: RefreshSummary = {
    symbols: 0,
    computed: 0,
    skippedNoHistory: 0,
    failed: 0,
    marketDataError: null,
    durationMs: 0,
  }

  const universe = await resolveUniverse(supabase)
  summary.symbols = universe.length

  // Oldest first, so every symbol is refreshed in turn rather than the same few every run.
  const existing = await readAllSnapshots(supabase)
  const ordered = [...universe].sort((a, b) => {
    const at = existing.get(symbolKey(a.symbol, a.market))?.calculatedAt ?? ""
    const bt = existing.get(symbolKey(b.symbol, b.market))?.calculatedAt ?? ""
    return at.localeCompare(bt)
  })

  const rows: TechnicalSnapshotRow[] = []

  for (const { symbol, market } of ordered.slice(0, budget)) {
    try {
      /**
       * Indicators are computed from the instrument's **native** price series, never a translated
       * one. An RSI is a shape in a price history; converting the series into the portfolio's
       * currency first would fold the exchange rate's movement into the indicator and produce a
       * number that describes two things at once.
       */
      // A year of daily candles: enough for a 200 EMA plus the warm-up every other indicator needs.
      const candles = await getMarketDataProvider(market).getHistoricalPrices(symbol, "1Y", market)
      if (candles.length < 50) {
        summary.skippedNoHistory += 1
        continue
      }
      rows.push(snapshotToRow(analyze(symbol, candles), market))
      summary.computed += 1
    } catch (error) {
      summary.failed += 1
      if (isMarketDataError(error) && error.code === "MARKET_DATA_RATE_LIMITED") {
        // The budget is spent. Stop rather than burn the rest of the run on guaranteed failures.
        summary.marketDataError = error.message
        break
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("technical_snapshots")
      .upsert(rows, { onConflict: "symbol,market,timeframe" })
    if (error) logger.error("technical.snapshot_upsert_failed", { code: error.code })
  }

  summary.durationMs = Date.now() - startedAt
  return summary
}

/** The flat shape the alert engine reads. */
export function toTechnicalReading(stored: StoredSnapshot): TechnicalReading {
  const { snapshot } = stored
  const ema200 = snapshot.ema[200] ?? null
  return {
    rsi: snapshot.rsi,
    adx: snapshot.adx,
    relativeVolume: snapshot.relativeVolume,
    priceVsEma200Pct:
      snapshot.price !== null && ema200 !== null && ema200 !== 0
        ? ((snapshot.price - ema200) / ema200) * 100
        : null,
    macdCross: snapshot.macdCross,
    emaCross50200: snapshot.emaCross50200,
    // The snapshot's own freshness, so the engine's staleness guard covers technical alerts too.
    asOf: stored.calculatedAt,
  }
}
