import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'

// ---------------------------------------------------------------------------
// Types — mirrors backend ActiveSession shape
// ---------------------------------------------------------------------------

export interface ActiveSession {
  agentId: string
  sessionId: string
  cwd?: string
  title?: string
  turnCount: number
  lastMessagePreview?: string
  lastMessageAt?: number
  mode?: string
  model?: string
  meta?: Record<string, unknown>
  createdAt: number
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const SESSION_KEYS = {
  all: (agentId: string) => ['agent-sessions', agentId] as const,
  list: (agentId: string) => [...SESSION_KEYS.all(agentId), 'list'] as const,
  detail: (agentId: string, sessionId: string) =>
    [...SESSION_KEYS.all(agentId), sessionId] as const,
}

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

async function fetchSessions(
  baseUrl: string,
  agentId: string,
  opts?: { search?: string; limit?: number },
): Promise<ActiveSession[]> {
  const params = new URLSearchParams()
  if (opts?.search) params.set('search', opts.search)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}/sessions${qs ? `?${qs}` : ''}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.sessions ?? []) as ActiveSession[]
}

async function fetchSession(
  baseUrl: string,
  agentId: string,
  sessionId: string,
): Promise<ActiveSession> {
  const res = await fetch(
    `${baseUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.session as ActiveSession
}

async function createSession(
  baseUrl: string,
  agentId: string,
  body?: { cwd?: string },
): Promise<ActiveSession> {
  const res = await fetch(
    `${baseUrl}/agents/${encodeURIComponent(agentId)}/sessions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.session as ActiveSession
}

async function updateSession(
  baseUrl: string,
  agentId: string,
  sessionId: string,
  updates: Partial<
    Pick<
      ActiveSession,
      | 'title'
      | 'turnCount'
      | 'lastMessagePreview'
      | 'lastMessageAt'
      | 'mode'
      | 'model'
      | 'meta'
    >
  >,
): Promise<ActiveSession> {
  const res = await fetch(
    `${baseUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.session as ActiveSession
}

async function deleteSession(
  baseUrl: string,
  agentId: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * List all sessions for a given agent.
 */
export function useAgentSessions(
  agentId: string | undefined,
  opts?: { search?: string; limit?: number },
) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<ActiveSession[], Error>({
    queryKey: [...SESSION_KEYS.list(agentId ?? ''), opts],
    queryFn: () => fetchSessions(baseUrl as string, agentId!, opts),
    enabled: !!baseUrl && !!agentId && !urlLoading,
  })

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

/**
 * Get a single session by ID.
 */
export function useAgentSession(
  agentId: string | undefined,
  sessionId: string | undefined,
) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<ActiveSession, Error>({
    queryKey: SESSION_KEYS.detail(agentId ?? '', sessionId ?? ''),
    queryFn: () =>
      fetchSession(baseUrl as string, agentId!, sessionId!),
    enabled: !!baseUrl && !!agentId && !!sessionId && !urlLoading,
  })

  return {
    session: query.data ?? null,
    isLoading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

/**
 * Create a new session for an agent.
 */
export function useCreateAgentSession(agentId: string | undefined) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (body?: { cwd?: string }) =>
      createSession(baseUrl as string, agentId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: SESSION_KEYS.all(agentId ?? ''),
      })
    },
  })

  return {
    createSession: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error ?? urlError,
    isLoading: urlLoading,
  }
}

/**
 * Update session metadata.
 */
export function useUpdateAgentSession(
  agentId: string | undefined,
  sessionId: string | undefined,
) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (
      updates: Parameters<typeof updateSession>[3],
    ) => updateSession(baseUrl as string, agentId!, sessionId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: SESSION_KEYS.all(agentId ?? ''),
      })
    },
  })

  return {
    updateSession: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error ?? urlError,
    isLoading: urlLoading,
  }
}

/**
 * Delete a session.
 */
export function useDeleteAgentSession(
  agentId: string | undefined,
) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (targetSessionId: string) =>
      deleteSession(baseUrl as string, agentId!, targetSessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: SESSION_KEYS.all(agentId ?? ''),
      })
    },
  })

  return {
    deleteSession: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    error: mutation.error ?? urlError,
    isLoading: urlLoading,
  }
}
