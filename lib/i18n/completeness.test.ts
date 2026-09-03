import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SUPPORTED_LOCALES, type Locale } from "@/domain/locale"
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
 * The placeholders a message declares.
 *
 * ICU plural and select blocks are stripped first, because their *inner* braces are syntax rather
 * than interpolation and their arms legitimately differ between languages — Thai has one plural
 * form and English has two, so `one {...}` exists in one file and not the other. What must match is
 * the set of values the caller has to supply.
 */
function placeholders(message: string): string[] {
  const withoutArms = message.replace(/,\s*(plural|select|selectordinal)\s*,[\s\S]*$/g, "")
  return [...withoutArms.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)]
    .map((match) => match[1])
    .sort()
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
