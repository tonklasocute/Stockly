import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { LegalPage, LegalSection } from "../_prose"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.terms") }
}

export default async function TermsPage() {
  const t = await getTranslations("legal")
  const items = (key: string) => t.raw(key) as string[]

  return (
    <LegalPage title={t("terms.title")}>
      <LegalSection body={t("terms.intro")} />

      {/* The one section with a link in it, so it is written out rather than driven by the helper. */}
      <section>
        <h2>{t("terms.what.heading")}</h2>
        <p>
          {t("terms.what.body")}{" "}
          <Link href="/disclaimer" className="underline underline-offset-4">
            {t("terms.what.link")}
          </Link>
          .
        </p>
      </section>

      <LegalSection heading={t("terms.account.heading")} items={items("terms.account.items")} />
      <LegalSection
        heading={t("terms.acceptableUse.heading")}
        items={items("terms.acceptableUse.items")}
      />
      <LegalSection heading={t("terms.availability.heading")} body={t("terms.availability.body")} />
      <LegalSection heading={t("terms.marketData.heading")} body={t("terms.marketData.body")} />
      <LegalSection heading={t("terms.liability.heading")} body={t("terms.liability.body")} />
      <LegalSection heading={t("terms.changes.heading")} body={t("terms.changes.body")} />
    </LegalPage>
  )
}
