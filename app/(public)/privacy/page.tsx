import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { LegalPage, LegalSection } from "../_prose"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.privacy") }
}

/**
 * Written from the code, not from a template. Every claim here corresponds to something that is
 * actually true of this application — if a claim stops being true, the code changed and so must
 * this page, in **both** languages.
 */
export default async function PrivacyPage() {
  const t = await getTranslations("legal")
  const items = (key: string) => t.raw(key) as string[]

  return (
    <LegalPage title={t("privacy.title")}>
      <LegalSection body={t("privacy.intro")} />
      <LegalSection heading={t("privacy.stored.heading")} items={items("privacy.stored.items")} />
      <LegalSection heading={t("privacy.notStored.heading")} items={items("privacy.notStored.items")} />
      <LegalSection heading={t("privacy.access.heading")} body={t("privacy.access.body")} />
      <LegalSection
        heading={t("privacy.thirdParties.heading")}
        items={items("privacy.thirdParties.items")}
      />
      <LegalSection heading={t("privacy.logs.heading")} body={t("privacy.logs.body")} />
      <LegalSection heading={t("privacy.offline.heading")} body={t("privacy.offline.body")} />
      <LegalSection heading={t("privacy.retention.heading")} items={items("privacy.retention.items")} />
      <LegalSection heading={t("privacy.contact.heading")} body={t("privacy.contact.body")} />
    </LegalPage>
  )
}
