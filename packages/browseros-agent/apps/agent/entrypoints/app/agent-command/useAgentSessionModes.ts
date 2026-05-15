import { useCallback, useState } from 'react'
import {
  type SessionMode,
  getModeSupport,
  DEV_MODES,
  FORCE_MODES_KEY,
} from './useAgentSessionModes.utils'
import { useAgentCapabilities } from './useAgentCapabilities'

export type { SessionMode } from './useAgentSessionModes.utils'
export { DEV_MODES, FORCE_MODES_KEY } from './useAgentSessionModes.utils'

export interface UseAgentSessionModesReturn {
  modes: SessionMode[]
  currentMode: string | null
  setMode: (modeId: string) => void
  isSupported: boolean
}

/**
 * Hook for agent session mode management.
 *
 * - Returns `isSupported: false` by default (backend support deferred).
 * - When `FORCE_MODES` is enabled via localStorage, returns dev mode set.
 * - When backend support lands, this hook will read modes from the adapter.
 * - `setMode` stores the mode locally for future use.
 */
export function useAgentSessionModes(
  agentId: string,
  sessionId: string,
): UseAgentSessionModesReturn {
  const caps = useAgentCapabilities(agentId)
  const isSupported = getModeSupport(caps.sessionModes)

  const modes = isSupported ? DEV_MODES : []
  const [localMode, setLocalMode] = useState<string | null>(null)

  const currentMode = isSupported
    ? localMode ?? DEV_MODES[2]?.id ?? null // default to 'agent'
    : null

  const setMode = useCallback(
    (modeId: string) => {
      if (!isSupported) return
      setLocalMode(modeId)
    },
    [isSupported],
  )

  // sessionId is part of the interface for future per-session mode tracking
  void sessionId

  return {
    modes,
    currentMode,
    setMode,
    isSupported,
  }
}
