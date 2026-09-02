import type { AlertRule } from "@/domain/alerts"
import { toMarket } from "@/domain/market"
import type { AlertRow } from "@/types/database"

/** Row → domain rule. Safe on the client: no server imports, no side effects. */
export function toRuleFromRow(row: AlertRow): AlertRule {
  return {
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    market: toMarket(row.market),
    targetValue: Number(row.target_value),
    enabled: row.enabled,
    state: row.state,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastTriggeredAt: row.last_triggered_at,
    cooldownMinutes: row.cooldown_minutes,
  }
}
