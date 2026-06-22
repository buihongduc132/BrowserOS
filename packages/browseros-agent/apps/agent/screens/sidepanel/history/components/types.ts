export interface HistoryWorkspace {
  id: string
  name: string
  path: string
}

export interface HistoryConversation {
  id: string
  lastMessagedAt: number
  lastUserMessage: string
  workspaces?: HistoryWorkspace[]
}

export type TimeGroup = 'today' | 'thisWeek' | 'thisMonth' | 'older'

export interface GroupedConversations {
  today: HistoryConversation[]
  thisWeek: HistoryConversation[]
  thisMonth: HistoryConversation[]
  older: HistoryConversation[]
}
