import { describe, expect, it } from "vitest"
import {
  calendarCovers,
  isMarketHoliday,
  isMarketOpen,
  isTradingDay,
  marketClock,
  marketDate,
  marketSessionStatus,
  nextTradingDay,
  previousTradingDay,
  tradingDays,
} from "./calendar"

/**
 * Every instant here is written in UTC and asserted against a market's own wall clock, which is the
 * whole point: 21:00 UTC is mid-session in New York and the middle of the night in Bangkok, and a
 * calendar that used the caller's timezone would answer the wrong question for half the world.
 */
describe("market clock", () => {
  it("resolves an instant into the market's local date and time", () => {
    // 2026-09-02 is a Wednesday. 14:00 UTC = 10:00 in New York, 21:00 in Bangkok.
    const at = new Date("2026-09-02T14:00:00Z")
    expect(marketClock("US", at)).toMatchObject({ date: "2026-09-02", weekday: 3, minutes: 10 * 60 })
    expect(marketClock("SET", at)).toMatchObject({ date: "2026-09-02", weekday: 3, minutes: 21 * 60 })
  })

  it("puts the two markets on different calendar days when the clocks disagree", () => {
    // 22:00 UTC on the 2nd is still the 2nd in New York and already the 3rd in Bangkok.
    const at = new Date("2026-09-02T22:00:00Z")
    expect(marketDate("US", at)).toBe("2026-09-02")
    expect(marketDate("SET", at)).toBe("2026-09-03")
  })
})

describe("sessions", () => {
  it("is open during US regular hours", () => {
    // 14:30 UTC = 10:30 New York, inside 09:30–16:00.
    expect(marketSessionStatus("US", new Date("2026-09-02T14:30:00Z"))).toBe("open")
    expect(isMarketOpen("US", new Date("2026-09-02T14:30:00Z"))).toBe(true)
  })

  it("distinguishes pre-market and after-hours from the session itself", () => {
    expect(marketSessionStatus("US", new Date("2026-09-02T12:00:00Z"))).toBe("pre") // 08:00 NY
    expect(marketSessionStatus("US", new Date("2026-09-02T21:00:00Z"))).toBe("post") // 17:00 NY
    expect(marketSessionStatus("US", new Date("2026-09-03T02:00:00Z"))).toBe("closed") // 22:00 NY
  })

  it("is open during both SET sessions and closed over the lunch break", () => {
    // 04:00 UTC = 11:00 Bangkok (morning session).
    expect(marketSessionStatus("SET", new Date("2026-09-02T04:00:00Z"))).toBe("open")
    // 06:30 UTC = 13:30 Bangkok — between the sessions. A break is not a trading window.
    expect(marketSessionStatus("SET", new Date("2026-09-02T06:30:00Z"))).toBe("closed")
    // 08:00 UTC = 15:00 Bangkok (afternoon session).
    expect(marketSessionStatus("SET", new Date("2026-09-02T08:00:00Z"))).toBe("open")
  })

  it("uses the market's clock, not the caller's, for the same instant", () => {
    // 04:00 UTC: Bangkok is trading, New York has not opened.
    const at = new Date("2026-09-02T04:00:00Z")
    expect(isMarketOpen("SET", at)).toBe(true)
    expect(isMarketOpen("US", at)).toBe(false)
  })
})

describe("weekends and holidays", () => {
  it("is closed at the weekend", () => {
    // 2026-09-05 is a Saturday.
    expect(isTradingDay("US", "2026-09-05")).toBe(false)
    expect(isTradingDay("SET", "2026-09-06")).toBe(false)
    expect(marketSessionStatus("US", new Date("2026-09-05T14:30:00Z"))).toBe("closed")
  })

  it("is closed on a US market holiday", () => {
    // Labor Day 2026.
    expect(isMarketHoliday("US", "2026-09-07")).toBe(true)
    expect(isTradingDay("US", "2026-09-07")).toBe(false)
    expect(marketSessionStatus("US", new Date("2026-09-07T14:30:00Z"))).toBe("closed")
  })

  it("is closed on a Thai holiday, and the US is not", () => {
    // Chulalongkorn Day 2026 is a Friday; New York trades that day.
    expect(isMarketHoliday("SET", "2026-10-23")).toBe(true)
    expect(isTradingDay("SET", "2026-10-23")).toBe(false)
    expect(isTradingDay("US", "2026-10-23")).toBe(true)
  })

  it("answers 'unknown' rather than 'open' past the verified calendar", () => {
    // SET's table is verified through 2026 only, because the lunar holidays for 2027 are not in it.
    expect(calendarCovers("SET", "2027-03-10")).toBe(false)
    expect(isTradingDay("SET", "2027-03-10")).toBeNull()
    expect(marketSessionStatus("SET", new Date("2027-03-10T04:00:00Z"))).toBe("unknown")
    expect(isMarketOpen("SET", new Date("2027-03-10T04:00:00Z"))).toBeNull()
  })

  it("still knows a weekend beyond the horizon — that much never changes", () => {
    // 2028-01-01 is a Saturday, whatever else that year holds.
    expect(isTradingDay("SET", "2028-01-01")).toBe(false)
  })
})

describe("trading-day arithmetic", () => {
  it("skips the weekend to the next trading day", () => {
    // Friday 2026-09-04 → Monday. (2026-09-07 is Labor Day, so it lands on the Tuesday.)
    expect(nextTradingDay("US", "2026-09-04")).toBe("2026-09-08")
    expect(previousTradingDay("US", "2026-09-08")).toBe("2026-09-04")
  })

  it("lists the trading days in a range", () => {
    // Mon 31 Aug – Fri 4 Sep 2026: five weekdays, none of them holidays.
    expect(tradingDays("US", "2026-08-31", "2026-09-04")).toHaveLength(5)
    // The week containing Labor Day has four.
    expect(tradingDays("US", "2026-09-07", "2026-09-11")).toHaveLength(4)
  })

  it("returns null rather than a partial count when the range runs past the calendar", () => {
    expect(tradingDays("SET", "2026-12-28", "2027-01-08")).toBeNull()
    expect(nextTradingDay("SET", "2026-12-31")).toBeNull()
  })

  it("returns an empty list for an inverted range instead of looping", () => {
    expect(tradingDays("US", "2026-09-04", "2026-09-01")).toEqual([])
  })
})
