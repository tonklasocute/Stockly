/**
 * Shared typography for the three legal pages, so they cannot drift apart visually — and one place
 * to state the date they were last changed.
 */
export const LAST_UPDATED = "2 September 2026"

export function LegalPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">Last updated {LAST_UPDATED}</p>
      </header>
      <div className="space-y-6 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_section]:space-y-2 [&_ul]:space-y-1.5">
        {children}
      </div>
    </article>
  )
}
