/**
 * I11 Audit Fixes — Verifier findings from I11 audit.
 *
 * Fix 1: close_page uses forceReleasePage() instead of release()
 *   — non-owner conversations can now close pages (stale lock cleanup)
 *
 * Fix 2: deleteSession releases all ownership locks for the conversation
 *   — prevents locks persisting up to 1 hour after conversation ends
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'

describe('I11 audit fix: forceReleasePage on close_page', () => {
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    registry = new TabOwnershipRegistry()
  })

  it('forceReleasePage removes lock regardless of owner', () => {
    // Conversation A owns page 42
    registry.claim('conv-A', 42, 'agent-X')
    expect(registry.isLocked(42)).toBe(true)

    // Non-owner (conv-B) closing the page force-releases the lock
    const released = registry.forceReleasePage(42)
    expect(released).toBe(true)
    expect(registry.isLocked(42)).toBe(false)
  })

  it('release() fails for non-owner but forceReleasePage succeeds', () => {
    registry.claim('conv-A', 42, 'agent-X')

    // Non-owner cannot release with release()
    const releaseResult = registry.release('conv-B', 42)
    expect(releaseResult).toBe(false)
    expect(registry.isLocked(42)).toBe(true)

    // But forceReleasePage works
    const forceResult = registry.forceReleasePage(42)
    expect(forceResult).toBe(true)
    expect(registry.isLocked(42)).toBe(false)
  })

  it('forceReleasePage returns false for unowned page', () => {
    expect(registry.forceReleasePage(99)).toBe(false)
  })
})

describe('I11 audit fix: deleteSession releases all ownership', () => {
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    registry = new TabOwnershipRegistry()
  })

  it('releaseAllForConversation releases all pages for a conversation', () => {
    // Conv-A owns pages 10, 20, 30
    registry.claim('conv-A', 10, 'agent-X')
    registry.claim('conv-A', 20, 'agent-X')
    registry.claim('conv-A', 30, 'agent-X')

    // Conv-B owns page 40
    registry.claim('conv-B', 40, 'agent-Y')

    // Conv-A ends — release all its locks
    const released = registry.releaseAllForConversation('conv-A')
    expect(released).toBe(3)
    expect(registry.isLocked(10)).toBe(false)
    expect(registry.isLocked(20)).toBe(false)
    expect(registry.isLocked(30)).toBe(false)

    // Conv-B's lock is unaffected
    expect(registry.isLocked(40)).toBe(true)
  })

  it('releaseAllForConversation returns 0 for unknown conversation', () => {
    registry.claim('conv-A', 10, 'agent-X')
    const released = registry.releaseAllForConversation('conv-UNKNOWN')
    expect(released).toBe(0)
    expect(registry.isLocked(10)).toBe(true)
  })

  it('releaseAllForConversation is safe to call multiple times', () => {
    registry.claim('conv-A', 10, 'agent-X')

    expect(registry.releaseAllForConversation('conv-A')).toBe(1)
    expect(registry.releaseAllForConversation('conv-A')).toBe(0)
  })
})
