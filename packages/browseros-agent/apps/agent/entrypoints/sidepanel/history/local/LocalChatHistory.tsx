import type { FC } from 'react'
import { useMemo } from 'react'
import { useConversations } from '@/lib/conversations/conversationStorage'
import { useChatSessionContext } from '../../layout/ChatSessionContext'
import { SessionConversationList } from '../components/SessionConversationList'
import type { HistoryConversation } from '../components/types'
import { extractLastUserMessage } from '../components/utils'

export const LocalChatHistory: FC = () => {
  const { conversations: localConversations, removeConversation } =
    useConversations()
  const { conversationId: activeConversationId } = useChatSessionContext()

  const conversations = useMemo<HistoryConversation[]>(() => {
    return localConversations.map((conv) => ({
      id: conv.id,
      lastMessagedAt: conv.lastMessagedAt,
      lastUserMessage: extractLastUserMessage(conv.messages),
    }))
  }, [localConversations])

  return (
    <SessionConversationList
      conversations={conversations}
      activeConversationId={activeConversationId}
      onDelete={removeConversation}
    />
  )
}
