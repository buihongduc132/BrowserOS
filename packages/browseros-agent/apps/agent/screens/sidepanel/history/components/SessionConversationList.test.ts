import { describe, expect, it } from 'bun:test'
import { type AssistantSession, groupSessions } from '../useSessionGrouping'
import type { HistoryConversation } from './types'

/** Mirrors the converter in SessionConversationList */
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

describe('SessionConversationList integration', () => {
  const baseTime = Date.now()

  const conversations: HistoryConversation[] = [
    {
      id: 'conv-1',
      lastMessagedAt: baseTime,
      lastUserMessage: 'Fix auth bug',
      workspaces: [
        { id: 'ws-1', name: 'frontend', path: '/home/user/frontend' },
      ],
    },
    {
      id: 'conv-2',
      lastMessagedAt: baseTime - 3600_000,
      lastUserMessage: 'Add rate limiting',
      workspaces: [{ id: 'ws-2', name: 'backend', path: '/home/user/backend' }],
    },
    {
      id: 'conv-3',
      lastMessagedAt: baseTime - 7200_000,
      lastUserMessage: 'Fix CORS issue',
      workspaces: [
        { id: 'ws-1', name: 'frontend', path: '/home/user/frontend' },
        { id: 'ws-2', name: 'backend', path: '/home/user/backend' },
      ],
    },
    {
      id: 'conv-4',
      lastMessagedAt: baseTime - 10800_000,
      lastUserMessage: 'Summarize page',
      // no workspaces
    },
  ]

  describe('toAssistantSessions converter', () => {
    it('maps all conversations with correct fields', () => {
      const sessions = toAssistantSessions(conversations)
      expect(sessions).toHaveLength(4)
      expect(sessions[0].id).toBe('conv-1')
      expect(sessions[0].title).toBe('Fix auth bug')
      expect(sessions[0].workspaces).toHaveLength(1)
    })

    it('handles missing workspaces as empty array', () => {
      const sessions = toAssistantSessions(conversations)
      const noWorkspaceSession = sessions.find((s) => s.id === 'conv-4')
      expect(noWorkspaceSession?.workspaces).toEqual([])
    })

    it('preserves multi-workspace sessions', () => {
      const sessions = toAssistantSessions(conversations)
      const multiWs = sessions.find((s) => s.id === 'conv-3')
      expect(multiWs?.workspaces).toHaveLength(2)
      expect(multiWs?.workspaces[0].id).toBe('ws-1')
      expect(multiWs?.workspaces[1].id).toBe('ws-2')
    })
  })

  describe('grouping integration', () => {
    it('groups by workspace with multi-membership', () => {
      const sessions = toAssistantSessions(conversations)
      const groups = groupSessions(sessions, 'workspace')

      // conv-3 should appear in both frontend and backend groups
      const frontendGroup = groups.find((g) => g.key === 'ws-1')
      const backendGroup = groups.find((g) => g.key === 'ws-2')

      expect(frontendGroup).toBeDefined()
      expect(backendGroup).toBeDefined()
      expect(frontendGroup?.sessions.map((s) => s.id)).toContain('conv-3')
      expect(backendGroup?.sessions.map((s) => s.id)).toContain('conv-3')
    })

    it('creates "No workspace" group for workspace-less conversations', () => {
      const sessions = toAssistantSessions(conversations)
      const groups = groupSessions(sessions, 'workspace')

      const noWsGroup = groups.find((g) => g.key === '__no_workspace__')
      expect(noWsGroup).toBeDefined()
      expect(noWsGroup?.sessions).toHaveLength(1)
      expect(noWsGroup?.sessions[0].id).toBe('conv-4')
    })

    it('falls back to date grouping when no workspaces exist', () => {
      const noWorkspaceConvs: HistoryConversation[] = [
        {
          id: 'conv-1',
          lastMessagedAt: baseTime,
          lastUserMessage: 'Hello',
        },
        {
          id: 'conv-2',
          lastMessagedAt: baseTime - 7 * 86400_000,
          lastUserMessage: 'Old message',
        },
      ]
      const sessions = toAssistantSessions(noWorkspaceConvs)
      const groups = groupSessions(sessions, 'workspace')

      // Should fall back to date grouping
      expect(groups.length).toBeGreaterThan(0)
      expect(groups.every((g) => g.icon === 'date')).toBe(true)
    })

    it('sorts groups by session count descending', () => {
      const sessions = toAssistantSessions(conversations)
      const groups = groupSessions(sessions, 'workspace')

      for (let i = 1; i < groups.length; i++) {
        expect(groups[i - 1].sessions.length).toBeGreaterThanOrEqual(
          groups[i].sessions.length,
        )
      }
    })
  })
})
