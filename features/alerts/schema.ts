import { z } from "zod"
import { ALERT_TYPES, PERCENT_ALERT_TYPES, SYMBOL_ALERT_TYPES, type AlertType } from "@/domain/alerts"
import { normalizeSymbol } from "@/lib/symbol"

/**
 * The condition is an enum, never a client-supplied expression. A field like
 * `condition: "price > 200"` would be a query language the server has to interpret; an enum is a
 * closed set the database itself can constrain.
 */
export const alertInputSchema = z
  .object({
    type: z.enum(ALERT_TYPES),
    symbol: z
      .string()
      .transform(normalizeSymbol)
      .refine((s) => s.length > 0, "Symbol is required.")
      .optional(),
    portfolioId: z.uuid().optional(),
    targetValue: z.coerce.number<number>().finite("Enter a number."),
    cooldownMinutes: z.coerce
      .number<number>()
      .int()
      .min(0, "Cooldown cannot be negative.")
      .max(10080, "Cooldown cannot exceed a week.")
      .default(60),
    enabled: z.boolean().default(true),
    notes: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    const type = value.type as AlertType

    if (SYMBOL_ALERT_TYPES.includes(type) && !value.symbol) {
      ctx.addIssue({ code: "custom", path: ["symbol"], message: "Choose a stock for this alert." })
    }
    if (!SYMBOL_ALERT_TYPES.includes(type) && type !== "DIVIDEND_RECEIVED" && value.symbol) {
      ctx.addIssue({ code: "custom", path: ["symbol"], message: "This alert applies to the whole portfolio." })
    }
    if (type !== "PRICE_ABOVE" && type !== "PRICE_BELOW" && type !== "DIVIDEND_RECEIVED") {
      if (!PERCENT_ALERT_TYPES.includes(type)) return
      if (value.targetValue < -100 || value.targetValue > 1000) {
        ctx.addIssue({ code: "custom", path: ["targetValue"], message: "Enter a percentage between −100 and 1000." })
      }
    }
    if ((type === "PRICE_ABOVE" || type === "PRICE_BELOW") && value.targetValue <= 0) {
      ctx.addIssue({ code: "custom", path: ["targetValue"], message: "Enter a price above 0." })
    }
    if (
      (type === "POSITION_WEIGHT_ABOVE" || type === "POSITION_WEIGHT_BELOW") &&
      (value.targetValue < 0 || value.targetValue > 100)
    ) {
      ctx.addIssue({ code: "custom", path: ["targetValue"], message: "A weight is between 0 and 100 percent." })
    }
  })

export type AlertFormValues = z.input<typeof alertInputSchema>
export type AlertInput = z.output<typeof alertInputSchema>

export const alertUpdateSchema = z.object({
  targetValue: z.coerce.number<number>().finite().optional(),
  cooldownMinutes: z.coerce.number<number>().int().min(0).max(10080).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
})

export const notificationPreferencesSchema = z.object({
  price: z.boolean(),
  portfolio: z.boolean(),
  dividend: z.boolean(),
  system: z.boolean(),
  push: z.boolean(),
})

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "Push endpoints must be HTTPS."),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(300).optional(),
})
