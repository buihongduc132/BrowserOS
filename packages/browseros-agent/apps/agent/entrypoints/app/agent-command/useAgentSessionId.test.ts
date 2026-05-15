import { describe, expect, it } from 'bun:test'
import {
  buildSessionIdHeader,
  DEFAULT_SESSION_ID,
  resolveSessionId,
} from './useAgentSessionId'

describe('useAgentSessionId utilities', () => {
  describe('resolveSessionId', () => {
    it('returns default when input is undefined', () => {
      expect(resolveSessionId(undefined)).toBe(DEFAULT_SESSION_ID)
    })

    it('returns default when input is empty string', () => {
      expect(resolveSessionId('')).toBe(DEFAULT_SESSION_ID)
    })

    it('returns the provided sessionId when non-empty', () => {
      expect(resolveSessionId('sess_abc123')).toBe('sess_abc123')
    })

    it('returns the provided sessionId when it is "main"', () => {
      expect(resolveSessionId('main')).toBe('main')
    })
  })

  describe('buildSessionIdHeader', () => {
    it('returns header with default when no sessionId', () => {
      expect(buildSessionIdHeader()).toEqual({ 'X-Session-Id': 'main' })
    })

    it('returns header with explicit sessionId', () => {
      expect(buildSessionIdHeader('sess_xyz')).toEqual({
        'X-Session-Id': 'sess_xyz',
      })
    })

    it('returns header with "main" when empty string', () => {
      expect(buildSessionIdHeader('')).toEqual({ 'X-Session-Id': 'main' })
    })
  })
})
