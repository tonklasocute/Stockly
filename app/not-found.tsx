import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <Button nativeButton={false}
          render={<Link href="/dashboard" />} className="max-sm:h-11">
        Back to dashboard
      </Button>
    </main>
  )
}
