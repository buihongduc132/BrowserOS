import { Folder } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import {
  type AssistantSession,
  type GroupingMode,
  groupSessions,
} from '../useSessionGrouping'
import { ConversationItem } from './ConversationItem'
import { GroupingToggle } from './GroupingToggle'
import type { HistoryConversation } from './types'
import { colorFromPath } from './workspace-bubble-colors'

interface SessionConversationListProps {
  conversations: HistoryConversation[]
  activeConversationId: string
  onDelete?: (id: string) => void
  onClearAll?: () => Promise<void>
  isClearingAll?: boolean
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  onLoadMore?: () => void
  isRefreshing?: boolean
}

/** Convert HistoryConversation to AssistantSession for grouping */
function toAssistantSessions(
  conversations: HistoryConversation[],
): AssistantSession[] {
  return conversations.map((conv) => ({
    id: conv.id,
    title: conv.lastUserMessage,
    workspaces: (conv.workspaces ?? []).map((ws) => ({
      id: ws.id,
      name: ws.name,
      path: ws.path,
    })),
    tags: [],
    updatedAt: conv.lastMessagedAt,
    createdAt: conv.lastMessagedAt,
  }))
}

export const SessionConversationList: FC<SessionConversationListProps> = ({
  conversations,
  activeConversationId,
  onDelete,
  isRefreshing,
}) => {
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('workspace')

  const sessions = useMemo(
    () => toAssistantSessions(conversations),
    [conversations],
  )

  const hasWorkspaces = useMemo(
    () => sessions.some((s) => s.workspaces.length > 0),
    [sessions],
  )

  const groups = useMemo(
    () => groupSessions(sessions, groupingMode),
    [sessions, groupingMode],
  )

  if (conversations.length === 0) return null

  return (
    <main className="mt-4 flex h-full flex-1 flex-col space-y-4 overflow-y-auto">
      <div className="w-full p-3">
        {isRefreshing && (
          <div className="flex items-center justify-center gap-2 pb-3 text-muted-foreground text-xs">
            <span>Refreshing...</span>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between">
          <GroupingToggle
            mode={groupingMode}
            onModeChange={setGroupingMode}
            hasWorkspaces={hasWorkspaces}
          />
        </div>

        {groups.map((group) => (
          <div key={group.key} className="mb-4">
            <div className="mb-2 flex items-center gap-2 px-3">
              {group.icon === 'workspace' && (
                <Folder
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: colorFromPath(group.key) }}
                />
              )}
              <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                {group.label}
              </h3>
              <span className="text-muted-foreground/60 text-xs">
                ({group.sessions.length})
              </span>
            </div>
            <div className="space-y-1">
              {group.sessions.map((session) => (
                <ConversationItem
                  key={session.id}
                  conversation={{
                    id: session.id,
                    lastMessagedAt: session.updatedAt,
                    lastUserMessage: session.title ?? 'New conversation',
                    workspaces: session.workspaces,
                  }}
                  onDelete={onDelete}
                  isActive={session.id === activeConversationId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
