import { getTranslations } from "next-intl/server"

/**
 * Shared typography for the three legal pages, so they cannot drift apart visually — and one place
 * to state the date they were last changed.
 *
 * The date is a constant, not a translation: it is a fact about the document, and a date that could
 * differ between two languages would mean two documents.
 */
export const LAST_UPDATED = "2026-09-02"

export async function LegalPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const t = await getTranslations("legal")

  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{t("lastUpdated", { date: LAST_UPDATED })}</p>
      </header>
      <div className="space-y-6 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_section]:space-y-2 [&_ul]:space-y-1.5">
        {children}
      </div>
    </article>
  )
}

/**
 * A heading and its paragraphs, or a heading and a list.
 *
 * Legal prose is the one place in this application where the *structure* is worth having in the
 * translation file rather than in the component: a section is a heading plus a body, and a
 * translator editing `legal.json` should not have to touch a `.tsx` file to fix a sentence. The
 * lists come back through `t.raw`, which is next-intl's way of reading a JSON array — and the
 * completeness test walks arrays as ordinary keys, so a list with four items in English and three
 * in Thai is a failing test.
 */
export function LegalSection({
  heading,
  body,
  items,
}: {
  heading?: string
  body?: string | string[]
  items?: string[]
}) {
  const paragraphs = body === undefined ? [] : Array.isArray(body) ? body : [body]

  return (
    <section>
      {heading ? <h2>{heading}</h2> : null}
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {items ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
