/**
 * T13: Strict mode configuration toggle.
 *
 * Tests that the tab_ownership_strict config key correctly controls
 * ownership enforcement behavior:
 *   - Default: non-strict (warn but allow)
 *   - Strict: reject with clear error showing lock owner
 *   - Configurable via ToolContext.strictOwnership
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
import { enforceOwnership } from '../../src/tools/ownership-enforcement'
import type { ToolContext } from '../../src/tools/framework'
import type { Browser } from '../../src/browser/browser'

/**
 * Create a minimal ToolContext with ownership support.
 */
function makeCtx(opts: {
  conversationId?: string
  strictOwnership?: boolean
}): ToolContext {
  const registry = new TabOwnershipRegistry()
  return {
    browser: { tabOwnership: registry } as unknown as Browser,
    directories: {},
    session: opts.conversationId
      ? { conversationId: opts.conversationId }
      : undefined,
    strictOwnership: opts.strictOwnership,
  }
}

describe('strict mode config toggle', () => {
  // ── Default: non-strict ──

  describe('default (non-strict)', () => {
    it('should warn but allow when page is owned by another conversation', () => {
      const ctx = makeCtx({ conversationId: 'conv-2' })
      // Conv-1 claims the page
      ctx.browser.tabOwnership.claim('conv-1', 42, 'agent-A')

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      expect(result.warning).toContain('conv-1')
      expect(result.error).toBeUndefined()
    })

    it('should NOT have strictOwnership set by default', () => {
      const ctx = makeCtx({ conversationId: 'conv-1' })
      expect(ctx.strictOwnership).toBeUndefined()
    })

    it('should allow tool calls when no conversation context', () => {
      const ctx = makeCtx({}) // no conversation
      ctx.browser.tabOwnership.claim('conv-1', 42)

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeUndefined()
    })
  })

  // ── Strict mode ──

  describe('strict mode (strictOwnership=true)', () => {
    it('should reject when page is owned by another conversation', () => {
      const ctx = makeCtx({
        conversationId: 'conv-2',
        strictOwnership: true,
      })
      ctx.browser.tabOwnership.claim('conv-1', 42, 'agent-A')

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('conv-1')
      expect(result.error).toContain('42')
    })

    it('should allow when page is owned by the same conversation', () => {
      const ctx = makeCtx({
        conversationId: 'conv-1',
        strictOwnership: true,
      })
      ctx.browser.tabOwnership.claim('conv-1', 42, 'agent-A')

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      expect(result.warning).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    it('should auto-claim and allow when page is unowned', () => {
      const ctx = makeCtx({
        conversationId: 'conv-1',
        strictOwnership: true,
      })

      const result = enforceOwnership(ctx, 42)
      expect(result.allowed).toBe(true)
      expect(ctx.browser.tabOwnership.isLocked(42)).toBe(true)
    })

    it('error message shows conversationId of lock owner', () => {
      const ctx = makeCtx({
        conversationId: 'conv-2',
        strictOwnership: true,
      })
      ctx.browser.tabOwnership.claim('conv-1', 99, 'agent-X')

      const result = enforceOwnership(ctx, 99)
      expect(result.error).toContain('conv-1')
      expect(result.error).toContain('list_pages')
    })
  })

  // ── Warning includes lock owner info ──

  describe('warning message', () => {
    it('includes conversationId of lock owner in non-strict warning', () => {
      const ctx = makeCtx({ conversationId: 'conv-2' })
      ctx.browser.tabOwnership.claim('conv-1', 42, 'agent-A')

      const result = enforceOwnership(ctx, 42)
      expect(result.warning).toContain('conv-1')
      expect(result.warning).toContain('42')
      expect(result.warning).toContain('non-strict')
    })
  })

  // ── Configurable per-context ──

  describe('per-context configuration', () => {
    it('different contexts can have different strict settings', () => {
      // Page owned by conv-1
      const registry = new TabOwnershipRegistry()
      registry.claim('conv-1', 42, 'agent-A')

      // Non-strict context
      const ctxNonStrict: ToolContext = {
        browser: { tabOwnership: registry } as unknown as Browser,
        directories: {},
        session: { conversationId: 'conv-2' },
        strictOwnership: false,
      }
      const resultNonStrict = enforceOwnership(ctxNonStrict, 42)
      expect(resultNonStrict.allowed).toBe(true)
      expect(resultNonStrict.warning).toBeDefined()

      // Strict context
      const ctxStrict: ToolContext = {
        browser: { tabOwnership: registry } as unknown as Browser,
        directories: {},
        session: { conversationId: 'conv-3' },
        strictOwnership: true,
      }
      const resultStrict = enforceOwnership(ctxStrict, 42)
      expect(resultStrict.allowed).toBe(false)
      expect(resultStrict.error).toBeDefined()
    })
  })
})
