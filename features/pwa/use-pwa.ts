"use client"

import { useSyncExternalStore } from "react"

/**
 * Browser facts read through `useSyncExternalStore` rather than an effect that calls setState.
 * These are external values React does not own: the store pattern reads them during render, with an
 * explicit server snapshot, so there is no cascading re-render and no hydration guesswork.
 */

const noopSubscribe = () => () => {}

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener("change", callback)
    return () => mql.removeEventListener("change", callback)
  }
}

/**
 * True when the app is running as an installed app rather than a browser tab.
 * `display-mode: standalone` covers Android and desktop; `navigator.standalone` is the iOS-only
 * property Safari still uses for a home-screen launch.
 */
export function useStandalone(): boolean {
  return useSyncExternalStore(
    subscribeMedia("(display-mode: standalone)"),
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  )
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

/**
 * `navigator.onLine` is only "is there a network interface", never "can I reach the server", so it
 * is treated as a hint: trusted when false (definitely offline) and never used on its own to claim
 * a working connection.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true, // assume online while server-rendering, so nothing flashes an offline banner
  )
}

export type Platform = "ios" | "android" | "desktop"

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop"
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(ua) || isIpad) return "ios"
  if (/Android/.test(ua)) return "android"
  return "desktop"
}

/** The user agent never changes during a session, so this store never notifies. */
export function usePlatform(): Platform {
  return useSyncExternalStore(noopSubscribe, detectPlatform, () => "desktop")
}

// ---------------------------------------------------------------- install dismissal

const DISMISS_KEY = "stockly:install-dismissed"
/** Dismissing hides the invitation for a fortnight, not forever — the user may not be ready yet. */
const DISMISS_DAYS = 14

const dismissListeners = new Set<() => void>()

function readDismissed(): boolean {
  try {
    const stored = localStorage.getItem(DISMISS_KEY)
    return stored ? Date.now() - Number(stored) < DISMISS_DAYS * 86_400_000 : false
  } catch {
    // Private mode, or storage blocked. Treat as "not dismissed" but never throw.
    return false
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // Nothing to do: the invitation simply reappears next session.
  }
  for (const listener of dismissListeners) listener()
}

export function clearInstallDismissal(): void {
  try {
    localStorage.removeItem(DISMISS_KEY)
  } catch {
    // Same: best effort.
  }
  for (const listener of dismissListeners) listener()
}

export function useInstallDismissed(): boolean {
  return useSyncExternalStore(
    (callback) => {
      dismissListeners.add(callback)
      return () => dismissListeners.delete(callback)
    },
    readDismissed,
    () => true, // hidden during server render, so it never flashes before hydration
  )
}
