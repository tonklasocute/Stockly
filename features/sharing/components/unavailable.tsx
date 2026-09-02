import Link from "next/link"

/**
 * Every way a shared page can fail to open.
 *
 * The reasons are separate sentences because a person who was given a link deserves to know
 * whether to ask for a new one — but they are only ever chosen by the **route**, never by what the
 * database found. A wrong token, a revoked token and a token for a portfolio that was made private
 * all return the same nothing from `features/sharing/public.ts`, so the page cannot accidentally
 * confirm which one it was.
 */
export const UNAVAILABLE_REASONS = {
  PRIVATE: {
    title: "This portfolio is private",
    detail: "Its owner has not shared it, or has stopped sharing it.",
  },
  LINK: {
    title: "This share link is not available",
    detail:
      "The link may have expired, been revoked, or never have been valid. Ask whoever shared it for a new one.",
  },
  SNAPSHOT: {
    title: "This snapshot is not available",
    detail: "It may have been deleted by its owner.",
  },
} as const

export function Unavailable({ reason }: { reason: keyof typeof UNAVAILABLE_REASONS }) {
  const { title, detail } = UNAVAILABLE_REASONS[reason]
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 px-5 py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{detail}</p>
      <p className="text-muted-foreground pt-2 text-sm">
        <Link href="/" className="underline-offset-4 hover:underline">
          Stockly
        </Link>
      </p>
    </div>
  )
}
