/**
 * The shell for shared pages.
 *
 * Deliberately not the app shell and not the marketing shell: a visitor here has no session, no
 * portfolio switcher and no notifications, and rendering any of those would mean a database query
 * on a page that must stay cheap under a burst of traffic from a link somebody posted.
 *
 * `force-dynamic` because the nonce-based CSP needs a server-rendered response — a statically
 * prerendered page carries no nonce and has its scripts blocked in production.
 */
export const dynamic = "force-dynamic"

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>
}
