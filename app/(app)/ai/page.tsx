import type { Metadata } from "next"
import { AIChat } from "@/features/ai/components/ai-chat"
import { listConversations } from "@/features/ai/queries"
import { isAIEnabled } from "@/services/ai"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("ai") }
}

/**
 * The research assistant.
 *
 * `isAIEnabled()` is read on the server, so the flag and the provider name never reach the browser
 * — the page renders a switched-off state without the client learning anything about the
 * configuration beyond "off".
 */
export default async function AIPage() {
  const tNav = await getTranslations("navigation")
  const enabled = isAIEnabled()
  const conversations = await listConversations().catch(() => [])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("ai")}</h1>
        <p className="text-muted-foreground text-sm">
          Research your stocks in plain language. Every figure comes from Stockly&apos;s own market,
          technical and portfolio data.
        </p>
      </div>

      <AIChat conversations={conversations} aiEnabled={enabled} />
    </div>
  )
}
