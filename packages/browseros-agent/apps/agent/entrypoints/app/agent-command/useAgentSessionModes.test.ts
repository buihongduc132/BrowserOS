import { describe, expect, it, afterEach } from 'bun:test'
import {
  DEV_MODES,
  FORCE_MODES_KEY,
  getModeSupport,
  isForceModes,
} from './useAgentSessionModes.utils'
import { getAgentCapabilities } from './useAgentCapabilities'

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

const CAP_PREFIX = 'BROWSEROS_ACP_CAP_'

describe('useAgentSessionModes utilities', () => {
  afterEach(() => {
    storage.clear()
    restoreLocalStorage()
  })

  // Set up mock before each test within describe blocks
  function setup() {
    storage.clear()
    mockLocalStorage()
  }

  describe('isForceModes', () => {
    it('returns false by default', () => {
      setup()
      expect(isForceModes()).toBe(false)
    })

    it('returns true when BROWSEROS_FORCE_SESSION_MODES=1', () => {
      setup()
      localStorage.setItem(FORCE_MODES_KEY, '1')
      expect(isForceModes()).toBe(true)
    })

    it('returns false when set to "0"', () => {
      setup()
      localStorage.setItem(FORCE_MODES_KEY, '0')
      expect(isForceModes()).toBe(false)
    })
  })

  describe('getModeSupport', () => {
    it('returns false when capability is false and no force flag', () => {
      setup()
      expect(getModeSupport(false)).toBe(false)
    })

    it('returns true when capability flag is true', () => {
      setup()
      expect(getModeSupport(true)).toBe(true)
    })

    it('returns true when force flag is set even if capability is false', () => {
      setup()
      localStorage.setItem(FORCE_MODES_KEY, '1')
      expect(getModeSupport(false)).toBe(true)
    })
  })

  describe('DEV_MODES', () => {
    it('contains code, ask, agent modes', () => {
      expect(DEV_MODES).toHaveLength(3)
      expect(DEV_MODES.map((m) => m.id)).toEqual(['code', 'ask', 'agent'])
    })

    it('each mode has a name', () => {
      for (const mode of DEV_MODES) {
        expect(mode.name.length).toBeGreaterThan(0)
      }
    })
  })

  describe('integration with capabilities', () => {
    it('isSupported=false when no flags set', () => {
      setup()
      const caps = getAgentCapabilities('agent-1')
      expect(getModeSupport(caps.sessionModes)).toBe(false)
    })

    it('isSupported=true when FORCE_MODES is set', () => {
      setup()
      localStorage.setItem(FORCE_MODES_KEY, '1')
      const caps = getAgentCapabilities('agent-1')
      expect(getModeSupport(caps.sessionModes)).toBe(true)
    })

    it('isSupported=true when sessionModes capability is enabled', () => {
      setup()
      localStorage.setItem(`${CAP_PREFIX}sessionModes`, '1')
      const caps = getAgentCapabilities('agent-1')
      expect(caps.sessionModes).toBe(true)
      expect(getModeSupport(caps.sessionModes)).toBe(true)
    })

    it('modes list is empty when unsupported', () => {
      const isSupported = false
      const modes = isSupported ? DEV_MODES : []
      expect(modes).toHaveLength(0)
    })

    it('modes list equals DEV_MODES when supported', () => {
      const isSupported = true
      const modes = isSupported ? DEV_MODES : []
      expect(modes).toBe(DEV_MODES)
    })
  })
})
