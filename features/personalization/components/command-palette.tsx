"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { NAV_ITEMS } from "@/components/app-shell/nav-items"
import type { PortfolioRow } from "@/types/database"

/**
 * The command palette, and the shortcuts that open it.
 *
 * **It navigates; it does not act.** Every entry is a route that already exists, so there is no
 * second implementation of "add a transaction" to keep in step with the first — the palette takes
 * you to the page that does it. A palette that performed mutations would be a second write path,
 * and the one thing this codebase does not need is another way to create a transaction.
 *
 * Shortcuts follow the convention people already know from Linear and GitHub: `⌘K` / `Ctrl+K` opens
 * it, `/` focuses search, and `g` then a letter goes somewhere. All of them are suppressed while a
 * text field has focus — a shortcut that fires mid-sentence is worse than no shortcut.
 */
type Command = {
  id: string
  label: string
  hint?: string
  href: string
}

/** `g` followed by these goes straight there, without opening anything. */
const GOTO: Record<string, string> = {
  d: "/dashboard",
  p: "/portfolio",
  t: "/transactions",
  w: "/watchlist",
  a: "/alerts",
  s: "/settings",
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

export function CommandPalette({ portfolios }: { portfolios: PortfolioRow[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // A ref rather than state: the `g` prefix must not cause a render, and it must expire on its own.
  const pendingGoto = useRef<number | null>(null)

  const commands = useMemo<Command[]>(() => {
    const navigation = NAV_ITEMS.map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      hint: "Go to",
      href: item.href,
    }))
    const portfolioCommands = portfolios.map((portfolio) => ({
      id: `portfolio:${portfolio.id}`,
      label: portfolio.name,
      hint: "Portfolio",
      href: `/dashboard?p=${portfolio.id}`,
    }))
    return [...navigation, ...portfolioCommands]
  }, [portfolios])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 8)
    return commands.filter((command) => command.label.toLowerCase().includes(needle)).slice(0, 8)
  }, [commands, query])

  /**
   * Clamped during render rather than reset in an effect.
   *
   * The obvious version — an effect that sets the index back to 0 whenever the query changes —
   * makes React render twice for every keystroke. Deriving it costs nothing and keeps the
   * highlight in range when a filter shortens the list underneath it.
   */
  const activeIndex = Math.min(highlighted, Math.max(0, matches.length - 1))

  const run = useCallback(
    (command: Command) => {
      setOpen(false)
      setQuery("")
      router.push(command.href)
    },
    [router],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘K / Ctrl+K works everywhere, including inside a field: it is how you leave one.
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
        return
      }

      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === "/") {
        event.preventDefault()
        setOpen(true)
        return
      }

      if (event.key === "g") {
        // Two-key sequences expire, so a stray `g` cannot silently arm a navigation minutes later.
        pendingGoto.current = window.setTimeout(() => {
          pendingGoto.current = null
        }, 1_500)
        return
      }

      if (pendingGoto.current !== null) {
        const destination = GOTO[event.key.toLowerCase()]
        window.clearTimeout(pendingGoto.current)
        pendingGoto.current = null
        if (destination) {
          event.preventDefault()
          router.push(destination)
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          placeholder="Go to a page or a portfolio…"
          aria-label="Search commands"
          aria-controls="command-results"
          aria-activedescendant={matches[activeIndex] ? `command-${matches[activeIndex].id}` : undefined}
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setHighlighted((i) => Math.min(i + 1, matches.length - 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setHighlighted((i) => Math.max(i - 1, 0))
            } else if (event.key === "Enter" && matches[activeIndex]) {
              event.preventDefault()
              run(matches[activeIndex])
            }
          }}
        />

        <ul id="command-results" role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <li className="text-muted-foreground px-3 py-6 text-center text-sm">No matches.</li>
          ) : (
            matches.map((command, index) => (
              <li key={command.id} id={`command-${command.id}`} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => run(command)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                    index === activeIndex ? "bg-muted" : ""
                  }`}
                >
                  <span className="text-muted-foreground w-16 shrink-0 text-xs">{command.hint}</span>
                  <span className="truncate">{command.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          ⌘K to open · g then d, p, t, w, a or s to jump · ↑↓ and Enter
        </p>
      </DialogContent>
    </Dialog>
  )
}
