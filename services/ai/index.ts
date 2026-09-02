import "server-only"

import { cache } from "react"
import { serverEnv } from "@/lib/env.server"
import { AIError } from "./errors"
import { createAnthropicProvider } from "./anthropic-provider"
import { createOpenAIProvider } from "./openai-provider"
import { mockAIProvider } from "./mock-provider"
import type { AIProvider } from "./types"
import { logger } from "@/lib/log"

/**
 * The single place a model vendor is named. Everything above depends on the interface only.
 *
 * Server-only: every adapter closes over the API key, and a client import of this module is a
 * build error rather than a leak.
 */

/** The feature flag and the credentials, checked together. Neither alone is enough to run. */
export function isAIEnabled(): boolean {
  if (!serverEnv.aiEnabled) return false
  if (serverEnv.aiProvider === "mock") return true
  return Boolean(serverEnv.aiApiKey) || serverEnv.aiProvider === "openai"
}

export const getAIProvider = cache((): AIProvider => {
  if (!serverEnv.aiEnabled) throw AIError.disabled()

  switch (serverEnv.aiProvider) {
    case "mock":
      return mockAIProvider

    case "anthropic": {
      if (!serverEnv.aiApiKey) throw AIError.notConfigured()
      return createAnthropicProvider({
        apiKey: serverEnv.aiApiKey,
        model: serverEnv.aiModel,
        maxTokens: serverEnv.aiMaxTokens,
        timeoutMs: serverEnv.aiTimeoutMs,
      })
    }

    case "openai": {
      // A local model on AI_BASE_URL legitimately has no key, so only the URL is required here.
      const baseUrl = serverEnv.aiBaseUrl || "https://api.openai.com/v1"
      if (!serverEnv.aiModel) throw AIError.notConfigured()
      return createOpenAIProvider({
        apiKey: serverEnv.aiApiKey,
        baseUrl,
        model: serverEnv.aiModel,
        maxTokens: serverEnv.aiMaxTokens,
        temperature: serverEnv.aiTemperature,
        timeoutMs: serverEnv.aiTimeoutMs,
      })
    }

    default:
      logger.warn("ai.unknown_provider", { provider: serverEnv.aiProvider })
      return mockAIProvider
  }
})

export { AIError, isAIError } from "./errors"
export { withRetry, extractJson } from "./structured"
export type * from "./types"
