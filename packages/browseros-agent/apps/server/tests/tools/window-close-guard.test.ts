/**
 * T14: Neutralize window.close() in evaluate_script.
 *
 * Defense-in-depth: even if an LLM runs `window.close()` via evaluate_script,
 * the browser should not self-close. The expression is wrapped with a
 * window.close override that blocks execution and logs a warning.
 *
 * Checks:
 *   - window.close() overridden during script execution
 *   - Override logs warning instead of closing
 *   - Original window.close restored after execution
 *   - Does not break legitimate script evaluation
 */

import { describe, it, expect } from 'bun:test'
import {
  wrapWithWindowCloseGuard,
  WINDOW_CLOSE_GUARD_PREAMBLE,
} from '../../src/tools/window-close-guard'

describe('window.close() guard', () => {
  // ── wrapWithWindowCloseGuard ──

  describe('wrapWithWindowCloseGuard()', () => {
    it('should wrap expression with guard preamble', () => {
      const expr = 'document.title'
      const wrapped = wrapWithWindowCloseGuard(expr)
      expect(wrapped).toContain(WINDOW_CLOSE_GUARD_PREAMBLE)
      expect(wrapped).toContain('document.title')
    })

    it('should preserve the original expression', () => {
      const expr = '1 + 2'
      const wrapped = wrapWithWindowCloseGuard(expr)
      expect(wrapped).toContain('1 + 2')
    })

    it('should restore window.close after execution', () => {
      const wrapped = wrapWithWindowCloseGuard('42')
      expect(wrapped).toContain('finally')
      expect(wrapped).toContain('_origClose')
    })
  })

  // ── Guard preamble content ──

  describe('WINDOW_CLOSE_GUARD_PREAMBLE', () => {
    it('should save the original window.close', () => {
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('_origClose')
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('window.close')
    })

    it('should override window.close with a no-op', () => {
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('Object.defineProperty')
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('configurable')
    })

    it('should log a warning when window.close is called', () => {
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('console.warn')
      expect(WINDOW_CLOSE_GUARD_PREAMBLE).toContain('BrowserOS')
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('should handle empty expression', () => {
      const wrapped = wrapWithWindowCloseGuard('')
      expect(wrapped).toContain(WINDOW_CLOSE_GUARD_PREAMBLE)
    })

    it('should handle multi-line expression', () => {
      const expr = 'const x = 1;\nconst y = 2;\nx + y'
      const wrapped = wrapWithWindowCloseGuard(expr)
      expect(wrapped).toContain('const x = 1;')
      expect(wrapped).toContain('x + y')
    })

    it('should handle expression with try/catch', () => {
      const expr = 'try { JSON.parse("{}") } catch(e) { null }'
      const wrapped = wrapWithWindowCloseGuard(expr)
      expect(wrapped).toContain('JSON.parse')
    })

    it('should handle expression referencing window.close indirectly', () => {
      const expr = 'const f = window.close; f()'
      const wrapped = wrapWithWindowCloseGuard(expr)
      // The guard overrides window.close before the expression runs,
      // so f will point to the overridden no-op version
      expect(wrapped).toContain('window.close')
    })
  })
})
