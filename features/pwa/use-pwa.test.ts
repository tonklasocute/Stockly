import { afterEach, describe, expect, it, vi } from "vitest"
import { detectPlatform } from "./use-pwa"

function withUserAgent(userAgent: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints })
}

afterEach(() => vi.unstubAllGlobals())

describe("detectPlatform", () => {
  it("recognises an iPhone", () => {
    withUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")
    expect(detectPlatform()).toBe("ios")
  })

  it("recognises an iPad running iPadOS 13+, which reports itself as a Mac", () => {
    // The classic trap: without the touch-points check this is indistinguishable from a desktop Mac,
    // and iPad users would be shown a native install button that Safari cannot honour.
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)
    expect(detectPlatform()).toBe("ios")
  })

  it("does not mistake a desktop Mac for an iPad", () => {
    withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140", 0)
    expect(detectPlatform()).toBe("desktop")
  })

  it("recognises Android", () => {
    withUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140")
    expect(detectPlatform()).toBe("android")
  })

  it("falls back to desktop for anything else", () => {
    withUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140")
    expect(detectPlatform()).toBe("desktop")
  })
})
