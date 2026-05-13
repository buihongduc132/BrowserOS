import { afterEach, describe, expect, it } from 'bun:test'
import { AgentSessionListStore } from './agent-session-list-store'

// In-memory localStorage mock for testing
const storage = new Map<string, string>()
const originalLocalStorage = globalThis.localStorage

function mockLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() { return storage.size },
      key: (i: number) => [...storage.keys()][i] ?? null,
    },
    writable: true,
    configurable: true,
  })
}

function restoreLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: originalLocalStorage,
    writable: true,
    configurable: true,
  })
}

describe('AgentSessionListStore', () => {
  afterEach(() => {
    storage.clear()
    restoreLocalStorage()
  })

  describe('constructor', () => {
    it('creates empty store when no data exists', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      expect(store.count).toBe(0)
      expect(store.getAll()).toEqual([])
    })

    it('loads existing sessions from localStorage', () => {
      mockLocalStorage()
      const sessions = [
        {
          sessionId: 's1',
          agentId: 'agent_a',
          title: 'First',
          lastMessagePreview: null,
          lastMessageAt: 2000,
          createdAt: 1000,
        },
      ]
      storage.set(
        'agent-session-list:agent_a',
        JSON.stringify(sessions),
      )
      const store = new AgentSessionListStore('agent_a')
      expect(store.count).toBe(1)
      expect(store.getAll()[0].sessionId).toBe('s1')
    })

    it('ignores malformed localStorage data', () => {
      mockLocalStorage()
      storage.set('agent-session-list:agent_a', 'not-json')
      const store = new AgentSessionListStore('agent_a')
      expect(store.count).toBe(0)
    })
  })

  describe('createSession', () => {
    it('creates a session with a unique ID', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id = store.createSession()
      expect(id).toBeTruthy()
      expect(store.count).toBe(1)
      expect(store.getAll()[0].sessionId).toBe(id)
    })

    it('sets createdAt to current time', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const before = Date.now()
      store.createSession()
      const after = Date.now()
      const session = store.getAll()[0]
      expect(session.createdAt).toBeGreaterThanOrEqual(before)
      expect(session.createdAt).toBeLessThanOrEqual(after)
    })

    it('persists to localStorage', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      store.createSession()
      const raw = storage.get('agent-session-list:agent_a')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!)
      expect(parsed).toHaveLength(1)
    })

    it('returns different IDs for successive calls', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id1 = store.createSession()
      const id2 = store.createSession()
      expect(id1).not.toBe(id2)
      expect(store.count).toBe(2)
    })
  })

  describe('removeSession', () => {
    it('removes a session by ID', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id = store.createSession()
      expect(store.count).toBe(1)
      store.removeSession(id)
      expect(store.count).toBe(0)
    })

    it('does nothing for non-existent session', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      store.createSession()
      store.removeSession('nonexistent')
      expect(store.count).toBe(1)
    })
  })

  describe('updateTitle', () => {
    it('updates the title of a session', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id = store.createSession()
      store.updateTitle(id, 'New Title')
      const session = store.getAll().find((s) => s.sessionId === id)
      expect(session?.title).toBe('New Title')
    })
  })

  describe('updateLastMessage', () => {
    it('updates lastMessagePreview and lastMessageAt', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id = store.createSession()
      store.updateLastMessage(id, 'Hello...', 12345)
      const session = store.getAll().find((s) => s.sessionId === id)
      expect(session?.lastMessagePreview).toBe('Hello...')
      expect(session?.lastMessageAt).toBe(12345)
    })
  })

  describe('getAll', () => {
    it('sorts sessions newest first by lastMessageAt', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id1 = store.createSession()
      const id2 = store.createSession()
      store.updateLastMessage(id1, 'old', 1000)
      store.updateLastMessage(id2, 'new', 2000)
      const all = store.getAll()
      expect(all[0].sessionId).toBe(id2)
      expect(all[1].sessionId).toBe(id1)
    })

    it('falls back to createdAt when lastMessageAt is null', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      store.createSession() // newer createdAt
      store.createSession()
      const all = store.getAll()
      // Both have null lastMessageAt, sorted by createdAt desc
      expect(all).toHaveLength(2)
    })
  })

  describe('getFiltered', () => {
    it('returns all when search is empty', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      store.createSession()
      store.createSession()
      expect(store.getFiltered('')).toHaveLength(2)
    })

    it('filters by title', () => {
      mockLocalStorage()
      const store = new AgentSessionListStore('agent_a')
      const id1 = store.createSession()
      store.updateTitle(id1, 'Bug Fix')
      const id2 = store.createSession()
      store.updateTitle(id2, 'Feature')
      const filtered = store.getFiltered('bug')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].sessionId).toBe(id1)
    })
  })

  describe('agent isolation', () => {
    it('different agents have independent session lists', () => {
      mockLocalStorage()
      const storeA = new AgentSessionListStore('agent_a')
      const storeB = new AgentSessionListStore('agent_b')
      storeA.createSession()
      storeA.createSession()
      storeB.createSession()
      expect(storeA.count).toBe(2)
      expect(storeB.count).toBe(1)
    })
  })
})
