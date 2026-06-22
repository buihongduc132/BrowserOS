/**
 * Pure (non-React) utilities for session mode support.
 *
 * Separated from the hook so the logic can be tested without
 * a React runtime.
 */

export interface SessionMode {
  id: string
  name: string
  description?: string
}

export const FORCE_MODES_KEY = 'BROWSEROS_FORCE_SESSION_MODES'

/** Default mode set used when FORCE_MODES is enabled. */
export const DEV_MODES: SessionMode[] = [
  { id: 'code', name: 'Code' },
  { id: 'ask', name: 'Ask' },
  { id: 'agent', name: 'Agent' },
]

/**
 * Check if dev mode override is active.
 */
export function isForceModes(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(FORCE_MODES_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Determine if session modes are supported.
 * Takes the sessionModes capability flag (from useAgentCapabilities)
 * and combines it with the FORCE_MODES dev override.
 */
export function getModeSupport(capabilityFlag: boolean): boolean {
  return capabilityFlag || isForceModes()
}
