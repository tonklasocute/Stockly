import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Replaced per test so each one controls what the push layer reports back. */
const pushOutcomes: string[] = []
vi.mock("./push", () => ({
  sendPush: vi.fn(async () => pushOutcomes.shift() ?? "sent"),
  isPushConfigured: () => true,
}))

import { createNotificationService } from "./index"

type Row = Record<string, unknown>

/**
 * A hand-rolled stand-in for the Supabase client, recording what the service did. Small enough to
 * read, and it keeps these tests about the service's decisions rather than about a mocking library.
 */
function fakeSupabase(options: {
  preferences?: Row | null
  subscriptions?: Row[]
  insertFails?: boolean
}) {
  const inserted: Row[] = []
  const deleted: string[][] = []

  const client = {
    from(table: string) {
      if (table === "notification_preferences") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: options.preferences ?? null }) }),
          }),
        }
      }
      if (table === "notifications") {
        return {
          insert: (row: Row) => {
            inserted.push(row)
            return {
              select: () => ({
                single: async () =>
                  options.insertFails
                    ? { data: null, error: { code: "23503" } }
                    : { data: { id: `n${inserted.length}` }, error: null },
              }),
            }
          },
        }
      }
      if (table === "push_subscriptions") {
        return {
          select: () => ({ eq: async () => ({ data: options.subscriptions ?? [] }) }),
          delete: () => ({
            in: async (_column: string, ids: string[]) => {
              deleted.push(ids)
              return { data: null, error: null }
            },
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }

  // The service only uses the handful of methods above; the cast keeps the test readable.
  return { client: client as never, inserted, deleted }
}

const request = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  category: "price" as const,
  title: "NVDA rose above $200",
  body: "Now trading at $200.10.",
  href: "/stocks/NVDA",
  ...over,
})

const SUBSCRIPTION = { id: "s1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" }

beforeEach(() => {
  pushOutcomes.length = 0
})
afterEach(() => vi.clearAllMocks())

describe("preferences", () => {
  it("delivers when the category is enabled", async () => {
    const { client, inserted } = fakeSupabase({ preferences: { price: true, push: false } })
    const result = await createNotificationService(client).deliver(request())

    expect(result.inApp).toBe(true)
    expect(inserted).toHaveLength(1)
  })

  it("suppresses a category the user turned off", async () => {
    const { client, inserted } = fakeSupabase({
      preferences: { price: false, portfolio: true, dividend: true, system: true, push: true },
    })
    const result = await createNotificationService(client).deliver(request())

    expect(result.suppressed).toBe(true)
    expect(inserted).toHaveLength(0)
  })

  it("defaults to delivering when no preferences row exists", async () => {
    // A missing row must mean the defaults, not silence.
    const { client } = fakeSupabase({ preferences: null })
    expect((await createNotificationService(client).deliver(request())).inApp).toBe(true)
  })

  it("still writes the in-app notification when push is off", async () => {
    const { client } = fakeSupabase({
      preferences: { price: true, push: false },
      subscriptions: [SUBSCRIPTION],
    })
    const result = await createNotificationService(client).deliver(request())

    expect(result.inApp).toBe(true)
    expect(result.pushSent).toBe(0)
  })
})

describe("push fan-out", () => {
  it("sends to every registered device", async () => {
    pushOutcomes.push("sent", "sent")
    const { client } = fakeSupabase({
      preferences: { price: true, push: true },
      subscriptions: [SUBSCRIPTION, { ...SUBSCRIPTION, id: "s2", endpoint: "https://push.example/2" }],
    })
    expect((await createNotificationService(client).deliver(request())).pushSent).toBe(2)
  })

  it("deletes a subscription the push service says is gone", async () => {
    // 404/410 is permanent. Keeping the row would fail on every future alert, forever.
    pushOutcomes.push("expired")
    const { client, deleted } = fakeSupabase({
      preferences: { price: true, push: true },
      subscriptions: [SUBSCRIPTION],
    })
    const result = await createNotificationService(client).deliver(request())

    expect(result.pushExpired).toBe(1)
    expect(deleted).toEqual([["s1"]])
  })

  it("counts a transient failure without deleting anything", async () => {
    pushOutcomes.push("failed")
    const { client, deleted } = fakeSupabase({
      preferences: { price: true, push: true },
      subscriptions: [SUBSCRIPTION],
    })
    const result = await createNotificationService(client).deliver(request())

    expect(result.pushFailed).toBe(1)
    expect(deleted).toEqual([])
  })

  it("still records the notification when push is unconfigured", async () => {
    pushOutcomes.push("unconfigured")
    const { client } = fakeSupabase({
      preferences: { price: true, push: true },
      subscriptions: [SUBSCRIPTION],
    })
    const result = await createNotificationService(client).deliver(request())

    expect(result.inApp).toBe(true)
    expect(result.pushSent).toBe(0)
  })

  it("does nothing extra when the user has no devices registered", async () => {
    const { client } = fakeSupabase({ preferences: { price: true, push: true }, subscriptions: [] })
    expect((await createNotificationService(client).deliver(request())).pushSent).toBe(0)
  })
})

describe("spam protection", () => {
  it("caps how many notifications one user receives in a single run", async () => {
    // A hundred alerts crossing at once must not become a hundred pushes.
    const { client, inserted } = fakeSupabase({ preferences: { price: true, push: false } })
    const service = createNotificationService(client)
    const results = await service.deliverMany(Array.from({ length: 25 }, () => request()))

    expect(inserted.length).toBe(10)
    expect(results.filter((r) => r.suppressed)).toHaveLength(15)
  })

  it("counts the cap per user, not globally", async () => {
    const { client, inserted } = fakeSupabase({ preferences: { price: true, push: false } })
    const service = createNotificationService(client)
    await service.deliverMany([
      ...Array.from({ length: 10 }, () => request({ userId: "u1" })),
      ...Array.from({ length: 3 }, () => request({ userId: "u2" })),
    ])
    expect(inserted.length).toBe(13)
  })
})

describe("failures", () => {
  it("reports a failed insert instead of pretending it delivered", async () => {
    const { client } = fakeSupabase({ preferences: { price: true, push: true }, insertFails: true })
    const result = await createNotificationService(client).deliver(request())

    expect(result.inApp).toBe(false)
    expect(result.notificationId).toBeNull()
  })
})
