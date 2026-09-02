import { ImageResponse } from "next/og"
import { SITE } from "@/lib/site"

/**
 * The share card, generated rather than designed in a file.
 *
 * A checked-in PNG would be one more asset to keep in step with the wordmark; this is the wordmark,
 * rendered once at build time. Twitter reuses the same image, so there is one card, not two.
 */
export const alt = `${SITE.name} — ${SITE.tagline}`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 88,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 18,
              background: "#fafafa",
              color: "#0a0a0a",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>{SITE.name}</div>
        </div>
        <div style={{ fontSize: 44, color: "#a1a1aa", letterSpacing: -0.5 }}>{SITE.tagline}</div>
        <div style={{ fontSize: 26, color: "#71717a", maxWidth: 900, lineHeight: 1.4 }}>
          Portfolio, cost basis and P&amp;L derived from your transactions. Technical analysis,
          alerts and grounded research.
        </div>
      </div>
    ),
    size,
  )
}
