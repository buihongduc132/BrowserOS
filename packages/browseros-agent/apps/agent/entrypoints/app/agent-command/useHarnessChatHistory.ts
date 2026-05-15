import { useQuery } from '@tanstack/react-query'
import { fetchHarnessAgentHistory } from '@/entrypoints/app/agents/useAgents'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import type { AgentHistoryPageResponse } from './agent-chat-types'
import { mapHarnessHistoryPage } from './harness-history-mapper'

const HISTORY_QUERY_KEY = 'harness-agent-history'

export function useHarnessChatHistory(agentId: string, enabled = true, sessionId?: string) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const effectiveSessionId = sessionId || 'main'

  const query = useQuery<AgentHistoryPageResponse, Error>({
    queryKey: [HISTORY_QUERY_KEY, baseUrl, agentId, effectiveSessionId],
    queryFn: async () => {
      return mapHarnessHistoryPage(await fetchHarnessAgentHistory(agentId, effectiveSessionId))
    },
    enabled: Boolean(baseUrl) && !urlLoading && enabled && Boolean(agentId),
  })

  return {
    ...query,
    error: query.error ?? urlError,
    isLoading: query.isLoading || urlLoading,
  }
}
