import { MessageSquare, Search } from 'lucide-react'
import type { FC } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AgentSessionItem } from './AgentSessionItem'
import type { AgentSession } from './agent-session-list-types'
import { NewAgentSessionButton } from './NewAgentSessionButton'

export interface AgentSessionListProps {
  agentId: string
  activeSessionId: string
  sessions: AgentSession[]
  filteredSessions: AgentSession[]
  search: string
  setSearch: (q: string) => void
  onSessionSelect: (sessionId: string) => void
  onNewSession: () => void
  className?: string
}

function AgentSessionListEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <div className="flex size-8 items-center justify-center rounded-xl bg-muted">
        <MessageSquare className="size-4 text-muted-foreground" />
      </div>
      <p className="text-[12px] text-muted-foreground">
        No sessions yet. Start a new chat.
      </p>
    </div>
  )
}

/**
 * Session list panel for a single agent.
 * Shows a search bar, list of sessions, and a "New Chat" button.
 * Designed for the sidebar/rail area of the agent conversation view.
 */
export const AgentSessionList: FC<AgentSessionListProps> = ({
  agentId: _agentId,
  activeSessionId,
  sessions,
  filteredSessions,
  search,
  setSearch,
  onSessionSelect,
  onNewSession,
  className,
}) => {
  const hasSessions = sessions.length > 0

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Header: title + new-chat button */}
      <div className="flex items-center justify-between px-3">
        <span className="font-medium text-[12px] text-muted-foreground">
          Sessions
        </span>
        <NewAgentSessionButton onClick={onNewSession} />
      </div>

      {/* Search — only shown when there are sessions */}
      {hasSessions ? (
        <div className="relative px-3">
          <Search className="pointer-events-none absolute top-1/2 left-6 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 rounded-lg pl-7 text-[12px]"
          />
        </div>
      ) : null}

      {/* Session list or empty state */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!hasSessions ? (
          <AgentSessionListEmpty />
        ) : filteredSessions.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">
            No sessions match &quot;{search}&quot;
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 px-1.5">
            {filteredSessions.map((session) => (
              <AgentSessionItem
                key={session.sessionId}
                session={session}
                isActive={session.sessionId === activeSessionId}
                onSelect={onSessionSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
