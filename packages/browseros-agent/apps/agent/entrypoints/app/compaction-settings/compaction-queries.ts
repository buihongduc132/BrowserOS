import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'

export interface VccConfig {
  maxTranscriptLines?: number
  maxGoalLines?: number
  maxFileEntries?: number
  maxCommitEntries?: number
  maxPreferenceLines?: number
  maxOutstandingLines?: number
}

export interface CompactionConfig {
  method: 'default' | 'vcc'
  customPrompt?: string
  vccConfig?: VccConfig
}

export interface CompactionConfigResponse {
  active: CompactionConfig | null
  defaults: { method: 'default' }
}

export interface CompactionSaveResponse {
  ok: boolean
  saved?: CompactionConfig
  errors?: Array<{ key: string; message: string }>
}

const COMPACTION_QUERY_KEY = ['compaction-config'] as const

async function fetchCompactionConfig(
  baseUrl: string,
): Promise<CompactionConfigResponse> {
  const res = await fetch(`${baseUrl}/compaction`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function putCompactionConfig(
  baseUrl: string,
  config: CompactionConfig,
): Promise<CompactionSaveResponse> {
  const res = await fetch(`${baseUrl}/compaction`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    // Try to parse error body, fall back to HTTP status
    try {
      return await res.json()
    } catch {
      throw new Error(`HTTP ${res.status}`)
    }
  }
  return res.json()
}

async function deleteCompactionConfig(
  baseUrl: string,
): Promise<CompactionSaveResponse> {
  const res = await fetch(`${baseUrl}/compaction`, { method: 'DELETE' })
  if (!res.ok) {
    try {
      return await res.json()
    } catch {
      throw new Error(`HTTP ${res.status}`)
    }
  }
  return res.json()
}

export function useCompactionConfig() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const query = useQuery<CompactionConfigResponse, Error>({
    queryKey: [...COMPACTION_QUERY_KEY, baseUrl],
    queryFn: () => fetchCompactionConfig(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: COMPACTION_QUERY_KEY })

  const saveMutation = useMutation({
    mutationFn: (config: CompactionConfig) =>
      putCompactionConfig(baseUrl as string, config),
    onSuccess: invalidate,
  })

  const resetMutation = useMutation({
    mutationFn: () => deleteCompactionConfig(baseUrl as string),
    onSuccess: invalidate,
  })

  return {
    config: query.data ?? null,
    isLoading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
    saveConfig: saveMutation.mutateAsync,
    resetConfig: resetMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    isResetting: resetMutation.isPending,
  }
}

// ---------------------------------------------------------------------------
// On-demand compaction trigger
// ---------------------------------------------------------------------------

export interface CompactConversationResult {
  ok: boolean
  compactedMessageCount?: number
  originalMessageCount?: number
  error?: string
}

async function triggerCompact(
  baseUrl: string,
  conversationId: string,
): Promise<CompactConversationResult> {
  const res = await fetch(`${baseUrl}/compaction/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), {
      status: res.status,
      data,
    })
  }
  return data
}

export function useCompactConversation() {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const mutation = useMutation<
    CompactConversationResult,
    Error & { status?: number; data?: unknown },
    { conversationId: string }
  >({
    mutationFn: ({ conversationId }) =>
      triggerCompact(baseUrl as string, conversationId),
  })

  return {
    compact: mutation.mutateAsync,
    compactAsync: mutation.mutateAsync,
    isCompacting: mutation.isPending,
    data: mutation.data,
    error: mutation.error ?? urlError,
    isLoading: urlLoading,
    reset: mutation.reset,
  }
}

// ---------------------------------------------------------------------------
// Compaction status polling
// ---------------------------------------------------------------------------

export interface CompactionStatus {
  compacting: boolean
}

async function fetchCompactionStatus(
  baseUrl: string,
  conversationId: string,
): Promise<CompactionStatus> {
  const res = await fetch(
    `${baseUrl}/compaction/compact/status?conversationId=${encodeURIComponent(conversationId)}`,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function useCompactionStatus(conversationId: string | undefined) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<CompactionStatus, Error>({
    queryKey: ['compaction-status', baseUrl, conversationId],
    queryFn: () =>
      fetchCompactionStatus(baseUrl as string, conversationId as string),
    enabled: !!baseUrl && !!conversationId && !urlLoading,
    refetchInterval: (query) =>
      query.state.data?.compacting ? 1000 : false,
  })

  return {
    compacting: query.data?.compacting ?? false,
    isLoading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
  }
}
