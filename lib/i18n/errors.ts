"use client"

import { useTranslations } from "next-intl"
import { ERROR_CODES } from "@/lib/api-codes"
import { isApiClientError } from "@/lib/api-client"

/**
 * Turning anything a mutation can throw into a sentence in the reader's language.
 *
 * The order matters, and each step is a different kind of failure:
 *
 *   1. **A coded API failure** — the normal case. The code is translated; the server's English
 *      `message` is never shown, so a Thai reader never gets half a sentence in English.
 *   2. **An unknown code** — a newer server talking to an older client. The server's message is
 *      shown rather than nothing, because a specific English sentence beats a generic Thai one when
 *      the alternative is telling the user nothing at all.
 *   3. **Anything else** — a network failure, a thrown string, an exception from a library. These
 *      get the generic sentence. The raw text is deliberately not shown: it is written for a
 *      developer, it is not translated, and it is the usual way an internal detail leaks onto a
 *      screen.
 *
 * The request id is appended when there is one, because it is the only thing a user needs to quote
 * for the failure to be findable in the logs.
 */
export function useErrorMessage() {
  const t = useTranslations("errors")

  return function describe(error: unknown): string {
    if (!isApiClientError(error)) return t("generic")

    const known = error.code in ERROR_CODES
    const message = known ? t(`code.${error.code}`) : error.message || t("generic")

    return error.requestId ? `${message} (${t("requestId", { id: error.requestId })})` : message
  }
}
