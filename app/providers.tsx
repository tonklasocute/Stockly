"use client"

import { useState } from "react"
import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
export function Providers({
  children,
  /** The per-request CSP nonce, so next-themes' pre-paint script is allowed to run. */
  nonce,
}: {
  children: React.ReactNode
  nonce?: string
}) {
  // One client per browser session; created in state so React 19 strict mode does not discard it.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  )

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}
