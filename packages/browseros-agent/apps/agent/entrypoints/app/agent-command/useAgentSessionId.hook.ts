import { useParams } from 'react-router'
import {
  DEFAULT_SESSION_ID,
  resolveSessionId,
} from './useAgentSessionId'

export { DEFAULT_SESSION_ID, resolveSessionId, buildSessionIdHeader } from './useAgentSessionId'

/**
 * React hook: reads sessionId from the URL route params.
 * Returns 'main' when no sessionId is in the URL (backward compat).
 *
 * Route patterns:
 *   /agents/:agentId
 *   /agents/:agentId/s/:sessionId
 */
export function useAgentSessionId(): string {
  const { sessionId } = useParams<{ sessionId?: string }>()
  return resolveSessionId(sessionId)
}
