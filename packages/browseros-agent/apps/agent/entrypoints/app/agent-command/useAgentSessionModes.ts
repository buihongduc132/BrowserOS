import { useCallback, useRef, useState } from 'react'
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
 * - Mode state is keyed by sessionId — switching sessions resets the mode.
 */
export function useAgentSessionModes(
  agentId: string,
  sessionId: string,
): UseAgentSessionModesReturn {
  const caps = useAgentCapabilities(agentId)
  const isSupported = getModeSupport(caps.sessionModes)

  const modes = isSupported ? DEV_MODES : []

  // Per-session mode storage — keyed by sessionId so switching sessions
  // resets the mode to default.
  const modeMapRef = useRef<Map<string, string>>(new Map())
  const [localMode, setLocalMode] = useState<string | null>(null)

  // When sessionId changes, reset localMode from the map (or null)
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    const stored = modeMapRef.current.get(sessionId) ?? null
    setLocalMode(stored)
  }

  const currentMode = isSupported
    ? localMode ?? DEV_MODES[2]?.id ?? null // default to 'agent'
    : null

  const setMode = useCallback(
    (modeId: string) => {
      if (!isSupported) return
      modeMapRef.current.set(sessionId, modeId)
      setLocalMode(modeId)
    },
    [isSupported, sessionId],
  )

  // agentId is part of the interface for future per-agent mode tracking
  void agentId

  return {
    modes,
    currentMode,
    setMode,
    isSupported,
  }
}
