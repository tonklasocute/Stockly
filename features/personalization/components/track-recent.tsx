"use client"

import { useEffect, useRef } from "react"
import { apiFetch } from "@/lib/api-client"
import type { PinnableKind } from "@/domain/personalization"

/**
 * Records that this page was opened.
 *
 * A client component with no markup, mounted on the pages worth getting back to. It fires once per
 * mount and is deliberately silent on failure — a recently-viewed list is a convenience, and a
 * toast about one failing to save would be worse than the list being one entry short.
 *
 * Privacy, since this is the one feature in the phase that records behaviour: the list is capped at
 * eight, stores a reference and a label and nothing else, is readable only by its owner under RLS,
 * and never appears in a shared page — `features/personalization/privacy.test.ts` asserts that
 * last part. It is a way back to what you were just looking at, deliberately too short to
 * reconstruct what somebody has been researching.
 */
export function TrackRecent({ kind, refId, label }: { kind: PinnableKind; refId: string; label: string }) {
  // A ref rather than an empty dependency array: React strict mode mounts twice in development,
  // and two identical writes would be two round trips for one page view.
  const recorded = useRef(false)

  useEffect(() => {
    if (recorded.current) return
    recorded.current = true
    void apiFetch("/api/preferences", {
      method: "POST",
      body: JSON.stringify({ action: "recordRecent", item: { kind, ref: refId, label } }),
    }).catch(() => {
      // Silent by design. See the note above.
    })
  }, [kind, refId, label])

  return null
}
