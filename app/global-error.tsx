"use client"

/**
 * The last line of defence: an error thrown while rendering the root layout itself.
 *
 * It replaces the whole document, so it renders its own <html> and <body> and cannot use the app's
 * providers, fonts or Tailwind classes — none of them exist at this point. Hence the inline styles,
 * which is the one place in this codebase where they are the right answer.
 *
 * The digest is Next's own hash of the server-side error. It is safe to show — it contains no stack
 * and no message — and it is the string that lets a maintainer find the real error in the logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          background: "#ffffff",
          color: "#0a0a0a",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Stockly could not load</h1>
        <p style={{ margin: 0, maxWidth: "28rem", color: "#52525b", fontSize: "0.875rem" }}>
          Something went wrong before the page could render. Your data is unaffected — nothing is
          stored in the browser.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: "2.75rem",
            padding: "0 1.25rem",
            borderRadius: "0.5rem",
            border: "none",
            background: "#0a0a0a",
            color: "#ffffff",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ margin: 0, color: "#a1a1aa", fontSize: "0.75rem" }}>
            Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
