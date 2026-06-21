import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  Bot,
  CheckIcon,
  CopyIcon,
  Github,
  History,
  MessageSquare,
  Plus,
  SettingsIcon,
  Shrink,
  Trash2,
} from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { CreditBadge } from '@/components/credits/CreditBadge'
import { ThemeToggle } from '@/components/elements/theme-toggle'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Feature } from '@/lib/browseros/capabilities'
import { useCapabilities } from '@/lib/browseros/useCapabilities'
import {
  SIDEPANEL_SESSION_DELETED_EVENT,
  SIDEPANEL_SESSION_ID_COPIED_EVENT,
  SIDEPANEL_SESSION_SWITCHED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { productRepositoryUrl } from '@/lib/constants/productUrls'
import { useCredits } from '@/lib/credits/useCredits'
import { BrowserOSIcon, ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderType } from '@/lib/llm-providers/types'
import { track } from '@/lib/metrics/track'
import { copySessionIdToClipboard } from './CopySessionId'
import { useAgentSessions, useDeleteAgentSession } from './session-queries'

dayjs.extend(relativeTime)

const CreditsBadgeWrapper: FC = () => {
  const { supports } = useCapabilities()
  const { data } = useCredits()
  if (!supports(Feature.CREDITS_SUPPORT) || data === undefined) return null
  return (
    <CreditBadge
      credits={data.credits}
      onClick={() => window.open('/app.html#/settings/usage', '_blank')}
    />
  )
}

interface ChatHeaderProps {
  selectedProvider: Provider
  providers: Provider[]
  onSelectProvider: (provider: Provider) => void
  onNewConversation: () => void
  onCompact?: () => void
  hasMessages: boolean
  hideHistory?: boolean
  conversationId?: string
}

export const ChatHeader: FC<ChatHeaderProps> = ({
  selectedProvider,
  providers,
  onSelectProvider,
  onNewConversation,
  onCompact,
  hasMessages,
  hideHistory,
  conversationId,
}) => {
  const location = useLocation()
  const navigate = useNavigate()
  const isHistoryPage = location.pathname === '/history'
  const [copied, setCopied] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)

  const isAcp = selectedProvider.kind === 'acp' && !!selectedProvider.agentId

  // Session list for ACP providers
  const { sessions, isLoading: sessionsLoading } = useAgentSessions(
    isAcp ? selectedProvider.agentId : undefined,
    { limit: 10 },
  )
  const { deleteSession } = useDeleteAgentSession(
    isAcp ? selectedProvider.agentId : undefined,
  )

  const handleNewConversationFromHistory = () => {
    onNewConversation()
    navigate('/')
  }

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      track(SIDEPANEL_SESSION_SWITCHED_EVENT, {
        agentId: selectedProvider.agentId,
        sessionId,
      })
      navigate({ search: `?conversationId=${sessionId}` })
      setSessionMenuOpen(false)
    },
    [navigate, selectedProvider.agentId],
  )

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation()
      track(SIDEPANEL_SESSION_DELETED_EVENT, {
        agentId: selectedProvider.agentId,
        sessionId,
      })
      try {
        await deleteSession(sessionId)
      } catch {
        // swallow — list will refetch
      }
    },
    [deleteSession, selectedProvider.agentId],
  )

  return (
    <header className="flex items-center justify-between border-border/40 border-b bg-background/80 px-3 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2">
        {/* Provider Selector */}
        <ChatProviderSelector
          providers={providers}
          selectedProvider={selectedProvider}
          onSelectProvider={onSelectProvider}
        >
          <button
            type="button"
            className="group relative inline-flex cursor-pointer items-center gap-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
            title="Change AI Provider"
          >
            {selectedProvider.kind === 'acp' ? (
              <Bot className="h-[18px] w-[18px]" />
            ) : selectedProvider.type === 'browseros' ? (
              <BrowserOSIcon size={18} />
            ) : (
              <ProviderIcon
                type={selectedProvider.type as ProviderType}
                size={18}
              />
            )}
            <span className="font-semibold text-base">
              {selectedProvider.name}
            </span>
          </button>
        </ChatProviderSelector>
        {selectedProvider.type === 'browseros' && <CreditsBadgeWrapper />}
      </div>

      <div className="flex items-center gap-1">
        {conversationId && (
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await copySessionIdToClipboard(conversationId)
                if (result !== false) {
                  track(SIDEPANEL_SESSION_ID_COPIED_EVENT)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
              } catch {
                // clipboard access denied — silently ignore
              }
            }}
            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Copy session ID"
          >
            {copied ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Compact/Summarize button — only when messages exist & ACP */}
        {hasMessages && isAcp && onCompact && (
          <button
            type="button"
            onClick={onCompact}
            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Compact conversation"
          >
            <Shrink className="h-4 w-4" />
          </button>
        )}

        {!isHistoryPage && hasMessages && (
          <button
            type="button"
            onClick={onNewConversation}
            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}

        {/* ACP session dropdown: replaces + when no messages, supplements history link */}
        {isAcp && !isHistoryPage && !hasMessages && (
          <Popover open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                title="New thread / Recent sessions"
              >
                <Plus className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              {/* New Thread action */}
              <button
                type="button"
                onClick={() => {
                  onNewConversation()
                  setSessionMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 font-medium text-sm transition-colors hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
                New Thread
              </button>

              {/* Divider */}
              {sessions.length > 0 && <div className="my-1 border-t" />}

              {/* Recent sessions */}
              <div className="max-h-64 overflow-y-auto">
                {sessionsLoading ? (
                  <p className="px-3 py-2 text-muted-foreground text-xs">
                    Loading sessions…
                  </p>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => handleSwitchSession(s.sessionId)}
                      className="group/session flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {s.title || s.lastMessagePreview || 'Untitled session'}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {s.lastMessageAt
                          ? dayjs(s.lastMessageAt).fromNow()
                          : dayjs(s.createdAt).fromNow()}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, s.sessionId)}
                        className="shrink-0 cursor-pointer p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover/session:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {!hideHistory &&
          (isHistoryPage ? (
            <button
              type="button"
              onClick={handleNewConversationFromHistory}
              className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title="New conversation"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : (
            <Link
              to="/history"
              className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title="Chat history"
            >
              <History className="h-4 w-4" />
            </Link>
          ))}

        <a
          href={productRepositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="Star on Github"
        >
          <Github className="h-4 w-4" />
        </a>

        <a
          href="/app.html#/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </a>

        <ThemeToggle
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          iconClassName="h-4 w-4"
        />
      </div>
    </header>
  )
}
