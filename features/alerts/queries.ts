import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { AlertEventRow, AlertRow } from "@/types/database"

export async function listAlerts(): Promise<AlertRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    target_value: Number(row.target_value),
    last_value: row.last_value === null ? null : Number(row.last_value),
  }))
}

export async function listAlertEvents(alertId?: string): Promise<AlertEventRow[]> {
  const supabase = await createClient()
  let query = supabase
    .from("alert_events")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(50)

  if (alertId) query = query.eq("alert_id", alertId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    trigger_value: Number(row.trigger_value),
    reference_value: Number(row.reference_value),
  }))
}

export { toRuleFromRow as toRule } from "./to-rule"
