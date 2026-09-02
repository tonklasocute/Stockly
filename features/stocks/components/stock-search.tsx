"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Search, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { currencyOf } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import type { InstrumentSummary } from "@/services/market-data/types"

/** Waits for the user to stop typing before spending an API credit. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function StockSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const debounced = useDebounced(query, 300)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const trimmed = debounced.trim()
  const { data, isFetching, isError } = useQuery({
    queryKey: ["stock-search", trimmed],
    queryFn: () =>
      apiFetch<{ results: InstrumentSummary[] }>(`/api/stocks/search?q=${encodeURIComponent(trimmed)}`),
    // Results for a given query never change within a session, so never refetch them.
    enabled: open && trimmed.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  })

  // The market travels with the symbol: a stock page that does not know the venue cannot know the
  // currency, and would price a Thai listing in dollars.
  function go(symbol: string, market: string) {
    setOpen(false)
    setQuery("")
    router.push(`/stocks/${symbol}?market=${market}`)
  }

  const results = data?.results ?? []
  const showEmpty = trimmed.length >= 2 && !isFetching && !isError && results.length === 0

  return (
    <>
      {/* Desktop: a real field. Mobile: just the icon, so the header stays uncluttered. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Search stocks"
        className="text-muted-foreground hidden w-56 justify-start gap-2 font-normal sm:flex"
      >
        <Search className="size-4" aria-hidden />
        Search stocks…
        <kbd className="bg-muted text-muted-foreground ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label="Search stocks"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 sm:top-[12dvh] sm:max-w-lg sm:translate-y-0">
          <DialogTitle className="sr-only">Search stocks</DialogTitle>

          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by symbol or company name"
              aria-label="Search by symbol or company name"
              className="h-12 border-0 px-0 shadow-none focus-visible:ring-0"
            />
            {isFetching && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />}
          </div>

          <div className="max-h-[55dvh] overflow-y-auto p-1.5 sm:max-h-[60dvh]">
            {trimmed.length < 2 && (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm">
                Type at least two characters to search.
              </p>
            )}
            {isError && (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm">
                Unable to load market data. Please try again later.
              </p>
            )}
            {showEmpty && (
              <p className="text-muted-foreground px-3 py-8 text-center text-sm">
                No stocks match “{trimmed}”.
              </p>
            )}
            {results.map((result) => (
              <button
                key={`${result.market}:${result.symbol}`}
                type="button"
                onClick={() => go(result.symbol, result.market)}
                className="hover:bg-accent focus-visible:bg-accent flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none"
              >
                <TrendingUp className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{result.symbol}</span>
                  <span className="text-muted-foreground block truncate text-xs">{result.name}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {result.exchange ?? result.market} · {currencyOf(result.market)}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
