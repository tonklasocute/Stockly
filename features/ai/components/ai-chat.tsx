"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, MessageSquare, Send, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { apiFetch } from "@/lib/api-client"
import { MAX_QUESTION_LENGTH } from "@/features/ai/schema"
import type { AIConversationRow } from "@/types/database"
import { AIAnswerView, type AIAnswer } from "./ai-answer"
import { useTranslations } from "next-intl"

/**
 * The research chat.
 *
 * One request per question, no streaming. Streaming would give a token trickle for the prose while
 * the part users actually read — the grounded data cards — cannot render until retrieval finishes
 * anyway, so it would add a second transport, a second error path and a partially-rendered answer
 * for very little. `ponytail:` ceiling — add SSE when answers get long enough that the wait is the
 * complaint. The loading stages below cover the wait honestly in the meantime.
 */

const SUGGESTIONS = [
  "Analyse my portfolio",
  "Compare NVDA and AMD",
  "Explain my watchlist",
  "Why is NVDA's technical score what it is?",
  "What does RSI measure?",
  "Find stocks with strong momentum",
] as const

/** What the server is actually doing, in order. Honest rather than decorative. */
const STAGES = [
  "Working out what you asked…",
  "Retrieving Stockly market and technical data…",
  "Building the analysis context…",
  "Writing the summary…",
] as const

type Turn = { question: string; answer: AIAnswer | null; error: string | null }

type ChatResponse = AIAnswer & { conversationId: string }

/** Mounted only while a request is in flight, so the stage resets by unmounting rather than by
 *  a setState inside an effect. */
function Stages() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, STAGES.length - 1)), 2500)
    return () => clearInterval(timer)
  }, [])

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {STAGES[index]}
    </p>
  )
}

export function AIChat({
  conversations,
  aiEnabled,
}: {
  conversations: AIConversationRow[]
  aiEnabled: boolean
}) {
  const t = useTranslations("ai")
  const tc = useTranslations("common")
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState("")
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [history, setHistory] = useState(conversations)
  const endRef = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: (text: string) =>
      apiFetch<ChatResponse>("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ question: text, conversationId }),
      }),
    onSuccess: (data) => {
      setConversationId(data.conversationId)
      setTurns((current) =>
        current.map((turn, index) =>
          index === current.length - 1 ? { ...turn, answer: data } : turn,
        ),
      )
    },
    onError: (error: Error) => {
      setTurns((current) =>
        current.map((turn, index) =>
          index === current.length - 1 ? { ...turn, error: error.message } : turn,
        ),
      )
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ai/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      setHistory((current) => current.filter((c) => c.id !== id))
      if (conversationId === id) {
        setConversationId(undefined)
        setTurns([])
      }
      toast.success(t("conversationDeleted"))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [turns, ask.isPending])

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || ask.isPending) return
    setTurns((current) => [...current, { question: trimmed, answer: null, error: null }])
    setQuestion("")
    ask.mutate(trimmed)
  }

  return (
    <div className="space-y-5">
      {!aiEnabled && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm">
          {t("disabled")}{" "}
          {t.rich("enableWith", {
            flag: () => <code className="text-xs">AI_ENABLED=true</code>,
            file: () => <code className="text-xs">.env.local</code>,
          })}
        </p>
      )}

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t("recent")}</h2>
          <ul className="flex flex-wrap gap-2">
            {history.map((conversation) => (
              <li key={conversation.id} className="flex items-center gap-1">
                <span className="inline-flex min-h-8 max-w-[16rem] items-center truncate rounded-lg border px-2.5 text-xs font-medium">
                  {conversation.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${conversation.title}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(conversation.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-6" aria-live="polite">
        {turns.length === 0 && (
          <div className="rounded-xl border">
            <EmptyState
              icon={Sparkles}
              title={t("ask")}
              description={t("askHint")}
            />
          </div>
        )}

        {turns.map((turn, index) => (
          <article key={index} className="space-y-3">
            <p className="bg-muted ml-auto w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-sm">
              {turn.question}
            </p>

            {turn.error ? (
              <div className="space-y-2 rounded-xl border border-dashed p-3.5">
                <p className="text-sm">{turn.error}</p>
                <Button variant="outline" size="sm" onClick={() => submit(turn.question)}>{tc("actions.retry")}</Button>
              </div>
            ) : turn.answer ? (
              <div className="bg-card rounded-xl border p-3.5 sm:p-4">
                <AIAnswerView answer={turn.answer} />
              </div>
            ) : ask.isPending ? (
              <Stages />
            ) : null}
          </article>
        ))}
        <div ref={endRef} />
      </section>

      {/* Sticky rather than fixed: it clears the mobile tab bar without a second layout to keep
          in step, and the safe-area padding keeps it above the home indicator. */}
      <div className="bg-background safe-bottom sticky bottom-20 z-20 -mx-1 space-y-2 px-1 pt-2 pb-2 lg:bottom-0">
        <ul className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                disabled={ask.isPending || !aiEnabled}
                onClick={() => submit(suggestion)}
                className="hover:bg-accent inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit(question)
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="ai-question" className="sr-only">{t("askButton")}</label>
          <textarea
            id="ai-question"
            rows={1}
            value={question}
            maxLength={MAX_QUESTION_LENGTH}
            disabled={!aiEnabled}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — but never on a touch keyboard, where
              // the return key is how people write a second sentence.
              if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
                event.preventDefault()
                submit(question)
              }
            }}
            placeholder={t("placeholder")}
            className="border-input bg-background focus-visible:ring-ring/50 max-h-40 min-h-11 w-full resize-y rounded-xl border px-3 py-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t("askButton")}
            disabled={!question.trim() || ask.isPending || !aiEnabled}
            className="size-11 shrink-0"
          >
            {ask.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </Button>
        </form>

        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <MessageSquare className="size-3 shrink-0" aria-hidden />
          Answers are grounded in Stockly&apos;s own data. Stockly AI describes and explains; it does
          not give investment advice.
        </p>
      </div>
    </div>
  )
}
