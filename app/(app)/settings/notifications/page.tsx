import type { Metadata } from "next"
import { Section } from "@/components/metric"
import { PreferencesForm } from "@/features/notifications/components/preferences-form"
import { PushToggle } from "@/features/notifications/components/push-toggle"
import { getPreferences } from "@/features/notifications/queries"
import { APP_VERSION } from "@/lib/version"

export const metadata: Metadata = { title: "Notification settings" }

export default async function NotificationSettingsPage() {
  const preferences = await getPreferences()
  // Public by design — it identifies the server to the push service, not the user to anyone.
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Choose what Stockly tells you about, and how.
        </p>
      </div>

      <Section
        title="Push notifications"
        description="Per device. Enabling on your phone does not enable on your laptop."
      >
        <PushToggle vapidPublicKey={vapidPublicKey} />
      </Section>

      <Section title="What to notify me about" description="Applies to both in-app and push.">
        <PreferencesForm initial={preferences} />
      </Section>

      <p className="text-muted-foreground text-xs">
        Alerts are evaluated on a schedule, not tick by tick — a price that crosses your target and
        comes straight back may not produce a notification. Stockly v{APP_VERSION}.
      </p>
    </div>
  )
}
