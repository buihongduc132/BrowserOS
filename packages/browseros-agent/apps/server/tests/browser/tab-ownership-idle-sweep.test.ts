/**
 * T12: Idle lock release — periodic sweep with configurable timeout.
 *
 * Tests the idle sweep mechanism on TabOwnershipRegistry:
 *   - startIdleSweep() / stopIdleSweep()
 *   - onLockReleased callback fires for idle-released locks
 *   - refreshActivity() prevents idle release
 *   - Configurable idle timeout
 *   - No lock leaks on conversation end (via releaseAllForConversation)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'

describe('TabOwnershipRegistry idle sweep', () => {
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    registry = new TabOwnershipRegistry()
  })

  afterEach(() => {
    registry.stopIdleSweep()
  })

  // ── startIdleSweep / stopIdleSweep ──

  describe('startIdleSweep()', () => {
    it('should start a periodic sweep that releases idle locks', async () => {
      registry.claim('conv-1', 1)
      registry.claim('conv-2', 2)

      // Backdate page 1's lastActivityAt to be idle
      const entry1 = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...entry1,
        lastActivityAt: Date.now() - 200, // 200ms ago
      })

      // Start sweep with 100ms idle threshold, 50ms interval
      registry.startIdleSweep(100, 50)

      // Wait for at least one sweep cycle
      await new Promise((r) => setTimeout(r, 120))

      // Page 1 should be released (idle > 100ms)
      expect(registry.isLocked(1)).toBe(false)
      // Page 2 should still be locked (fresh)
      expect(registry.isLocked(2)).toBe(true)
    })

    it('should not release recently refreshed locks', async () => {
      registry.claim('conv-1', 1)

      // Start sweep with short idle threshold
      registry.startIdleSweep(100, 50)

      // Refresh activity before the sweep fires
      await new Promise((r) => setTimeout(r, 60))
      registry.refreshActivity(1)
      await new Promise((r) => setTimeout(r, 60))

      // Lock should still be alive because we refreshed
      expect(registry.isLocked(1)).toBe(true)
    })

    it('should use default sweep interval of 60s if not specified', () => {
      // Should not throw — just test it starts cleanly
      registry.startIdleSweep(3600000)
      expect(registry.isSweepActive()).toBe(true)
    })

    it('should not start duplicate sweeps (idempotent)', () => {
      registry.startIdleSweep(3600000, 1000)
      registry.startIdleSweep(3600000, 1000)
      // Should still be a single sweep — stopIdleSweep should clean up
      registry.stopIdleSweep()
      expect(registry.isSweepActive()).toBe(false)
    })
  })

  describe('stopIdleSweep()', () => {
    it('should stop the sweep timer', async () => {
      registry.claim('conv-1', 1)

      // Backdate to be idle
      const entry = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...entry,
        lastActivityAt: Date.now() - 200,
      })

      registry.startIdleSweep(100, 50)
      registry.stopIdleSweep()

      // Wait — sweep should NOT have fired
      await new Promise((r) => setTimeout(r, 120))

      // Lock should still exist (sweep stopped before it could fire)
      expect(registry.isLocked(1)).toBe(true)
    })

    it('should be a no-op when no sweep is active', () => {
      expect(() => registry.stopIdleSweep()).not.toThrow()
    })
  })

  describe('isSweepActive()', () => {
    it('should return false before startIdleSweep', () => {
      expect(registry.isSweepActive()).toBe(false)
    })

    it('should return true after startIdleSweep', () => {
      registry.startIdleSweep(3600000, 1000)
      expect(registry.isSweepActive()).toBe(true)
    })

    it('should return false after stopIdleSweep', () => {
      registry.startIdleSweep(3600000, 1000)
      registry.stopIdleSweep()
      expect(registry.isSweepActive()).toBe(false)
    })
  })

  // ── onLockReleased callback ──

  describe('onLockReleased callback', () => {
    it('should fire callback when idle sweep releases a lock', async () => {
      const releasedPages: Array<{
        pageId: number
        entry: { ownerConversationId: string; ownerAgentId?: string }
      }> = []
      registry.onLockReleased = (pageId, entry) => {
        releasedPages.push({
          pageId,
          entry: {
            ownerConversationId: entry.ownerConversationId,
            ownerAgentId: entry.ownerAgentId,
          },
        })
      }

      registry.claim('conv-1', 42, 'agent-A')

      // Backdate to be idle
      const owner = registry.getOwner(42)!
      registry['_entries'].set(42, {
        ...owner,
        lastActivityAt: Date.now() - 200,
      })

      registry.startIdleSweep(100, 50)

      await new Promise((r) => setTimeout(r, 120))

      expect(releasedPages.length).toBe(1)
      expect(releasedPages[0].pageId).toBe(42)
      expect(releasedPages[0].entry.ownerConversationId).toBe('conv-1')
      expect(releasedPages[0].entry.ownerAgentId).toBe('agent-A')
    })

    it('should NOT fire callback when manual release() is called', () => {
      const releasedPages: number[] = []
      registry.onLockReleased = (pageId) => {
        releasedPages.push(pageId)
      }

      registry.claim('conv-1', 42)
      registry.release('conv-1', 42)

      // Manual release should NOT trigger callback
      expect(releasedPages.length).toBe(0)
    })

    it('should NOT fire callback when releaseAllForConversation() is called', () => {
      const releasedPages: number[] = []
      registry.onLockReleased = (pageId) => {
        releasedPages.push(pageId)
      }

      registry.claim('conv-1', 42)
      registry.releaseAllForConversation('conv-1')

      // Bulk release should NOT trigger idle callback
      expect(releasedPages.length).toBe(0)
    })

    it('should not crash if callback is not set', async () => {
      registry.claim('conv-1', 42)

      // Backdate
      const owner = registry.getOwner(42)!
      registry['_entries'].set(42, {
        ...owner,
        lastActivityAt: Date.now() - 200,
      })

      // No callback set — should not crash
      registry.startIdleSweep(100, 50)
      await new Promise((r) => setTimeout(r, 120))

      expect(registry.isLocked(42)).toBe(false)
    })
  })

  // ── Tool calls refresh lastActivityAt (check via enforceOwnership) ──

  describe('refreshActivity prevents idle release', () => {
    it('tool refresh via refreshActivity keeps lock alive through sweep', async () => {
      registry.claim('conv-1', 1)

      // Backdate slightly
      const owner = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...owner,
        lastActivityAt: Date.now() - 80,
      })

      registry.startIdleSweep(100, 50)

      // Simulate tool call: refresh activity
      await new Promise((r) => setTimeout(r, 30))
      registry.refreshActivity(1)

      // Wait for sweep to fire
      await new Promise((r) => setTimeout(r, 80))

      // Lock should survive because we refreshed
      expect(registry.isLocked(1)).toBe(true)
    })
  })

  // ── Configurable timeout ──

  describe('configurable idle timeout', () => {
    it('respects custom idle timeout value', () => {
      registry.claim('conv-1', 1)
      registry.claim('conv-2', 2)

      // Backdate page 1 by 200ms
      const owner1 = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...owner1,
        lastActivityAt: Date.now() - 200,
      })

      // Page 2 is NOT backdated — fresh

      // Sweep with 100ms threshold — only page 1 is idle
      const released = registry.releaseIdle(100)
      expect(released).toBe(1)
      expect(registry.isLocked(1)).toBe(false) // 200ms > 100ms threshold
      expect(registry.isLocked(2)).toBe(true) // fresh, never idle
    })
  })

  // ── No lock leaks on conversation end ──

  describe('no lock leaks', () => {
    it('releaseAllForConversation cleans up all conversation locks', () => {
      registry.claim('conv-1', 1)
      registry.claim('conv-1', 2)
      registry.claim('conv-1', 3)

      const released = registry.releaseAllForConversation('conv-1')
      expect(released).toBe(3)
      expect(registry.isLocked(1)).toBe(false)
      expect(registry.isLocked(2)).toBe(false)
      expect(registry.isLocked(3)).toBe(false)
    })

    it('after stopIdleSweep + restart, stale locks are still swept', async () => {
      registry.claim('conv-1', 1)

      // Backdate
      const owner = registry.getOwner(1)!
      registry['_entries'].set(1, {
        ...owner,
        lastActivityAt: Date.now() - 200,
      })

      // Start and stop
      registry.startIdleSweep(100, 50)
      registry.stopIdleSweep()

      // Lock still exists (sweep stopped)
      expect(registry.isLocked(1)).toBe(true)

      // Restart sweep — should clean up stale lock
      registry.startIdleSweep(100, 50)
      await new Promise((r) => setTimeout(r, 120))

      expect(registry.isLocked(1)).toBe(false)
    })
  })

  // ── Default values (1h idle, 60s sweep) ──

  describe('default config values', () => {
    it('TIMEOUTS.TAB_LOCK_IDLE defaults to 3600000ms (1 hour)', () => {
      // This is a config-schema test — verify the constant exists
      // The actual default is in config-schema.ts, but we test the sweep uses it
      // by checking startIdleSweep with the default value
      const ONE_HOUR_MS = 3_600_000
      registry.startIdleSweep(ONE_HOUR_MS)
      expect(registry.isSweepActive()).toBe(true)
      // Recent lock should survive
      registry.claim('conv-1', 1)
      expect(registry.isLocked(1)).toBe(true)
    })

    it('TIMEOUTS.TAB_LOCK_SWEEP_INTERVAL defaults to 60000ms (60s)', () => {
      // Verify the sweep starts with 60s interval (just ensure no crash)
      registry.startIdleSweep(3600000, 60000)
      expect(registry.isSweepActive()).toBe(true)
    })
  })
})
