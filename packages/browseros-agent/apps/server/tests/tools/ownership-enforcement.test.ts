/**
 * Tab ownership enforcement in tool handlers (T07).
 *
 * When a tool targets a page:
 *   - If unowned: auto-claim for the calling conversation
 *   - If owned by same conversation: refresh activity, proceed
 *   - If owned by another conversation:
 *     - Strict mode: reject with error showing owner info
 *     - Non-strict mode (default): warn but proceed
 *
 * These tests use a real TabOwnershipRegistry with a mock Browser.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import type { Browser } from '../../src/browser/browser'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
import { enforceOwnership } from '../../src/tools/ownership-enforcement'
import type { ToolContext } from '../../src/tools/framework'

// ── Helpers ──

function createMockBrowser(): {
  browser: Browser
  registry: TabOwnershipRegistry
} {
  const registry = new TabOwnershipRegistry()
  const browser = {
    tabOwnership: registry,
    listPages: async () => [],
    closePage: async () => {},
  } as unknown as Browser

  return { browser, registry }
}

function makeCtx(
  browser: Browser,
  opts?: {
    conversationId?: string
    origin?: 'sidepanel' | 'newtab'
    strict?: boolean
  },
): ToolContext {
  return {
    browser,
    directories: { workingDir: process.cwd() },
    session: {
      origin: opts?.origin ?? 'sidepanel',
      conversationId: opts?.conversationId ?? 'conv-1',
    },
    strictOwnership: opts?.strict ?? false,
  } as ToolContext
}

// ── Tests ──

describe('enforceOwnership', () => {
  let mockBrowser: Browser
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    const result = createMockBrowser()
    mockBrowser = result.browser
    registry = result.registry
  })

  // ── Auto-claim ──

  describe('auto-claim', () => {
    it('should auto-claim an unowned page for the calling conversation', () => {
      const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      const result = enforceOwnership(ctx, 42)

      expect(result.allowed).toBe(true)
      expect(result.warning).toBeUndefined()
      expect(registry.isLocked(42)).toBe(true)
      expect(registry.getOwner(42)?.ownerConversationId).toBe('conv-1')
    })

    it('should refresh activity for a page already owned by the calling conversation', async () => {
      const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      enforceOwnership(ctx, 42)
      const original = registry.getOwner(42)!.lastActivityAt

      await new Promise((r) => setTimeout(r, 5))

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      expect(registry.getOwner(42)!.lastActivityAt).toBeGreaterThan(original)
    })

    it('should auto-claim different pages for the same conversation', () => {
      const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      expect(enforceOwnership(ctx, 1).allowed).toBe(true)
      expect(enforceOwnership(ctx, 2).allowed).toBe(true)
      expect(enforceOwnership(ctx, 3).allowed).toBe(true)
      expect(registry.isLocked(1)).toBe(true)
      expect(registry.isLocked(2)).toBe(true)
      expect(registry.isLocked(3)).toBe(true)
    })
  })

  // ── Conflict detection ──

  describe('conflict: page owned by another conversation', () => {
    it('should warn but allow in non-strict mode', () => {
      // Conv-1 claims page 42
      const ctx1 = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      enforceOwnership(ctx1, 42)

      // Conv-2 tries to use page 42 (non-strict)
      const ctx2 = makeCtx(mockBrowser, {
        conversationId: 'conv-2',
        strict: false,
      })
      const result = enforceOwnership(ctx2, 42)

      expect(result.allowed).toBe(true)
      expect(result.warning).toContain('conv-1')
      expect(result.warning).toContain('already controlled')
    })

    it('should reject in strict mode', () => {
      // Conv-1 claims page 42
      const ctx1 = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      enforceOwnership(ctx1, 42)

      // Conv-2 tries to use page 42 (strict mode)
      const ctx2 = makeCtx(mockBrowser, {
        conversationId: 'conv-2',
        strict: true,
      })
      const result = enforceOwnership(ctx2, 42)

      expect(result.allowed).toBe(false)
      expect(result.error).toContain('conv-1')
      expect(result.error).toContain('locked')
    })

    it('should include owner info in strict mode rejection', () => {
      const ctx1 = makeCtx(mockBrowser, { conversationId: 'conv-1' })
      enforceOwnership(ctx1, 42)

      const ctx2 = makeCtx(mockBrowser, {
        conversationId: 'conv-2',
        strict: true,
      })
      const result = enforceOwnership(ctx2, 42)

      expect(result.error).toContain('conv-1')
    })
  })

  // ── No session ──

  describe('no session context', () => {
    it('should allow without ownership when no session (MCP without session)', () => {
      const ctx = {
        browser: mockBrowser,
        directories: { workingDir: process.cwd() },
      } as ToolContext

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      // No claim made because no conversationId
      expect(registry.isLocked(42)).toBe(false)
    })
  })

  // ── Single conversation (no regression) ──

  describe('single conversation (no regression)', () => {
    it('should auto-claim and proceed normally', () => {
      const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })

      // Multiple tools on different pages — all should work fine
      expect(enforceOwnership(ctx, 1).allowed).toBe(true)
      expect(enforceOwnership(ctx, 2).allowed).toBe(true)
      expect(enforceOwnership(ctx, 1).allowed).toBe(true) // re-use

      expect(registry.isLocked(1)).toBe(true)
      expect(registry.isLocked(2)).toBe(true)
    })
  })
})
