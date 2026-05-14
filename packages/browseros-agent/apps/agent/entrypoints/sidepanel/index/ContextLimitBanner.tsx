import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FC } from 'react'
import { track } from '@/lib/metrics/track'
import { cn } from '@/lib/utils'

export interface ContextLimitBannerProps {
  /** True when usage is > 0.8 (yellow) */
  isNearLimit: boolean
  /** True when usage is > 0.95 (red) */
  isOverLimit: boolean
  /** Usage ratio 0–1+ */
  usageRatio: number
  /** Current conversation ID (used for per-session dismissal) */
  conversationId: string
  /** Whether compaction is currently in progress */
  isCompacting: boolean
  /** Callback to trigger compaction */
  onCompact: () => void
  /** Callback to start a new conversation from summary */
  onStartFreshWithSummary: () => void
}

// Session-scoped dismissal storage
const dismissedSessions = new Set<string>()

/**
 * Banner shown above the message input when the conversation approaches
 * or exceeds the model's context window limit.
 *
 * - Yellow/amber when `isNearLimit` (> 80%)
 * - Red when `isOverLimit` (> 95%)
 * - Dismissible per-session
 * - Auto-hides when compaction completes
 *
 * @public
 */
export const ContextLimitBanner: FC<ContextLimitBannerProps> = ({
  isNearLimit,
  isOverLimit,
  usageRatio,
  conversationId,
  isCompacting,
  onCompact,
  onStartFreshWithSummary,
}) => {
  const [dismissed, setDismissed] = useState(() =>
    dismissedSessions.has(conversationId),
  )

  // Reset dismissal when conversation changes
  useEffect(() => {
    setDismissed(dismissedSessions.has(conversationId))
  }, [conversationId])

  const handleDismiss = useCallback(() => {
    dismissedSessions.add(conversationId)
    setDismissed(true)
  }, [conversationId])

  // Track banner shown (once per session)
  useEffect(() => {
    if ((isNearLimit || isOverLimit) && !dismissed) {
      track('sidepanel.context_limit.banner_shown', {
        usageRatio: Math.round(usageRatio * 100) / 100,
        isOverLimit,
      })
    }
  }, [isNearLimit, isOverLimit, dismissed, usageRatio])

  // Don't render if dismissed or not near limit
  if (dismissed || (!isNearLimit && !isOverLimit)) {
    return null
  }

  const isCritical = isOverLimit

  const handleCompact = () => {
    track('sidepanel.context_limit.compact_clicked', {
      usageRatio: Math.round(usageRatio * 100) / 100,
      isOverLimit,
    })
    onCompact()
  }

  const handleStartFresh = () => {
    track('sidepanel.context_limit.summary_clicked', {
      usageRatio: Math.round(usageRatio * 100) / 100,
      isOverLimit,
    })
    onStartFreshWithSummary()
  }

  return (
    <div
      className={cn(
        'mx-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
        isCritical
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
      )}
    >
      {isCompacting ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : isCritical ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      )}

      <span className="flex-1">
        {isCritical
          ? 'Context limit reached. Compaction recommended.'
          : 'Conversation is getting long.'}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleCompact}
          disabled={isCompacting}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors',
            isCritical
              ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
              : 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300',
            isCompacting && 'pointer-events-none opacity-50',
          )}
        >
          {isCompacting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Compact
        </button>

        {!isCritical && (
          <button
            type="button"
            onClick={handleStartFresh}
            disabled={isCompacting}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors',
              'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300',
              isCompacting && 'pointer-events-none opacity-50',
            )}
          >
            Start fresh
          </button>
        )}
      </div>

      {!isCritical && (
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10',
            'text-amber-600/60 hover:text-amber-600 dark:text-amber-300/60 dark:hover:text-amber-300',
          )}
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
