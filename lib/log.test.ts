import { afterEach, describe, expect, it, vi } from "vitest"
import { log, logger, resolveRequestId } from "./log"

/**
 * A logger is only worth having if it is safe to call from anywhere. These assert the two
 * properties that make that true: structured output, and nothing sensitive in it.
 */

function captured(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  const record = (line: unknown) => lines.push(JSON.parse(String(line)))
  const spies = [
    vi.spyOn(console, "info").mockImplementation(record),
    vi.spyOn(console, "warn").mockImplementation(record),
    vi.spyOn(console, "error").mockImplementation(record),
  ]
  fn()
  for (const spy of spies) spy.mockRestore()
  return lines
}

afterEach(() => {
  delete process.env.LOG_LEVEL
  vi.unstubAllEnvs()
})

describe("log", () => {
  it("emits one JSON object per line with a stable envelope", () => {
    const [line] = captured(() => logger.info("api.request", { route: "/api/portfolios", status: 200 }))

    expect(line.level).toBe("info")
    expect(line.service).toBe("stockly")
    expect(line.event).toBe("api.request")
    expect(line.route).toBe("/api/portfolios")
    expect(line.status).toBe(200)
    expect(typeof line.timestamp).toBe("string")
  })

  it("redacts a field whose name says it holds a credential", () => {
    const [line] = captured(() =>
      logger.info("test", {
        apiKey: "sk-live-abcdefghijklmnop",
        authorization: "Bearer abc",
        sessionToken: "xyz",
        password: "hunter2",
        symbol: "NVDA",
      }),
    )

    expect(line.apiKey).toBe("[redacted]")
    expect(line.authorization).toBe("[redacted]")
    expect(line.sessionToken).toBe("[redacted]")
    expect(line.password).toBe("[redacted]")
    // Ordinary fields survive, or the logger is useless.
    expect(line.symbol).toBe("NVDA")
  })

  it("redacts a credential-shaped value whatever field it arrived in", () => {
    const [line] = captured(() =>
      logger.info("test", {
        detail: "upstream rejected sk-proj-AAAAAAAAAAAAAAAAAAAA",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0",
      }),
    )

    expect(line.detail).toBe("[redacted]")
    expect(line.jwt).toBe("[redacted]")
  })

  it("drops undefined rather than logging the word", () => {
    const [line] = captured(() => logger.info("test", { route: undefined, status: 200 }))
    expect("route" in line).toBe(false)
  })

  it("suppresses debug below the configured level", () => {
    process.env.LOG_LEVEL = "warn"
    expect(captured(() => logger.debug("test"))).toHaveLength(0)
    expect(captured(() => logger.info("test"))).toHaveLength(0)
    expect(captured(() => logger.warn("test"))).toHaveLength(1)
    expect(captured(() => logger.error("test"))).toHaveLength(1)
  })

  it("defaults to info in production, so a debug line cannot leak by being forgotten", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(captured(() => log("debug", "test"))).toHaveLength(0)
    expect(captured(() => log("info", "test"))).toHaveLength(1)
  })
})

describe("resolveRequestId", () => {
  it("keeps an upstream id so a trace is not split in two", () => {
    expect(resolveRequestId("iad1::abcde-1234567890")).toBe("iad1::abcde-1234567890")
  })

  it("generates one when there is none", () => {
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/)
    expect(resolveRequestId("   ")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("refuses a client-supplied id that could forge a log line or a header", () => {
    // The id is echoed in a response header and written into logs; a newline in either is an
    // injection, and an over-long one is a cheap way to bloat every log line.
    for (const hostile of ["abc\r\nSet-Cookie: a=b", "<script>alert(1)</script>", "x".repeat(200), "short"]) {
      expect(resolveRequestId(hostile)).toMatch(/^[0-9a-f-]{36}$/)
    }
  })
})
