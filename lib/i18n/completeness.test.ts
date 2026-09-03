import { execSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SUPPORTED_LOCALES, type Locale } from "@/domain/locale"
import { ERROR_CODES, ERROR_DETAILS } from "@/lib/api-codes"
import { NAMESPACES, type Namespace } from "./namespaces"

/**
 * The test that stops a missing translation reaching production.
 *
 * `lib/i18n/request.ts` has a fallback for a key that does not exist — it renders the key path
 * rather than taking the page down — but a fallback is a net, not a guarantee. This is the
 * guarantee. Every rule below exists because it describes a way a bilingual application silently
 * degrades into a monolingual one with gaps:
 *
 * - a key added in English and forgotten in Thai
 * - a namespace file created on disk and never imported, so nothing in it is ever reachable
 * - a translation that is present but empty, which renders as nothing at all and looks like a
 *   layout bug rather than a missing string
 * - an interpolation placeholder that survives one language and is dropped in the other, so
 *   `{count}` appears verbatim on screen in exactly one locale
 *
 * The suite reads the filesystem rather than the barrels' exports, so a file that exists but is
 * unreferenced is caught rather than skipped.
 */

const ROOT = join(process.cwd(), "locales")

type Messages = { [key: string]: string | Messages }

function read(locale: Locale, namespace: Namespace): Messages {
  return JSON.parse(readFileSync(join(ROOT, locale, `${namespace}.json`), "utf8")) as Messages
}

/** Every leaf, as a dotted path — the shape a `t()` call actually uses. */
function paths(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? paths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

function leaves(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? leaves(value, `${prefix}${key}.`)
      : ([[`${prefix}${key}`, value as string]] as [string, string][]),
  )
}

/**
 * The placeholders a message declares — the set of values its caller has to supply.
 *
 * ICU plural and select **arms** are removed first, by brace matching, because their inner braces
 * are syntax rather than interpolation and they legitimately differ between languages: Thai has one
 * plural form and English has two, so `one {…}` exists in one file and not the other.
 *
 * Brace matching rather than a regex, because the first attempt at this cut the message at the
 * plural block and lost every placeholder *after* it — which then reported a real message as
 * broken. A nested `{count, plural, one {# holding} other {# holdings}} … {currency}` is exactly
 * the shape that exposed it.
 */
function placeholders(message: string): string[] {
  let out = ""
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] !== "{") {
      out += message[i]
      continue
    }

    // Read the whole `{…}` block, tracking depth so nested arms are consumed with it.
    let depth = 0
    let end = i
    for (; end < message.length; end += 1) {
      if (message[end] === "{") depth += 1
      else if (message[end] === "}" && --depth === 0) break
    }
    const block = message.slice(i, end + 1)
    const name = /^\{\s*([a-zA-Z0-9_]+)/.exec(block)?.[1]
    // Keep the argument name; drop everything the arms contain.
    out += name ? `{${name}}` : ""
    i = end
  }

  /*
   * A **set**, not a list. English says `{count, plural, one {is} other {are}}` and so mentions
   * `count` twice, where Thai has no verb agreement and mentions it once. Both need the same value
   * supplied, which is the only thing this check is about.
   */
  return [...new Set([...out.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*\}/g)].map((match) => match[1]))].sort()
}

describe("translation files", () => {
  it("every namespace exists as a file in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const onDisk = readdirSync(join(ROOT, locale))
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(/\.json$/, ""))
        .sort()
      expect(onDisk, `locales/${locale}`).toEqual([...NAMESPACES].sort())
    }
  })

  it("every namespace is imported by every locale barrel", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const barrel = readFileSync(join(ROOT, locale, "index.ts"), "utf8")
      for (const namespace of NAMESPACES) {
        expect(barrel, `locales/${locale}/index.ts`).toContain(`from "./${namespace}.json"`)
        // Present in the exported object too, not merely imported.
        expect(barrel, `locales/${locale}/index.ts`).toMatch(
          new RegExp(`^\\s*${namespace},$`, "m"),
        )
      }
    }
  })

  /*
   * Both directions, deliberately.
   *
   * "Every English key exists in Thai" alone would let a Thai-only key survive — a string a Thai
   * reader sees and an English reader does not, which is the same bug wearing the other hat.
   */
  it.each(NAMESPACES)("%s has the same keys in both languages", (namespace) => {
    const en = paths(read("en", namespace)).sort()
    const th = paths(read("th", namespace)).sort()

    expect(th.filter((key) => !en.includes(key)), `missing from en/${namespace}.json`).toEqual([])
    expect(en.filter((key) => !th.includes(key)), `missing from th/${namespace}.json`).toEqual([])
  })

  it.each(NAMESPACES)("%s has no empty translations", (namespace) => {
    for (const locale of SUPPORTED_LOCALES) {
      const empty = leaves(read(locale, namespace))
        .filter(([, value]) => typeof value !== "string" || value.trim() === "")
        .map(([key]) => key)
      expect(empty, `empty in ${locale}/${namespace}.json`).toEqual([])
    }
  })

  it.each(NAMESPACES)("%s declares the same placeholders in both languages", (namespace) => {
    const en = new Map(leaves(read("en", namespace)))
    const th = new Map(leaves(read("th", namespace)))

    for (const [key, value] of en) {
      const other = th.get(key)
      if (other === undefined) continue // reported by the key-parity test
      expect(placeholders(other), `${namespace}.${key}`).toEqual(placeholders(value))
    }
  })

  /*
   * A Thai file with no Thai in it is an untranslated file that passes every other check here.
   *
   * Not every value can be Thai — a brand name, an ISO code, "N/A" — so this asserts a proportion
   * rather than each string, which is enough to catch a namespace that was copied across and never
   * translated. `common.json` is 139 keys; a copied one would score near zero.
   */
  it.each(NAMESPACES)("%s is actually translated into Thai", (namespace) => {
    const values = leaves(read("th", namespace)).map(([, value]) => value)
    if (values.length < 8) return // too small a sample to say anything

    const thai = values.filter((value) => /[฀-๿]/.test(value))
    expect(thai.length / values.length, `th/${namespace}.json looks untranslated`).toBeGreaterThan(0.5)
  })
})

/**
 * The API's two vocabularies must both have words, in both languages.
 *
 * A code with no sentence renders as a key path on screen, and a sentence with no code is dead
 * weight that nobody notices going stale. Checking both directions catches each.
 */
describe("the API error vocabularies are fully translated", () => {
  const en = JSON.parse(readFileSync(join(ROOT, "en", "errors.json"), "utf8")) as {
    code: Record<string, string>
    detail: Record<string, string>
  }
  const th = JSON.parse(readFileSync(join(ROOT, "th", "errors.json"), "utf8")) as typeof en

  it("has a sentence for every status code", () => {
    for (const code of Object.keys(ERROR_CODES)) {
      expect(en.code[code]?.length, `en ${code}`).toBeGreaterThan(0)
      expect(th.code[code]?.length, `th ${code}`).toBeGreaterThan(0)
    }
  })

  it("has a sentence for every detail", () => {
    for (const detail of ERROR_DETAILS) {
      expect(en.detail[detail]?.length, `en ${detail}`).toBeGreaterThan(0)
      expect(th.detail[detail]?.length, `th ${detail}`).toBeGreaterThan(0)
    }
  })

  it("has no sentence for a code or detail that does not exist", () => {
    expect(Object.keys(en.code).filter((k) => !(k in ERROR_CODES))).toEqual([])
    expect(Object.keys(en.detail).filter((k) => !(ERROR_DETAILS as readonly string[]).includes(k))).toEqual([])
  })

  /*
   * The whole point of the detail vocabulary: every route that throws one must name a key the
   * client knows. A typo here is a page that shows `errors.detail.dupliactePortfolioName`.
   */
  it("is the only vocabulary the route handlers throw", () => {
    const source = execSync("grep -rho 'new ApiError([^)]*)' app features", { encoding: "utf8" })
    const thrown = [...source.matchAll(/new ApiError\(\s*"[A-Z_]+",\s*"[^"]*",\s*"([a-zA-Z]+)"/g)].map(
      (match) => match[1],
    )
    expect(thrown.length, "no ApiError carries a detail — did the shape change?").toBeGreaterThan(20)
    for (const detail of new Set(thrown)) {
      expect(ERROR_DETAILS as readonly string[], `unknown detail: ${detail}`).toContain(detail)
    }
  })
})
