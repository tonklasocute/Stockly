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
 *
 * **The one screen in the application that is deliberately bilingual.** It has no translation
 * provider — the provider lives in the root layout, and this file exists precisely because the root
 * layout did not render. Reading the locale cookie here would have to happen after hydration, on a
 * page whose whole premise is that rendering has already failed. Showing both languages is three
 * extra lines and always correct; guessing one is sometimes wrong at the worst possible moment.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="th">
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
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }} lang="th">
          Stockly ไม่สามารถโหลดได้
        </h1>
        <p style={{ margin: 0, maxWidth: "28rem", color: "#52525b", fontSize: "0.875rem" }} lang="th">
          เกิดข้อผิดพลาดก่อนที่หน้าจะแสดงผลได้ ข้อมูลของคุณไม่ได้รับผลกระทบ
          และไม่มีข้อมูลใดถูกเก็บไว้ในเบราว์เซอร์
        </p>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0.5rem 0 0" }} lang="en">
          Stockly could not load
        </h2>
        <p style={{ margin: 0, maxWidth: "28rem", color: "#52525b", fontSize: "0.875rem" }} lang="en">
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
          ลองอีกครั้ง / Try again
        </button>
        {error.digest && (
          <p style={{ margin: 0, color: "#a1a1aa", fontSize: "0.75rem" }}>
            รหัสอ้างอิง / Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
