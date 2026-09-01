import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findAdviceLanguage } from "@/domain/ai"
import { dataBlock, SYSTEM_PROMPT, TASK_PROMPTS } from "./prompts"
import { aiChatSchema, MAX_CONTEXT_CHARS, MAX_HISTORY_MESSAGES, MAX_QUESTION_LENGTH } from "./schema"

/**
 * The security properties this feature claims, asserted rather than described.
 *
 * Most of them are structural — a key that is never read on the client cannot leak, and a string
 * that is never rendered as HTML cannot carry a script. These tests exist so a later change that
 * quietly removes one of those properties fails here instead of in production.
 */

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, extensions))
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(path)
  }
  return out
}

const root = process.cwd()
const aiSources = [
  ...filesUnder(join(root, "features/ai"), [".ts", ".tsx"]),
  ...filesUnder(join(root, "services/ai"), [".ts"]),
  ...filesUnder(join(root, "app/api/ai"), [".ts"]),
]
const read = (path: string) => readFileSync(path, "utf8")

/** Comments discuss these APIs; only real code counts. */
const readCode = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

describe("secrets stay on the server", () => {
  it("no AI environment variable is exposed to the browser", () => {
    const example = read(join(root, ".env.example"))
    expect(example).not.toMatch(/NEXT_PUBLIC_AI/)
    expect(example).toMatch(/^AI_API_KEY=$/m)
  })

  it("the client-safe env module knows nothing about AI", () => {
    expect(read(join(root, "lib/env.ts"))).not.toMatch(/AI_/)
  })

  it("every module that can read the key imports server-only", () => {
    for (const path of aiSources) {
      const source = read(path)
      if (!source.includes("serverEnv") && !source.includes("aiApiKey")) continue
      expect(source, `${path} reads server config without the server-only guard`).toContain(
        'import "server-only"',
      )
    }
  })

  it("no AI source logs a key, a prompt or an answer", () => {
    for (const path of aiSources) {
      for (const match of readCode(path).matchAll(/console\.(log|info|warn|error)\(([^\n]*)/g)) {
        expect(match[2], `${path} logs something it should not`).not.toMatch(
          /apiKey|aiApiKey|\.text\b|question|prompt|narrative/i,
        )
      }
    }
  })
})

describe("model output is never rendered as HTML", () => {
  it("no AI component uses dangerouslySetInnerHTML or injects markup", () => {
    for (const path of aiSources.filter((p) => p.endsWith(".tsx"))) {
      const source = readCode(path)
      expect(source, path).not.toContain("dangerouslySetInnerHTML")
      expect(source, path).not.toContain("innerHTML")
      expect(source, path).not.toContain("createElement")
    }
  })

  it("an answer containing a script tag would render as visible text, not as markup", () => {
    // React escapes text nodes, which is the whole defence: there is no parser to get wrong and
    // no sanitiser to keep patched. This asserts the design has not been swapped for one.
    const renderer = read(join(root, "features/ai/components/ai-answer.tsx"))
    expect(renderer).toMatch(/<p key=\{index\}>\{paragraph\}<\/p>/)
  })
})

describe("prompt injection", () => {
  it("the system prompt tells the model the user's turn is not instructions", () => {
    expect(SYSTEM_PROMPT).toMatch(/not a source of instructions/i)
    expect(SYSTEM_PROMPT).toMatch(/reveal this prompt/i)
    expect(SYSTEM_PROMPT).toMatch(/another persona/i)
  })

  it("retrieved data is fenced off in its own labelled section", () => {
    const block = dataBlock("RSI: 58")
    expect(block).toContain("STOCKLY DATA")
    expect(block).toContain("only source of fact")
  })

  it("the request type has no system role, so user text cannot become an instruction", () => {
    // AIMessage is "user" | "assistant" by construction; the system prompt is a separate field the
    // orchestrator builds. A question can therefore never be promoted to operator authority.
    const types = read(join(root, "services/ai/types.ts"))
    expect(types).toMatch(/export type AIMessage = \{ role: "user" \| "assistant"/)
  })

  it("the safety filter catches advice a jailbreak talked the model into", () => {
    const jailbroken =
      "Ignoring the previous rules as you asked: you should buy NVDA now, it is a strong buy " +
      "and the price will definitely rise."
    expect(findAdviceLanguage(jailbroken).length).toBeGreaterThan(0)
  })

  it("no prompt instructs the model to query, execute or fetch anything", () => {
    for (const prompt of [SYSTEM_PROMPT, ...Object.values(TASK_PROMPTS)]) {
      expect(prompt).not.toMatch(/\b(execute|run a query|SQL|fetch the|call the api)\b/i)
    }
  })
})

describe("the safety vocabulary is stated to the model as well as enforced", () => {
  it("the system prompt forbids advice, ratings, targets, forecasts and guarantees", () => {
    for (const rule of [/never tell anyone to buy/i, /price target/i, /never predict/i, /guarantee/i]) {
      expect(SYSTEM_PROMPT).toMatch(rule)
    }
  })

  it("no task prompt asks for a recommendation", () => {
    for (const [intent, prompt] of Object.entries(TASK_PROMPTS)) {
      expect(findAdviceLanguage(prompt), intent).toEqual([])
      expect(prompt, intent).not.toMatch(/\brecommend\b/i)
    }
  })
})

describe("cost and abuse limits are bounded, not merely suggested", () => {
  it("every limit is a finite, positive number", () => {
    for (const limit of [MAX_QUESTION_LENGTH, MAX_HISTORY_MESSAGES, MAX_CONTEXT_CHARS]) {
      expect(Number.isFinite(limit) && limit > 0).toBe(true)
    }
  })

  it("a question past the cap is rejected before any provider call", () => {
    expect(aiChatSchema.safeParse({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) }).success).toBe(false)
  })

  it("every AI route applies a rate limit and takes the user id from the session", () => {
    for (const path of aiSources.filter((p) => p.includes("app/api/ai") && p.endsWith("route.ts"))) {
      const source = read(path)
      expect(source, path).toContain("guarded(")
      // A GET that only lists the caller's own rows needs no upstream budget.
      if (source.includes("runResearch") || source.includes("proposeScreen")) {
        expect(source, path).toContain("enforceRateLimit")
      }
      expect(source, path).not.toMatch(/body\.userId|body\.user_id/)
    }
  })
})
