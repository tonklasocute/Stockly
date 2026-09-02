import { describe, expect, it } from "vitest"
import { buildFxTable, convert } from "@/domain/fx"
import { mockFxRateProvider } from "./mock-provider"

const NOW = new Date()

describe("mock FX provider", () => {
  it("answers the pair the app actually needs", async () => {
    const rate = await mockFxRateProvider.getRate("USD", "THB")
    expect(rate).toMatchObject({ base: "USD", quote: "THB", provider: "mock" })
    expect(rate!.rate).toBeGreaterThan(0)
  })

  it("answers the inverse without a separate entry", async () => {
    const forward = await mockFxRateProvider.getRate("USD", "THB")
    const back = await mockFxRateProvider.getRate("THB", "USD")
    expect(back!.rate).toBeCloseTo(1 / forward!.rate, 9)
  })

  it("returns 1 for a pair of the same currency", async () => {
    expect((await mockFxRateProvider.getRate("USD", "USD"))?.rate).toBe(1)
  })

  it("returns null for a pair it does not know — the case most likely to be wrong in production", async () => {
    expect(await mockFxRateProvider.getRate("JPY", "HKD")).toBeNull()
  })

  it("batches, and simply omits the pairs it cannot answer", async () => {
    const rates = await mockFxRateProvider.getRates([
      { base: "USD", quote: "THB" },
      { base: "JPY", quote: "HKD" },
    ])
    expect(rates).toHaveLength(1)
    expect(rates[0]).toMatchObject({ base: "USD", quote: "THB" })
  })

  it("produces a table a conversion can actually use", async () => {
    const rates = await mockFxRateProvider.getRates([{ base: "USD", quote: "THB" }])
    const converted = convert(100, "USD", "THB", buildFxTable(rates), NOW)
    expect(converted?.value).toBeCloseTo(100 * rates[0].rate, 4)
    expect(converted?.freshness).toBe("fresh")
  })
})
