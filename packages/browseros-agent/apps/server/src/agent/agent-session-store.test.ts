/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { AgentSessionStore } from './agent-session-store'

describe('AgentSessionStore', () => {
  // ─── Worst-first: concurrent access, ref-count edges, missing agent ───

  describe('concurrent open/close (ref-counted lifecycle)', () => {
    it('removes session only after all refs are closed', () => {
      const store = new AgentSessionStore()
      const id = 'sess-1'

      // Open 5 times
      for (let i = 0; i < 5; i++) {
        const s = store.open('agent-a', id)
        expect(s.refCount).toBe(i + 1)
      }

      // Close 4 times — should still exist
      for (let i = 0; i < 4; i++) {
        const removed = store.close(id)
        if (i < 3) expect(removed).toBe(false) // not fully removed yet
      }

      expect(store.has(id)).toBe(true)
      expect(store.get(id)!.refCount).toBe(1)

      // Final close — should remove
      const removed = store.close(id)
      expect(removed).toBe(true)
      expect(store.has(id)).toBe(false)
    })

    it('returns correct ActiveSession on each open', () => {
      const store = new AgentSessionStore()

      const s1 = store.open('agent-a', 'sess-1')
      expect(s1.sessionId).toBe('sess-1')
      expect(s1.agentId).toBe('agent-a')
      expect(s1.refCount).toBe(1)

      const s2 = store.open('agent-a', 'sess-1')
      expect(s2.refCount).toBe(2)
      expect(s2).toBe(s1) // same object reference
    })
  })

  describe('double close (idempotency)', () => {
    it('returns false when closing already-removed session', () => {
      const store = new AgentSessionStore()
      store.open('agent-a', 'sess-1')

      const first = store.close('sess-1')
      expect(first).toBe(true)

      const second = store.close('sess-1')
      expect(second).toBe(false)
    })

    it('does not crash on repeated close calls', () => {
      const store = new AgentSessionStore()
      store.open('agent-a', 'sess-1')
      store.close('sess-1')
      store.close('sess-1')
      store.close('sess-1')

      expect(store.size).toBe(0)
    })
  })

  describe('unknown session operations', () => {
    it('returns false when closing non-existent session', () => {
      const store = new AgentSessionStore()
      const result = store.close('does-not-exist')
      expect(result).toBe(false)
    })

    it('returns undefined for get on non-existent session', () => {
      const store = new AgentSessionStore()
      expect(store.get('ghost')).toBeUndefined()
    })

    it('returns false for has on non-existent session', () => {
      const store = new AgentSessionStore()
      expect(store.has('ghost')).toBe(false)
    })
  })

  describe('list by agent (grouping)', () => {
    it('groups sessions correctly by agent', () => {
      const store = new AgentSessionStore()

      // 3 sessions for agent-a
      store.open('agent-a', 'sess-a1')
      store.open('agent-a', 'sess-a2')
      store.open('agent-a', 'sess-a3')

      // 2 sessions for agent-b
      store.open('agent-b', 'sess-b1')
      store.open('agent-b', 'sess-b2')

      const agentA = store.listByAgent('agent-a')
      expect(agentA).toHaveLength(3)
      expect(agentA.map((s) => s.sessionId).sort()).toEqual([
        'sess-a1',
        'sess-a2',
        'sess-a3',
      ])

      const agentB = store.listByAgent('agent-b')
      expect(agentB).toHaveLength(2)
      expect(agentB.map((s) => s.sessionId).sort()).toEqual([
        'sess-b1',
        'sess-b2',
      ])
    })

    it('returns empty array for agent with no sessions', () => {
      const store = new AgentSessionStore()
      store.open('agent-a', 'sess-1')
      expect(store.listByAgent('agent-b')).toEqual([])
    })

    it('does not list closed sessions', () => {
      const store = new AgentSessionStore()
      store.open('agent-a', 'sess-1')
      store.open('agent-a', 'sess-2')
      store.close('sess-1')

      const list = store.listByAgent('agent-a')
      expect(list).toHaveLength(1)
      expect(list[0].sessionId).toBe('sess-2')
    })
  })

  describe('pending load dedup', () => {
    it('concurrent opens for same ID share one session object', () => {
      const store = new AgentSessionStore()

      // Simulate concurrent opens (synchronous in this test, but validates dedup)
      const results = []
      for (let i = 0; i < 10; i++) {
        results.push(store.open('agent-a', 'shared-id'))
      }

      // All should be the same object reference
      for (const r of results) {
        expect(r).toBe(results[0])
      }
      expect(results[0].refCount).toBe(10)
    })
  })

  describe('ref count never goes negative', () => {
    it('rapid open/close cycles maintain valid state', () => {
      const store = new AgentSessionStore()

      // Open 3, close 3, open 1, close 1
      store.open('agent-a', 'sess-1')
      store.open('agent-a', 'sess-1')
      store.open('agent-a', 'sess-1')
      store.close('sess-1')
      store.close('sess-1')
      store.close('sess-1')

      expect(store.has('sess-1')).toBe(false)
      expect(store.size).toBe(0)

      // Re-open after full close
      const s = store.open('agent-a', 'sess-1')
      expect(s.refCount).toBe(1)
    })

    it('extra closes beyond ref count are no-ops', () => {
      const store = new AgentSessionStore()
      store.open('agent-a', 'sess-1')

      // Close more times than opens
      store.close('sess-1')
      store.close('sess-1')
      store.close('sess-1')

      // Re-open should work fresh
      const s = store.open('agent-a', 'sess-1')
      expect(s.refCount).toBe(1)
    })
  })

  describe('basic CRUD', () => {
    it('open → get → has → list → size → close', () => {
      const store = new AgentSessionStore()

      // Open
      const s = store.open('agent-x', 'sess-crud')
      expect(s.sessionId).toBe('sess-crud')
      expect(s.agentId).toBe('agent-x')
      expect(s.refCount).toBe(1)
      expect(typeof s.createdAt).toBe('number')

      // Get
      expect(store.get('sess-crud')).toBe(s)

      // Has
      expect(store.has('sess-crud')).toBe(true)
      expect(store.has('other')).toBe(false)

      // List
      const list = store.listByAgent('agent-x')
      expect(list).toHaveLength(1)
      expect(list[0]).toBe(s)

      // Size
      expect(store.size).toBe(1)

      // Close
      const removed = store.close('sess-crud')
      expect(removed).toBe(true)
      expect(store.size).toBe(0)
      expect(store.has('sess-crud')).toBe(false)
    })

    it('tracks size across multiple agents', () => {
      const store = new AgentSessionStore()

      store.open('a1', 's1')
      store.open('a1', 's2')
      store.open('a2', 's3')

      expect(store.size).toBe(3)

      store.close('s2')
      expect(store.size).toBe(2)
    })
  })
})
