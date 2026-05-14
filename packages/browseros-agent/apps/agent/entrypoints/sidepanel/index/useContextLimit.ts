import { useMemo } from 'react'
import type { UIMessage } from 'ai'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'

/** Default context window when provider doesn't specify one (128k tokens) */
const DEFAULT_CONTEXT_LIMIT = 128_000

/** Ratio at which the "near limit" warning banner appears */
const NEAR_LIMIT_RATIO = 0.8

/** Ratio at which the "over limit" critical banner appears */
const OVER_LIMIT_RATIO = 0.95

export interface UseContextLimitResult {
  /** Rough client-side token estimate from message content */
  estimatedTokens: number
  /** Context window size from provider config (default 128k) */
  contextLimit: number
  /** Usage ratio (0–1+, where 1 = at limit) */
  usageRatio: number
  /** True when usageRatio > 0.8 */
  isNearLimit: boolean
  /** True when usageRatio > 0.95 */
  isOverLimit: boolean
}

/**
 * Estimate token count from UIMessage[] on the client side.
 * Rough heuristic: ~4 chars per token for text, ignoring tool outputs and images.
 */
function estimateTokensFromMessages(messages: UIMessage[]): number {
  let totalChars = 0

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'text') {
        totalChars += part.text.length
      }
    }
  }

  return Math.ceil(totalChars / 4)
}

/**
 * Hook that provides client-side context window usage estimation.
 *
 * Useful for showing warnings when the conversation approaches or exceeds
 * the model's context window limit. The estimation is intentionally rough —
 * exact token counts come from the server's `estimateTokens()` in compaction/utils.
 *
 * @public
 */
export function useContextLimit(
  messages: UIMessage[],
): UseContextLimitResult {
  const { selectedProvider } = useLlmProviders()

  const contextLimit = useMemo(() => {
    if (
      selectedProvider?.contextWindow &&
      selectedProvider.contextWindow > 0
    ) {
      return selectedProvider.contextWindow
    }
    return DEFAULT_CONTEXT_LIMIT
  }, [selectedProvider?.contextWindow])

  const estimatedTokens = useMemo(
    () => estimateTokensFromMessages(messages),
    [messages],
  )

  const usageRatio = useMemo(
    () => (contextLimit > 0 ? estimatedTokens / contextLimit : 0),
    [estimatedTokens, contextLimit],
  )

  const isNearLimit = usageRatio > NEAR_LIMIT_RATIO
  const isOverLimit = usageRatio > OVER_LIMIT_RATIO

  return {
    estimatedTokens,
    contextLimit,
    usageRatio,
    isNearLimit,
    isOverLimit,
  }
}
