import { useCallback, useMemo, useRef, useState } from 'react'
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
  // Ref holds the store instance; state triggers re-renders.
  const storeRef = useRef<AgentSessionListStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new AgentSessionListStore(agentId)
  }
  const store = storeRef.current

  // Replace store if agentId changes (rare — user switching agents)
  if (storeRef.current && store['agentId'] !== agentId) {
    storeRef.current = new AgentSessionListStore(agentId)
  }

  const [sessions, setSessions] = useState<AgentSession[]>(() => store.getAll())
  const [search, setSearch] = useState('')

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
