import Link from "next/link"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-8">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-lg text-sm font-bold">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight">Stockly</span>
        </Link>
        {children}
      </div>
    </main>
  )
}
