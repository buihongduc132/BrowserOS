import { useParams } from 'react-router'
import { resolveSessionId } from './useAgentSessionId'

export {
  buildSessionIdHeader,
  DEFAULT_SESSION_ID,
  resolveSessionId,
} from './useAgentSessionId'

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
