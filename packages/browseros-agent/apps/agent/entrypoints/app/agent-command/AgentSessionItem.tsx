import { MessageSquare } from 'lucide-react'
import type { FC } from 'react'
import type { AgentSession } from './agent-session-list-types'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/entrypoints/app/agents/agent-display.helpers'

export interface AgentSessionItemProps {
  session: AgentSession
  isActive: boolean
  onSelect: (sessionId: string) => void
}

/**
 * Single session row in the session list sidebar.
 * Shows title (or "New Chat"), relative time, and message preview.
 */
export const AgentSessionItem: FC<AgentSessionItemProps> = ({
  session,
  isActive,
  onSelect,
}) => {
  const title = session.title ?? 'New Chat'
  const timeLabel = formatRelativeTime(session.lastMessageAt ?? session.createdAt)

  return (
    <button
      type="button"
      onClick={() => onSelect(session.sessionId)}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
        isActive
          ? 'bg-[var(--accent-orange)]/8 text-foreground'
          : 'text-foreground/80 hover:bg-muted/60',
      )}
    >
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium leading-5">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {timeLabel}
          </span>
        </div>
        {session.lastMessagePreview && (
          <p className="mt-0.5 truncate text-[12px] leading-4 text-muted-foreground">
            {session.lastMessagePreview}
          </p>
        )}
      </div>
    </button>
  )
}
