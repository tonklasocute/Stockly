import { inflateRawSync } from "node:zlib"

/**
 * A minimal, dependency-free `.xlsx` reader.
 *
 * **Why not a library.** SheetJS's npm package has been at 0.18.5 since 2022 with open ReDoS and
 * prototype-pollution advisories, and `npm run audit:ci` fails on a high-severity runtime
 * dependency — so adding it would break the build it is supposed to help. ExcelJS is maintained but
 * is a megabyte and ten transitive packages to read a few cells out of a broker export. This file
 * is the same trade the project already made for `toCsv`: a hundred lines instead of a dependency.
 *
 * **What an .xlsx actually is**: a ZIP containing XML. Node ships `zlib`, so the only real work is
 * walking the ZIP central directory and pulling four entries out of it:
 *
 *   xl/workbook.xml            sheet names, in order
 *   xl/_rels/workbook.xml.rels sheet name -> file path
 *   xl/sharedStrings.xml       the string table most cells point into
 *   xl/worksheets/sheetN.xml   the cells
 *
 * `ponytail:` ceiling — this reads **values, never formulas**. A cell holding `=SUM(A1:A9)` is read
 * as whatever value Excel last cached in it; if there is none, the cell is empty and the row fails
 * validation with its number attached. That is the right behaviour for financial import: a formula
 * Stockly cannot evaluate must not become a number it pretends to know. Styling, merged cells,
 * pivot tables and charts are all ignored, because none of them is data.
 */

// ---------------------------------------------------------------- zip

const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const SIGNATURE_CENTRAL_FILE = 0x02014b50

/** Deflate (8) and stored (0) are the only methods a spreadsheet writer uses. */
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

export class XlsxError extends Error {
  constructor(
    readonly code:
      | "NOT_A_ZIP"
      | "UNSUPPORTED_COMPRESSION"
      | "CORRUPT"
      | "NO_WORKSHEET"
      | "TOO_LARGE",
    message: string,
  ) {
    super(message)
    this.name = "XlsxError"
  }
}

/** A guard against a zip bomb: a few megabytes of XML is already a very large spreadsheet. */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024

/**
 * Reads the ZIP central directory and returns the entries by name.
 *
 * The central directory is read rather than the local headers because only it is authoritative
 * about sizes — a local header may carry zeroes and defer to a data descriptor, which is exactly
 * the shape a streaming writer produces.
 */
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is last, after a comment of up to 64 KB.
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === SIGNATURE_END_OF_CENTRAL_DIRECTORY) {
      end = i
      break
    }
  }
  if (end < 0) throw new XlsxError("NOT_A_ZIP", "That file is not a valid .xlsx workbook.")

  const entryCount = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const entries = new Map<string, Buffer>()

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) throw new XlsxError("CORRUPT", "The workbook is damaged.")
    if (buffer.readUInt32LE(offset) !== SIGNATURE_CENTRAL_FILE) {
      throw new XlsxError("CORRUPT", "The workbook is damaged.")
    }

    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength)

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new XlsxError("TOO_LARGE", "That workbook is too large to import.")
    }

    // Only the entries this reader needs are inflated; a workbook full of images stays untouched.
    if (wanted(name)) {
      entries.set(name, readLocalEntry(buffer, localOffset, method, compressedSize))
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function wanted(name: string): boolean {
  return (
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    name === "xl/sharedStrings.xml" ||
    // Styles decide which numeric cells are dates. Without it every date reads as a serial number.
    name === "xl/styles.xml" ||
    name.startsWith("xl/worksheets/")
  )
}

function readLocalEntry(
  buffer: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
): Buffer {
  // The local header's name and extra lengths can differ from the central directory's, so they are
  // read again here rather than reused.
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLength + extraLength
  const data = buffer.subarray(start, start + compressedSize)

  if (method === METHOD_STORED) return Buffer.from(data)
  if (method !== METHOD_DEFLATE) {
    throw new XlsxError("UNSUPPORTED_COMPRESSION", "That workbook uses an unsupported compression.")
  }
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })
  } catch {
    throw new XlsxError("CORRUPT", "The workbook is damaged.")
  }
}

// ---------------------------------------------------------------- xml

/**
 * Enough XML to read a spreadsheet, and no more.
 *
 * A real parser is unnecessary here: the shapes are fixed and machine-generated. What does matter
 * is entity decoding — a company name containing `&amp;` must come back as `&`, or every symbol
 * lookup for it fails.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // Ampersand last, so `&amp;lt;` does not become `<`.
    .replace(/&amp;/g, "&")
}

/** The text of every `<t>` in a fragment, concatenated — a shared string can be split by runs. */
function textOf(fragment: string): string {
  const parts = fragment.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)
  if (!parts) return ""
  return parts
    .map((part) => decodeEntities(part.replace(/^<t(?:\s[^>]*)?>/, "").replace(/<\/t>$/, "")))
    .join("")
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`))
  return match ? decodeEntities(match[1]) : null
}

// ---------------------------------------------------------------- workbook

export type Worksheet = {
  name: string
  /** Rows of cell text, ragged: a row is only as long as its last non-empty cell. */
  rows: string[][]
}

export type Workbook = {
  sheets: Worksheet[]
}

/** `A1` -> 0, `B1` -> 1, `AA1` -> 26. Cells can be sparse, so the column index is load-bearing. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A"
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/**
 * Excel's serial date to an ISO date.
 *
 * The epoch is 1899-12-30, not 1900-01-01, because Excel deliberately reproduces a Lotus 1-2-3 bug
 * that treats 1900 as a leap year. Shifting the epoch back two days is the standard way to absorb
 * it, and it is correct for every date after 1900-03-01 — which is every date a transaction has.
 *
 * Fractional days become a time, and are dropped: Stockly stores a trade *date*, and inventing a
 * time from a spreadsheet's rounding would be precision the source does not have.
 */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  // Serials 1–60 fall inside the Lotus bug's shadow — 60 is the 29th of February 1900, a day that
  // did not exist — so the epoch shift is off by one for them. Rather than reimplement the bug for
  // dates no trade has, anything before 1900-03-01 is refused. The cell then keeps its raw value
  // and fails date validation loudly, which is the right outcome for a number that is not a date.
  if (serial < 61 || serial > 2_958_465) return null
  const at = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10)
}

/**
 * Cells whose number format makes them a date.
 *
 * Built-in formats 14–22 and 45–47 are dates and times; anything else is checked for a date token
 * in a custom format string. Getting this wrong in the safe direction leaves a serial number in the
 * cell, which fails date validation loudly — better than a number silently read as 2015.
 */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function dateStyleIndexes(stylesXml: string | undefined): Set<number> {
  const dateStyles = new Set<number>()
  if (!stylesXml) return dateStyles

  const customDateFormats = new Set<number>()
  for (const tag of stylesXml.match(/<numFmt\b[^>]*\/?>/g) ?? []) {
    const id = Number(attribute(tag, "numFmtId"))
    const code = attribute(tag, "formatCode") ?? ""
    // A format containing y, d, or a month token is a date. `h`/`s` alone is a duration.
    if (Number.isFinite(id) && /[yd]|mm?m|m\/|\/m/i.test(code)) customDateFormats.add(id)
  }

  const cellXfs = stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? ""
  const entries = cellXfs.match(/<xf\b[^>]*\/?>/g) ?? []
  entries.forEach((tag, index) => {
    const id = Number(attribute(tag, "numFmtId") ?? "0")
    if (BUILT_IN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index)
  })
  return dateStyles
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  return (xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? []).map(textOf)
}

function parseSheet(
  xml: string,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
): string[][] {
  const rows: string[][] = []

  for (const rowXml of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const cells: string[] = []

    for (const cellXml of rowXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const openTag = cellXml.match(/^<c\b[^>]*>/)?.[0] ?? cellXml
      const reference = attribute(openTag, "r") ?? ""
      const type = attribute(openTag, "t")
      const styleIndex = Number(attribute(openTag, "s") ?? "-1")
      const index = reference ? columnIndex(reference) : cells.length

      let value = ""
      if (type === "inlineStr") {
        value = textOf(cellXml)
      } else if (type === "s") {
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""
        value = sharedStrings[Number(raw)] ?? ""
      } else {
        // `t="str"` is a cached formula result; a numeric or boolean cell has no `t` at all. In
        // every case the <v> is the value Excel last stored — never the formula in <f>, which this
        // reader deliberately ignores.
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        if (raw !== undefined) {
          const text = decodeEntities(raw)
          if (type === "b") {
            value = text === "1" ? "TRUE" : "FALSE"
          } else if (!type && dateStyles.has(styleIndex)) {
            value = excelSerialToIsoDate(Number(text)) ?? text
          } else {
            value = text
          }
        }
      }

      // Sparse rows: `<c r="C1">` after `<c r="A1">` means B1 is empty, not absent.
      while (cells.length < index) cells.push("")
      cells[index] = value
    }

    if (cells.some((cell) => cell.trim() !== "")) rows.push(cells)
  }

  return rows
}

/**
 * Reads a workbook into sheets of cell text.
 *
 * Everything comes out as a string, exactly like the CSV parser, so the import layer sees one shape
 * and a bad value becomes a validation error against a row number rather than a silent coercion.
 */
export function readWorkbook(file: Buffer | ArrayBuffer | Uint8Array): Workbook {
  const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file as ArrayBuffer)
  const entries = readZipEntries(buffer)

  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8")
  if (!workbookXml) throw new XlsxError("NOT_A_ZIP", "That file is not a valid .xlsx workbook.")

  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? ""
  const targetByRelId = new Map<string, string>()
  for (const tag of relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = attribute(tag, "Id")
    const target = attribute(tag, "Target")
    if (id && target) targetByRelId.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""))
  }

  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"))
  const dateStyles = dateStyleIndexes(entries.get("xl/styles.xml")?.toString("utf8"))

  const sheets: Worksheet[] = []
  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []

  sheetTags.forEach((tag, position) => {
    const name = attribute(tag, "name") ?? `Sheet${position + 1}`
    const relId = attribute(tag, "r:id") ?? attribute(tag, "id")
    const target = relId ? targetByRelId.get(relId) : undefined
    const path = target ? `xl/${target}` : `xl/worksheets/sheet${position + 1}.xml`
    const sheetXml =
      entries.get(path)?.toString("utf8") ??
      entries.get(`xl/worksheets/sheet${position + 1}.xml`)?.toString("utf8")

    // A sheet whose XML is missing is skipped rather than throwing: the other sheets are still
    // importable, and the caller reports which names it found.
    if (sheetXml) sheets.push({ name, rows: parseSheet(sheetXml, sharedStrings, dateStyles) })
  })

  if (sheets.length === 0) throw new XlsxError("NO_WORKSHEET", "That workbook has no readable sheets.")
  return { sheets }
}

/** Whether a buffer looks like a ZIP at all, so a mislabelled CSV fails with a useful message. */
export function looksLikeXlsx(file: Buffer | Uint8Array): boolean {
  return file.length > 4 && file[0] === 0x50 && file[1] === 0x4b
}
