"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Star } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"

export function WatchButton({
  symbol,
  name,
  exchange,
  market = "US",
  watched,
  className,
}: {
  symbol: string
  name?: string | null
  exchange?: string | null
  market?: string
  watched: boolean
  className?: string
}) {
  // Optimistic so the star responds immediately; reverted if the request fails.
  const [isWatched, setIsWatched] = useState(watched)
  const router = useRouter()

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) {
        await apiFetch(`/api/watchlist`, {
          method: "POST",
          body: JSON.stringify({ symbol, market, name, exchange }),
        })
      } else {
        await apiFetch(`/api/watchlist/${symbol}?market=${market}`, { method: "DELETE" })
      }
    },
    onMutate: (next) => setIsWatched(next),
    onSuccess: (_data, next) => {
      toast.success(next ? `${symbol} added to your watchlist.` : `${symbol} removed.`)
      router.refresh()
    },
    onError: (error: Error, next) => {
      setIsWatched(!next)
      toast.error(error.message)
    },
  })

  return (
    <Button
      variant={isWatched ? "secondary" : "outline"}
      size="sm"
      className={cn("gap-2 max-sm:h-11", className)}
      disabled={toggle.isPending}
      aria-pressed={isWatched}
      onClick={() => toggle.mutate(!isWatched)}
    >
      {toggle.isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Star className={cn("size-4", isWatched && "fill-current")} aria-hidden />
      )}
      {isWatched ? "In watchlist" : "Add to watchlist"}
    </Button>
  )
}
