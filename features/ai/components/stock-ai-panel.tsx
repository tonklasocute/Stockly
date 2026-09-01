"use client"

import { useMutation } from "@tanstack/react-query"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import { AIAnswerView, type AIAnswer } from "./ai-answer"

/**
 * "Analyse with Stockly AI" on a stock page.
 *
 * Opt-in, never automatic. An AI call costs money and takes seconds, so rendering the page must not
 * trigger one — a user who never presses the button never spends a token.
 */
export function StockAIPanel({ symbol, enabled }: { symbol: string; enabled: boolean }) {
  const analyze = useMutation({
    mutationFn: () =>
      apiFetch<AIAnswer>("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ symbol }),
      }),
  })

  if (!enabled) {
    return (
      <p className="text-muted-foreground text-sm">
        Stockly AI is turned off for this deployment. The technical data above is unaffected.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {!analyze.data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            A written summary of {symbol}&apos;s technical profile, from the same data shown above.
          </p>
          <Button
            className="gap-2"
            disabled={analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {analyze.isPending ? `Analysing ${symbol}…` : "Analyse with Stockly AI"}
          </Button>
        </div>
      )}

      {analyze.isError && (
        <div className="space-y-2 rounded-xl border border-dashed p-3.5">
          <p className="text-sm">{(analyze.error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => analyze.mutate()}>
            Try again
          </Button>
        </div>
      )}

      {analyze.data && <AIAnswerView answer={analyze.data} />}
    </div>
  )
}
