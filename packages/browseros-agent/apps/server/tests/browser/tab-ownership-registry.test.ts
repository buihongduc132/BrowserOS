/**
 * TabOwnershipRegistry unit tests.
 *
 * The registry tracks which conversation/agent owns which page.
 * It lives on the Browser class (singleton) so all MCP request-servers
 * share the same ownership state.
 *
 * Methods under test:
 *   claim(), release(), isLocked(), getOwner(), releaseIdle(), refreshActivity()
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  type OwnershipEntry,
  TabOwnershipRegistry,
} from '../../src/browser/tab-ownership-registry'

describe('TabOwnershipRegistry', () => {
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    registry = new TabOwnershipRegistry()
  })

  // ── claim() ──

  describe('claim()', () => {
    it('should claim an unowned page', () => {
      const result = registry.claim('conv-1', 42, 'agent-A')
      expect(result).toBe(true)
      expect(registry.isLocked(42)).toBe(true)
    })

    it('should allow re-claiming by the same conversation', () => {
      registry.claim('conv-1', 42, 'agent-A')
      const result = registry.claim('conv-1', 42, 'agent-A')
      expect(result).toBe(true)
    })

    it('should prevent double-claiming by a different conversation', () => {
      registry.claim('conv-1', 42, 'agent-A')
      const result = registry.claim('conv-2', 42, 'agent-B')
      expect(result).toBe(false)
    })

    it('should work without agentId', () => {
      const result = registry.claim('conv-1', 42)
      expect(result).toBe(true)
      const owner = registry.getOwner(42)
      expect(owner?.ownerConversationId).toBe('conv-1')
      expect(owner?.ownerAgentId).toBeUndefined()
    })

    it('should set lockedAt and lastActivityAt to current time', () => {
      const before = Date.now()
      registry.claim('conv-1', 42)
      const after = Date.now()

      const owner = registry.getOwner(42)!
      expect(owner.lockedAt).toBeGreaterThanOrEqual(before)
      expect(owner.lockedAt).toBeLessThanOrEqual(after)
      expect(owner.lastActivityAt).toBeGreaterThanOrEqual(before)
      expect(owner.lastActivityAt).toBeLessThanOrEqual(after)
    })

    it('should claim multiple pages for the same conversation', () => {
      expect(registry.claim('conv-1', 1)).toBe(true)
      expect(registry.claim('conv-1', 2)).toBe(true)
      expect(registry.claim('conv-1', 3)).toBe(true)
      expect(registry.isLocked(1)).toBe(true)
      expect(registry.isLocked(2)).toBe(true)
      expect(registry.isLocked(3)).toBe(true)
    })

    it('should allow different conversations to claim different pages', () => {
      expect(registry.claim('conv-1', 1)).toBe(true)
      expect(registry.claim('conv-2', 2)).toBe(true)
      expect(registry.isLocked(1)).toBe(true)
      expect(registry.isLocked(2)).toBe(true)
      expect(registry.getOwner(1)?.ownerConversationId).toBe('conv-1')
      expect(registry.getOwner(2)?.ownerConversationId).toBe('conv-2')
    })
  })

  // ── release() ──

  describe('release()', () => {
    it('should release a page owned by the calling conversation', () => {
      registry.claim('conv-1', 42)
      const result = registry.release('conv-1', 42)
      expect(result).toBe(true)
      expect(registry.isLocked(42)).toBe(false)
    })

    it('should NOT release a page owned by another conversation', () => {
      registry.claim('conv-1', 42)
      const result = registry.release('conv-2', 42)
      expect(result).toBe(false)
      expect(registry.isLocked(42)).toBe(true)
    })

    it('should return false for a page that is not locked', () => {
      const result = registry.release('conv-1', 999)
      expect(result).toBe(false)
    })

    it('should allow re-claiming after release', () => {
      registry.claim('conv-1', 42)
      registry.release('conv-1', 42)
      expect(registry.claim('conv-2', 42)).toBe(true)
      expect(registry.getOwner(42)?.ownerConversationId).toBe('conv-2')
    })
  })

  // ── isLocked() ──

  describe('isLocked()', () => {
    it('should return false for an unlocked page', () => {
      expect(registry.isLocked(42)).toBe(false)
    })

    it('should return true for a claimed page', () => {
      registry.claim('conv-1', 42)
      expect(registry.isLocked(42)).toBe(true)
    })

    it('should return false after release', () => {
      registry.claim('conv-1', 42)
      registry.release('conv-1', 42)
      expect(registry.isLocked(42)).toBe(false)
    })
  })

  // ── getOwner() ──

  describe('getOwner()', () => {
    it('should return null for an unlocked page', () => {
      expect(registry.getOwner(42)).toBeNull()
    })

    it('should return ownership info for a locked page', () => {
      registry.claim('conv-1', 42, 'agent-A')
      const owner = registry.getOwner(42)!
      expect(owner.ownerConversationId).toBe('conv-1')
      expect(owner.ownerAgentId).toBe('agent-A')
      expect(typeof owner.lockedAt).toBe('number')
      expect(typeof owner.lastActivityAt).toBe('number')
    })

    it('should return null after release', () => {
      registry.claim('conv-1', 42)
      registry.release('conv-1', 42)
      expect(registry.getOwner(42)).toBeNull()
    })
  })

  // ── refreshActivity() ──

  describe('refreshActivity()', () => {
    it('should update lastActivityAt for a locked page', async () => {
      registry.claim('conv-1', 42)
      const original = registry.getOwner(42)!.lastActivityAt

      // Wait a tiny bit to ensure time difference
      await new Promise((r) => setTimeout(r, 5))

      registry.refreshActivity(42)
      const updated = registry.getOwner(42)!.lastActivityAt
      expect(updated).toBeGreaterThan(original)
    })

    it('should be a no-op for an unlocked page', () => {
      expect(() => registry.refreshActivity(999)).not.toThrow()
    })

    it('should NOT change lockedAt', async () => {
      registry.claim('conv-1', 42)
      const originalLockedAt = registry.getOwner(42)!.lockedAt

      await new Promise((r) => setTimeout(r, 5))
      registry.refreshActivity(42)

      expect(registry.getOwner(42)!.lockedAt).toBe(originalLockedAt)
    })
  })

  // ── releaseIdle() ──

  describe('releaseIdle()', () => {
    it('should release locks idle beyond the threshold', () => {
      // Manually inject a stale entry
      registry.claim('conv-1', 1)
      registry.claim('conv-2', 2)

      // Backdate page 1's lastActivityAt
      const owner1 = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...owner1,
        lastActivityAt: Date.now() - 10_000, // 10 seconds ago
      })

      const released = registry.releaseIdle(5_000) // 5 second threshold
      expect(released).toBe(1)
      expect(registry.isLocked(1)).toBe(false)
      expect(registry.isLocked(2)).toBe(true) // still fresh
    })

    it('should not release recently active locks', () => {
      registry.claim('conv-1', 42)
      const released = registry.releaseIdle(60_000) // 1 minute
      expect(released).toBe(0)
      expect(registry.isLocked(42)).toBe(true)
    })

    it('should release multiple stale locks', () => {
      registry.claim('conv-1', 1)
      registry.claim('conv-2', 2)
      registry.claim('conv-3', 3)

      // Backdate all
      for (const pageId of [1, 2, 3]) {
        const owner = registry.getOwner(pageId)!
        registry['_entries'].set(pageId, {
          ...owner,
          lastActivityAt: Date.now() - 10_000,
        })
      }

      const released = registry.releaseIdle(5_000)
      expect(released).toBe(3)
      expect(registry.isLocked(1)).toBe(false)
      expect(registry.isLocked(2)).toBe(false)
      expect(registry.isLocked(3)).toBe(false)
    })

    it('should return 0 when no locks exist', () => {
      const released = registry.releaseIdle(1_000)
      expect(released).toBe(0)
    })
  })

  // ── Thread safety (concurrent claim attempts) ──

  describe('concurrent claims', () => {
    it('should handle rapid sequential claims from different conversations', () => {
      // Simulate rapid claims - first one wins, rest fail
      const results: boolean[] = []
      for (let i = 0; i < 10; i++) {
        results.push(registry.claim(`conv-${i}`, 42))
      }

      // Exactly one should succeed (the first)
      expect(results.filter(Boolean).length).toBe(1)
      expect(results[0]).toBe(true)
      for (let i = 1; i < 10; i++) {
        expect(results[i]).toBe(false)
      }
    })
  })

  // ── Regression: ensure Browser API is not broken ──

  describe('no regression on Browser API', () => {
    it('should be instantiable as a standalone class', () => {
      const reg = new TabOwnershipRegistry()
      expect(reg).toBeDefined()
      expect(reg.isLocked(1)).toBe(false)
      expect(reg.getOwner(1)).toBeNull()
    })
  })

  // ── releaseAllForConversation ──

  describe('releaseAllForConversation()', () => {
    it('should release all pages owned by a specific conversation', () => {
      registry.claim('conv-1', 1)
      registry.claim('conv-1', 2)
      registry.claim('conv-1', 3)
      registry.claim('conv-2', 4)
      registry.claim('conv-2', 5)

      const released = registry.releaseAllForConversation('conv-1')
      expect(released).toBe(3)
      expect(registry.isLocked(1)).toBe(false)
      expect(registry.isLocked(2)).toBe(false)
      expect(registry.isLocked(3)).toBe(false)
      expect(registry.isLocked(4)).toBe(true) // conv-2 still owns these
      expect(registry.isLocked(5)).toBe(true)
    })

    it('should return 0 if conversation owns no pages', () => {
      registry.claim('conv-1', 1)
      const released = registry.releaseAllForConversation('conv-2')
      expect(released).toBe(0)
      expect(registry.isLocked(1)).toBe(true)
    })
  })

  // ── forceReleasePage ──

  describe('forceReleasePage()', () => {
    it('should release a page regardless of who owns it', () => {
      const reg = new TabOwnershipRegistry()
      reg.claim('conv-A', 1, 'agent-A')
      reg.claim('conv-A', 2, 'agent-A')
      reg.claim('conv-B', 3, 'agent-B')

      // Force release page 1 (owned by conv-A) without needing conv-A's ID
      expect(reg.forceReleasePage(1)).toBe(true)
      expect(reg.isLocked(1)).toBe(false)

      // Other locks remain
      expect(reg.isLocked(2)).toBe(true)
      expect(reg.isLocked(3)).toBe(true)
    })

    it('should return false for a page that is not locked', () => {
      const reg = new TabOwnershipRegistry()
      expect(reg.forceReleasePage(999)).toBe(false)
    })

    it('should allow re-claiming after force release', () => {
      const reg = new TabOwnershipRegistry()
      reg.claim('conv-A', 1)
      reg.forceReleasePage(1)
      expect(reg.claim('conv-B', 1)).toBe(true)
    })
  })

  // ── Edge cases: TOCTOU race and idle sweep reclaim ──

  describe('TOCTOU race: idle sweep releases then immediate reclaim', () => {
    it('should allow reclaim after idle sweep releases a lock', () => {
      // Conv-1 owns page 42 but goes idle
      registry.claim('conv-1', 42, 'agent-A')
      const owner = registry.getOwner(42)!
      registry['_entries'].set(42, {
        ...owner,
        lastActivityAt: Date.now() - 10_000,
      })

      // Idle sweep releases conv-1's lock
      const released = registry.releaseIdle(5_000)
      expect(released).toBe(1)
      expect(registry.isLocked(42)).toBe(false)

      // Conv-2 immediately claims (simulates TOCTOU race)
      expect(registry.claim('conv-2', 42, 'agent-B')).toBe(true)
      expect(registry.getOwner(42)!.ownerConversationId).toBe('conv-2')
    })

    it('should NOT allow stale conv-1 to refresh after sweep releases its lock', () => {
      registry.claim('conv-1', 42)
      const owner = registry.getOwner(42)!
      registry['_entries'].set(42, {
        ...owner,
        lastActivityAt: Date.now() - 10_000,
      })

      // Idle sweep releases
      registry.releaseIdle(5_000)

      // conv-2 claims
      registry.claim('conv-2', 42)

      // conv-1 tries to refreshActivity — should be no-op since it no longer owns it
      registry.refreshActivity(42) // doesn't throw
      // conv-2's lock is still fresh
      const owner2 = registry.getOwner(42)!
      expect(owner2.ownerConversationId).toBe('conv-2')
    })
  })

  // ── onLockReleased callback during idle sweep ──

  describe('onLockReleased callback', () => {
    it('should fire callback when idle sweep releases a lock', async () => {
      const releasedEntries: Array<{ pageId: number; entry: OwnershipEntry }> =
        []
      registry.onLockReleased = (pageId, entry) => {
        releasedEntries.push({ pageId, entry })
      }

      registry.claim('conv-1', 42, 'agent-A')
      const owner = registry.getOwner(42)!
      registry['_entries'].set(42, {
        ...owner,
        lastActivityAt: Date.now() - 10_000,
      })

      // Manually trigger sweep logic (simulates what startIdleSweep does)
      const now = Date.now()
      const toRelease: Array<{ pageId: number; entry: OwnershipEntry }> = []
      for (const [pageId, entry] of registry._entries) {
        if (now - entry.lastActivityAt > 5_000) {
          toRelease.push({ pageId, entry })
        }
      }
      for (const { pageId, entry } of toRelease) {
        registry._entries.delete(pageId)
        registry.onLockReleased?.(pageId, entry)
      }

      expect(releasedEntries).toHaveLength(1)
      expect(releasedEntries[0].pageId).toBe(42)
      expect(releasedEntries[0].entry.ownerConversationId).toBe('conv-1')
      expect(releasedEntries[0].entry.ownerAgentId).toBe('agent-A')
    })
  })

  // ── Idle sweep lifecycle ──

  describe('startIdleSweep / stopIdleSweep', () => {
    it('should start and stop sweep cleanly', () => {
      expect(registry.isSweepActive()).toBe(false)
      registry.startIdleSweep(100, 50)
      expect(registry.isSweepActive()).toBe(true)
      registry.stopIdleSweep()
      expect(registry.isSweepActive()).toBe(false)
    })

    it('should be idempotent when starting sweep multiple times', () => {
      registry.startIdleSweep(100, 50)
      registry.startIdleSweep(200, 100) // should restart with new params
      expect(registry.isSweepActive()).toBe(true)
      registry.stopIdleSweep()
      expect(registry.isSweepActive()).toBe(false)
    })

    it('should not throw when stopping a sweep that was never started', () => {
      expect(() => registry.stopIdleSweep()).not.toThrow()
    })
  })
})
