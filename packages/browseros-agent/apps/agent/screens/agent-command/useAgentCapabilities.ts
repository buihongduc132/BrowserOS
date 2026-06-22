/**
 * Centralized capability gate for ACP frontend features.
 *
 * All capabilities default to `false`. Each one flips to `true` when
 * backend support lands. This gives us a single source of truth for
 * feature gating across all ACP session components.
 *
 * Dev override: set `BROWSEROS_ACP_CAP_<CAP_NAME>=1` in localStorage
 * to force-enable a capability for testing.
 */

export interface AgentCapabilities {
  sessionModes: boolean
  sessionSearch: boolean
  sessionTitle: boolean
  sessionRetry: boolean
  sessionTruncate: boolean
  sessionModelSelector: boolean
}

const CAPABILITY_KEYS: (keyof AgentCapabilities)[] = [
  'sessionModes',
  'sessionSearch',
  'sessionTitle',
  'sessionRetry',
  'sessionTruncate',
  'sessionModelSelector',
]

const STORAGE_PREFIX = 'BROWSEROS_ACP_CAP_'

/**
 * Read a single capability flag from localStorage.
 * Returns `true` only when the stored value is exactly `"1"`.
 */
export function readCapabilityOverride(key: string): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`) === '1'
  } catch {
    return false
  }
}

/**
 * Build the capabilities map for a given agent.
 *
 * Pure function — no React dependency. The React hook
 * `useAgentCapabilities` wraps this.
 */
export function getAgentCapabilities(_agentId: string): AgentCapabilities {
  const caps: AgentCapabilities = {
    sessionModes: false,
    sessionSearch: false,
    sessionTitle: false,
    sessionRetry: false,
    sessionTruncate: false,
    sessionModelSelector: false,
  }

  // Apply localStorage overrides
  for (const key of CAPABILITY_KEYS) {
    if (readCapabilityOverride(key)) {
      caps[key] = true
    }
  }

  return caps
}

/**
 * React hook that returns the current capability set for an agent.
 *
 * Re-reads from localStorage on every render so dev overrides
 * take effect immediately without a reload.
 */
export function useAgentCapabilities(agentId: string): AgentCapabilities {
  return getAgentCapabilities(agentId)
}
