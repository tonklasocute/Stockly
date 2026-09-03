/**
 * Find user-facing strings that are still hardcoded.
 *
 * Not a parser — a set of shapes. It looks only where user-facing text actually lives in this
 * codebase, which keeps the false-positive rate low enough to read:
 *
 *   - JSX text nodes                          >Save<
 *   - JSX string attributes that a user reads  aria-label="…" placeholder="…" title="…" label="…"
 *   - toast/Error/throw arguments              toast.error("…")
 *   - object literals with a `label`/`title`/`description` key
 *
 * It deliberately ignores: className, imports, enum values, symbols, test ids, keys already inside
 * a t() call, and anything already Thai (which would mean it has been migrated by hand).
 *
 * Usage: node scripts/i18n-extract.mjs <path…>
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"

const TEXT_PROPS = /\b(aria-label|aria-description|placeholder|title|label|description|alt|summary|emptyLabel|confirmLabel|cancelLabel)=(?:"([^"\n]{2,200})"|\{"([^"\n]{2,200})"\})/g
const JSX_TEXT = />\s*([A-Za-z][^<>{}\n]{1,200}?)\s*</g
/*
 * `new ApiError(code, message, detail)` is deliberately excluded.
 *
 * Its `message` is written for a log and for a developer — the *user* sees the translated `detail`
 * or `code`, and `lib/i18n/completeness.test.ts` is what guarantees those exist in both languages.
 * Reporting these as untranslated text would be reporting 64 false positives forever.
 */
const CALLS = /\b(?:toast\.(?:success|error|info|warning|message)|new Error|throw new Error)\s*\(?\s*"([^"\n]{3,200})"/g
const OBJ_KEYS = /\b(label|title|description|heading|hint|note|caption|summary)\s*:\s*"([^"\n]{2,200})"/g

const isNoise = (s) =>
  !s ||
  s.length < 2 ||
  /^[A-Z0-9_]+$/.test(s) ||                                  // ENUM_VALUE
  /^[\d\s.,%$฿+\-–—/:()|]+$/.test(s) ||                       // punctuation / numbers
  /[฀-๿]/.test(s) ||                                          // already Thai
  /\b(flex|grid|text-|bg-|px-|py-|mt-|mb-|ml-|mr-|w-|h-|size-|rounded|border|gap-|items-|justify-|sm:|md:|lg:|font-|shadow|hover:|dark:|max-|min-|space-|absolute|relative|truncate|tabular)\b/.test(s) ||
  /^(https?:|\/|\.|@|#|use client|use server)/.test(s) ||
  /^[a-z][a-zA-Z0-9]*$/.test(s) ||                            // an identifier
  /^[a-z0-9-]+$/.test(s) ||                                   // a slug
  !/[a-zA-Z]/.test(s)

const files = process.argv.slice(2).flatMap((p) =>
  execSync(`find '${p}' -type f \\( -name '*.tsx' -o -name '*.ts' \\) ! -name '*.test.ts' ! -name '*.test.tsx'`, {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean),
)

const out = []
for (const file of files) {
  const raw = readFileSync(file, "utf8")
  // Strip comments so prose in a doc comment is not reported as UI text.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1")

  const hits = new Set()
  for (const re of [TEXT_PROPS, JSX_TEXT, CALLS, OBJ_KEYS]) {
    re.lastIndex = 0
    for (const m of src.matchAll(re)) {
      const value = (m[2] ?? m[1] ?? "").trim()
      if (!isNoise(value)) hits.add(value)
    }
  }
  if (hits.size) out.push({ file, strings: [...hits] })
}

const total = out.reduce((n, f) => n + f.strings.length, 0)
if (process.env.SUMMARY) {
  for (const { file, strings } of out.sort((a, b) => b.strings.length - a.strings.length)) {
    console.log(String(strings.length).padStart(4), file)
  }
  console.log("---", total, "strings in", out.length, "files")
} else {
  for (const { file, strings } of out) {
    console.log(`### ${file}`)
    for (const s of strings) console.log(`  ${s}`)
  }
  console.log(`\n--- ${total} strings in ${out.length} files`)
}
