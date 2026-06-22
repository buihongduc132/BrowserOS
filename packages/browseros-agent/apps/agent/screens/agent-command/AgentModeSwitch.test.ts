import { afterEach, describe, expect, it } from 'bun:test'
import { getAgentCapabilities } from './useAgentCapabilities'
import {
  DEV_MODES,
  getModeSupport,
  isForceModes,
} from './useAgentSessionModes.utils'

const FORCE_KEY = 'BROWSEROS_FORCE_SESSION_MODES'
const CAP_PREFIX = 'BROWSEROS_ACP_CAP_'

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

/**
 * AgentModeSwitch rendering logic tests.
 *
 * The component self-hides when `isSupported` is false, so we verify:
 * 1. The conditions under which it renders (isSupported logic)
 * 2. The modes data it would render
 * 3. Active mode highlighting logic
 */
describe('AgentModeSwitch logic', () => {
  afterEach(() => {
    storage.clear()
    restoreLocalStorage()
  })

  describe('rendering condition: isSupported=false by default', () => {
    it('component returns null when no overrides are set', () => {
      mockLocalStorage()
      expect(isForceModes()).toBe(false)
      const caps = getAgentCapabilities('agent-1')
      expect(caps.sessionModes).toBe(false)
      expect(getModeSupport(caps.sessionModes)).toBe(false)
      // isSupported = false → component returns null
    })
  })

  describe('rendering condition: isSupported=true with FORCE_MODES', () => {
    it('component renders when FORCE_MODES is set', () => {
      mockLocalStorage()
      localStorage.setItem(FORCE_KEY, '1')
      expect(getModeSupport(false)).toBe(true)
      // isSupported = true → component renders DEV_MODES
    })

    it('component renders when sessionModes capability is enabled', () => {
      mockLocalStorage()
      localStorage.setItem(`${CAP_PREFIX}sessionModes`, '1')
      const caps = getAgentCapabilities('agent-1')
      expect(caps.sessionModes).toBe(true)
      expect(getModeSupport(caps.sessionModes)).toBe(true)
      // isSupported = true → component renders DEV_MODES
    })
  })

  describe('mode rendering logic', () => {
    it('renders all DEV_MODES when supported', () => {
      expect(DEV_MODES).toHaveLength(3)
      const modeNames = DEV_MODES.map((m) => m.name)
      expect(modeNames).toEqual(['Code', 'Ask', 'Agent'])
    })

    it('active mode is determined by currentMode matching mode.id', () => {
      const currentMode = 'agent'
      const activeMode = DEV_MODES.find((m) => m.id === currentMode)
      expect(activeMode).toBeDefined()
      expect(activeMode?.name).toBe('Agent')
    })

    it('non-active modes are inert', () => {
      const currentMode = 'ask'
      const inactiveModes = DEV_MODES.filter((m) => m.id !== currentMode)
      expect(inactiveModes).toHaveLength(2)
      expect(inactiveModes.map((m) => m.id)).toEqual(['code', 'agent'])
    })

    it('default active mode is "agent" (last in DEV_MODES)', () => {
      const defaultMode = DEV_MODES[2]
      expect(defaultMode.id).toBe('agent')
    })
  })

  describe('setMode behavior', () => {
    it('mode can be switched to any valid id', () => {
      const validIds = DEV_MODES.map((m) => m.id)
      expect(validIds).toContain('code')
      expect(validIds).toContain('ask')
      expect(validIds).toContain('agent')
    })
  })
})
