import { describe, expect, it } from 'bun:test'
import {
  filterSessionsBySearch,
  generateSessionId,
  type AgentSession,
} from './agent-session-list-types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: 'sess_001',
    agentId: 'agent_a',
    title: 'Test Session',
    lastMessagePreview: 'Hello world',
    lastMessageAt: 1000,
    createdAt: 500,
    ...overrides,
  }
}

describe('agent-session-list-types', () => {
  describe('filterSessionsBySearch', () => {
    it('returns the same array reference when search is empty', () => {
      const sessions = [makeSession()]
      const result = filterSessionsBySearch(sessions, '')
      expect(result).toBe(sessions)
    })

    it('returns the same array reference when search is whitespace only', () => {
      const sessions = [makeSession()]
      const result = filterSessionsBySearch(sessions, '   ')
      expect(result).toBe(sessions)
    })

    it('filters by title (case-insensitive)', () => {
      const sessions = [
        makeSession({ sessionId: 'a', title: 'Fix Login Bug' }),
        makeSession({ sessionId: 'b', title: 'Add Feature' }),
        makeSession({ sessionId: 'c', title: null }),
      ]
      const result = filterSessionsBySearch(sessions, 'login')
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('a')
    })

    it('filters by sessionId', () => {
      const sessions = [
        makeSession({ sessionId: 'abc-123' }),
        makeSession({ sessionId: 'def-456' }),
      ]
      const result = filterSessionsBySearch(sessions, 'def')
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('def-456')
    })

    it('returns empty array when nothing matches', () => {
      const sessions = [makeSession({ title: 'Hello' })]
      const result = filterSessionsBySearch(sessions, 'xyz')
      expect(result).toHaveLength(0)
    })

    it('matches sessions with null title against sessionId only', () => {
      const sessions = [
        makeSession({ sessionId: 'special-id', title: null }),
        makeSession({ sessionId: 'other', title: 'Special Title' }),
      ]
      const result = filterSessionsBySearch(sessions, 'special')
      expect(result).toHaveLength(2)
    })
  })

  describe('generateSessionId', () => {
    it('produces a non-empty string', () => {
      const id = generateSessionId()
      expect(id.length).toBeGreaterThan(0)
    })

    it('produces unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()))
      expect(ids.size).toBe(20)
    })
  })
})
