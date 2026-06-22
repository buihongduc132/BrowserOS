import { afterEach, describe, expect, it } from 'bun:test'
import {
  getAgentCapabilities,
  readCapabilityOverride,
} from './useAgentCapabilities'

const TEST_PREFIX = 'BROWSEROS_ACP_CAP_'

// In-memory localStorage mock
const storage = new Map<string, string>()
const originalLocalStorage = globalThis.localStorage

function mockLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() {
        return storage.size
      },
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

describe('useAgentCapabilities', () => {
  afterEach(() => {
    storage.clear()
    restoreLocalStorage()
  })

  describe('getAgentCapabilities', () => {
    it('returns all capabilities false by default', () => {
      mockLocalStorage()
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionModes).toBe(false)
      expect(caps.sessionSearch).toBe(false)
      expect(caps.sessionTitle).toBe(false)
      expect(caps.sessionRetry).toBe(false)
      expect(caps.sessionTruncate).toBe(false)
      expect(caps.sessionModelSelector).toBe(false)
    })

    it('returns all false for any agent ID when no overrides set', () => {
      mockLocalStorage()
      const caps1 = getAgentCapabilities('agent-aaa')
      const caps2 = getAgentCapabilities('agent-bbb')
      expect(Object.values(caps1).every((v) => v === false)).toBe(true)
      expect(Object.values(caps2).every((v) => v === false)).toBe(true)
    })

    it('respects localStorage override for sessionModes', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionModes`, '1')
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionModes).toBe(true)
      expect(caps.sessionSearch).toBe(false)
    })

    it('respects localStorage override for multiple capabilities', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionSearch`, '1')
      localStorage.setItem(`${TEST_PREFIX}sessionTitle`, '1')
      localStorage.setItem(`${TEST_PREFIX}sessionRetry`, '1')
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionSearch).toBe(true)
      expect(caps.sessionTitle).toBe(true)
      expect(caps.sessionRetry).toBe(true)
      expect(caps.sessionModes).toBe(false)
      expect(caps.sessionTruncate).toBe(false)
      expect(caps.sessionModelSelector).toBe(false)
    })

    it('ignores non-"1" values in localStorage', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionModes`, 'yes')
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionModes).toBe(false)
    })

    it('respects override for sessionTruncate', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionTruncate`, '1')
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionTruncate).toBe(true)
    })

    it('respects override for sessionModelSelector', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionModelSelector`, '1')
      const caps = getAgentCapabilities('agent-123')
      expect(caps.sessionModelSelector).toBe(true)
    })
  })

  describe('readCapabilityOverride', () => {
    it('returns false when no override is set', () => {
      mockLocalStorage()
      expect(readCapabilityOverride('sessionModes')).toBe(false)
    })

    it('returns true when override is "1"', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionModes`, '1')
      expect(readCapabilityOverride('sessionModes')).toBe(true)
    })

    it('returns false when override is "0"', () => {
      mockLocalStorage()
      localStorage.setItem(`${TEST_PREFIX}sessionModes`, '0')
      expect(readCapabilityOverride('sessionModes')).toBe(false)
    })
  })
})
