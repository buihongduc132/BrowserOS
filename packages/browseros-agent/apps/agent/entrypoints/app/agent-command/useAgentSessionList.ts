import { useCallback, useMemo, useState } from 'react'
import { AgentSessionListStore } from './agent-session-list-store'
import type { AgentSession } from './agent-session-list-types'

export interface UseAgentSessionListReturn {
  sessions: AgentSession[]
  isLoading: boolean
  search: string
  setSearch: (q: string) => void
  filteredSessions: AgentSession[]
  createSession: () => string
  removeSession: (sessionId: string) => void
}

/**
 * React hook for managing the list of sessions for a given agent.
 * Wraps `AgentSessionListStore` (localStorage-backed) in React state.
 *
 * Backend CRUD endpoints are deferred — this hook manages sessions
 * purely in local state with localStorage persistence.
 */
export function useAgentSessionList(agentId: string): UseAgentSessionListReturn {
  // Store is recreated when agentId changes — no stale cross-agent state.
  const store = useMemo(() => new AgentSessionListStore(agentId), [agentId])

  const [sessions, setSessions] = useState<AgentSession[]>(() => store.getAll())
  const [search, setSearch] = useState('')

  // Re-sync sessions when the store instance changes (agentId changed).
  // This avoids reading from the old agent's localStorage.
  const [prevAgentId, setPrevAgentId] = useState(agentId)
  if (prevAgentId !== agentId) {
    setPrevAgentId(agentId)
    setSessions(store.getAll())
    setSearch('')
  }

  const filteredSessions = useMemo(
    () => store.getFiltered(search),
    [sessions, search, store],
  )

  const createSession = useCallback((): string => {
    const id = store.createSession()
    setSessions(store.getAll())
    return id
  }, [store])

  const removeSession = useCallback(
    (sessionId: string) => {
      store.removeSession(sessionId)
      setSessions(store.getAll())
    },
    [store],
  )

  return {
    sessions,
    isLoading: false, // localStorage is synchronous
    search,
    setSearch,
    filteredSessions,
    createSession,
    removeSession,
  }
}
