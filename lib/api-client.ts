import type { ApiResponse } from "./api"

/**
 * Client-side fetch that unwraps the envelope and throws a message a form can display.
 * Lives apart from lib/api.ts so a client component never pulls the server helpers (and with them
 * next/headers) into the browser bundle.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!payload) throw new Error("The server returned an unreadable response.")
  if (!payload.success) throw new Error(payload.error.message)
  return payload.data
}
