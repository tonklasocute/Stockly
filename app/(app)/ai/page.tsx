import type { Metadata } from "next"
import { AIChat } from "@/features/ai/components/ai-chat"
import { listConversations } from "@/features/ai/queries"
import { isAIEnabled } from "@/services/ai"

export const metadata: Metadata = { title: "Stockly AI" }

/**
 * The research assistant.
 *
 * `isAIEnabled()` is read on the server, so the flag and the provider name never reach the browser
 * — the page renders a switched-off state without the client learning anything about the
 * configuration beyond "off".
 */
export default async function AIPage() {
  const enabled = isAIEnabled()
  const conversations = await listConversations().catch(() => [])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Stockly AI</h1>
        <p className="text-muted-foreground text-sm">
          Research your stocks in plain language. Every figure comes from Stockly&apos;s own market,
          technical and portfolio data.
        </p>
      </div>

      <AIChat conversations={conversations} aiEnabled={enabled} />
    </div>
  )
}
