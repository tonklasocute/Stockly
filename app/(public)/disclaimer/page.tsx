import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { LegalPage, LegalSection } from "../_prose"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.disclaimer") }
}

export default async function DisclaimerPage() {
  const t = await getTranslations("legal")

  return (
    <LegalPage title={t("disclaimer.title")}>
      <section>
        <p className="font-medium">{t("disclaimer.intro")}</p>
      </section>

      <LegalSection heading={t("disclaimer.notAdvice.heading")} body={t("disclaimer.notAdvice.body")} />
      <LegalSection heading={t("disclaimer.technical.heading")} body={t("disclaimer.technical.body")} />
      <LegalSection
        heading={t("disclaimer.assistant.heading")}
        body={[t("disclaimer.assistant.body1"), t("disclaimer.assistant.body2")]}
      />
      <LegalSection heading={t("disclaimer.records.heading")} body={t("disclaimer.records.body")} />
      <LegalSection heading={t("disclaimer.alerts.heading")} body={t("disclaimer.alerts.body")} />
    </LegalPage>
  )
}
