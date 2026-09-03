import type { Metadata } from "next"
import { Section } from "@/components/metric"
import { PreferencesForm } from "@/features/notifications/components/preferences-form"
import { PushToggle } from "@/features/notifications/components/push-toggle"
import { getPreferences } from "@/features/notifications/queries"
import { APP_VERSION } from "@/lib/version"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("pages.notificationSettings") }
}

export default async function NotificationSettingsPage() {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("settings")
  const preferences = await getPreferences()
  // Public by design — it identifies the server to the push service, not the user to anyone.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("notifications")}</h1>
        <p className="text-muted-foreground text-sm">{t("notificationsHint")}</p>
      </div>

      <Section
        title={t("push.title")}
        description={t("push.hint")}
      >
        <PushToggle vapidPublicKey={vapidPublicKey} />
      </Section>

      <Section title={t("whatToNotify")} description={t("appliesToBoth")}>
        <PreferencesForm initial={preferences} />
      </Section>

      <p className="text-muted-foreground text-xs">
        Alerts are evaluated on a schedule, not tick by tick — a price that crosses your target and
        comes straight back may not produce a notification. Stockly v{APP_VERSION}.
      </p>
    </div>
  )
}
