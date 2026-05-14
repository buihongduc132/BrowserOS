import { describe, expect, it } from 'bun:test'
import { groupSessions } from './useSessionGrouping'
import type { GroupingMode, AssistantSession, SessionGroup } from './useSessionGrouping'

// Helper to create test sessions
function makeSession(overrides: Partial<AssistantSession> & { id: string }): AssistantSession {
  return {
    title: 'Test session',
    workspaces: [],
    tags: [],
    updatedAt: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('groupSessions', () => {
  // ─── Empty input ───
  it('returns empty groups for empty sessions (workspace mode)', () => {
    const result = groupSessions([], 'workspace')
    expect(result).toEqual([])
  })

  it('returns empty groups for empty sessions (tag mode)', () => {
    const result = groupSessions([], 'tag')
    expect(result).toEqual([])
  })

  it('returns empty groups for empty sessions (date mode)', () => {
    const result = groupSessions([], 'date')
    expect(result).toEqual([])
  })

  // ─── Workspace grouping ───
  it('groups sessions by workspace ID', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '2', workspaces: [{ id: 'ws-2', name: 'backend', path: '/backend' }] }),
      makeSession({ id: '3', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    expect(result.length).toBe(2)

    const frontend = result.find((g) => g.key === 'ws-1')!
    expect(frontend).toBeDefined()
    expect(frontend.label).toBe('frontend')
    expect(frontend.sessions.length).toBe(2)
    expect(frontend.sessions.map((s) => s.id).sort()).toEqual(['1', '3'])

    const backend = result.find((g) => g.key === 'ws-2')!
    expect(backend).toBeDefined()
    expect(backend.sessions.length).toBe(1)
  })

  it('multi-workspace session appears in multiple groups', () => {
    const sessions = [
      makeSession({
        id: '1',
        workspaces: [
          { id: 'ws-1', name: 'frontend', path: '/frontend' },
          { id: 'ws-2', name: 'backend', path: '/backend' },
        ],
      }),
    ]

    const result = groupSessions(sessions, 'workspace')
    expect(result.length).toBe(2)

    const frontend = result.find((g) => g.key === 'ws-1')!
    expect(frontend.sessions.length).toBe(1)
    expect(frontend.sessions[0].id).toBe('1')

    const backend = result.find((g) => g.key === 'ws-2')!
    expect(backend.sessions.length).toBe(1)
    expect(backend.sessions[0].id).toBe('1')
  })

  it('sessions with 0 workspaces fall back to date grouping (no workspace group)', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [] }),
      makeSession({ id: '2', workspaces: [] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    // When ALL sessions have 0 workspaces → fall back to date grouping
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((g) => g.icon === 'date')).toBe(true)
  })

  it('sessions with 0 workspaces mixed with workspace sessions go to no-workspace group', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '2', workspaces: [] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    const noWs = result.find((g) => g.key === '__no_workspace__')
    expect(noWs).toBeDefined()
    expect(noWs!.sessions.length).toBe(1)
    expect(noWs!.sessions[0].id).toBe('2')
  })

  it('falls back to date grouping when no sessions have workspaces', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [], updatedAt: Date.now() }),
      makeSession({ id: '2', workspaces: [], updatedAt: Date.now() - 86400000 * 8 }),
    ]

    const result = groupSessions(sessions, 'workspace')
    // Should fall back to date grouping
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every((g) => g.icon === 'date')).toBe(true)
  })

  it('groups are sorted by session count descending', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '2', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '3', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '4', workspaces: [{ id: 'ws-2', name: 'backend', path: '/backend' }] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    expect(result.length).toBe(2)
    expect(result[0].key).toBe('ws-1') // 3 sessions first
    expect(result[1].key).toBe('ws-2') // 1 session second
  })

  it('mixed: some with workspaces, some without', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '2', workspaces: [] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    expect(result.length).toBe(2)
    const wsGroup = result.find((g) => g.key === 'ws-1')
    const noWsGroup = result.find((g) => g.key === '__no_workspace__')
    expect(wsGroup).toBeDefined()
    expect(noWsGroup).toBeDefined()
  })

  // ─── Tag grouping ───
  it('groups by tags', () => {
    const sessions = [
      makeSession({ id: '1', tags: ['bug'] }),
      makeSession({ id: '2', tags: ['feature'] }),
      makeSession({ id: '3', tags: ['bug'] }),
    ]

    const result = groupSessions(sessions, 'tag')
    expect(result.length).toBe(2)

    const bugGroup = result.find((g) => g.key === 'tag:bug')!
    expect(bugGroup.sessions.length).toBe(2)

    const featureGroup = result.find((g) => g.key === 'tag:feature')!
    expect(featureGroup.sessions.length).toBe(1)
  })

  it('multi-tag session appears in multiple tag groups', () => {
    const sessions = [
      makeSession({ id: '1', tags: ['bug', 'urgent'] }),
    ]

    const result = groupSessions(sessions, 'tag')
    expect(result.length).toBe(2)

    const bugGroup = result.find((g) => g.key === 'tag:bug')!
    expect(bugGroup.sessions[0].id).toBe('1')

    const urgentGroup = result.find((g) => g.key === 'tag:urgent')!
    expect(urgentGroup.sessions[0].id).toBe('1')
  })

  it('untagged sessions go to "Untagged" group', () => {
    const sessions = [
      makeSession({ id: '1', tags: [] }),
    ]

    const result = groupSessions(sessions, 'tag')
    expect(result.length).toBe(1)
    expect(result[0].key).toBe('__untagged__')
    expect(result[0].label).toBe('Untagged')
  })

  // ─── Date grouping ───
  it('groups by date boundaries', () => {
    const now = Date.now()
    const sessions = [
      makeSession({ id: '1', updatedAt: now }), // today
      makeSession({ id: '2', updatedAt: now - 86400000 * 2 }), // this week
      makeSession({ id: '3', updatedAt: now - 86400000 * 10 }), // this month
      makeSession({ id: '4', updatedAt: now - 86400000 * 40 }), // older
    ]

    const result = groupSessions(sessions, 'date')
    expect(result.length).toBe(4)

    const labels = result.map((g) => g.label)
    expect(labels).toContain('Today')
    expect(labels).toContain('This Week')
    expect(labels).toContain('This Month')
    expect(labels).toContain('Older')
  })

  it('each session in exactly one date group', () => {
    const now = Date.now()
    const sessions = [
      makeSession({ id: '1', updatedAt: now }),
      makeSession({ id: '2', updatedAt: now - 86400000 * 3 }),
      makeSession({ id: '3', updatedAt: now - 86400000 * 15 }),
      makeSession({ id: '4', updatedAt: now - 86400000 * 50 }),
    ]

    const result = groupSessions(sessions, 'date')
    const totalSessions = result.reduce((sum, g) => sum + g.sessions.length, 0)
    expect(totalSessions).toBe(4)
  })

  // ─── Sorting within groups ───
  it('sessions sorted within groups by updatedAt descending', () => {
    const now = Date.now()
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }], updatedAt: now - 1000 }),
      makeSession({ id: '2', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }], updatedAt: now }),
      makeSession({ id: '3', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }], updatedAt: now - 5000 }),
    ]

    const result = groupSessions(sessions, 'workspace')
    const group = result.find((g) => g.key === 'ws-1')!
    expect(group.sessions.map((s) => s.id)).toEqual(['2', '1', '3'])
  })

  // ─── Edge: workspace fallback NOT triggered when at least 1 has workspace ───
  it('does NOT fall back to date when some sessions have workspaces', () => {
    const sessions = [
      makeSession({ id: '1', workspaces: [{ id: 'ws-1', name: 'frontend', path: '/frontend' }] }),
      makeSession({ id: '2', workspaces: [] }),
    ]

    const result = groupSessions(sessions, 'workspace')
    // Should have workspace groups, not date groups
    expect(result.some((g) => g.icon === 'workspace')).toBe(true)
  })
})
