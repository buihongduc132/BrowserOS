/**
 * Frontend-only session types for ACP agent-command.
 * Backend CRUD endpoints are deferred; these types model the local UI state.
 */

export interface AgentSession {
  sessionId: string
  agentId: string
  title: string | null
  lastMessagePreview: string | null
  lastMessageAt: number | null
  createdAt: number
}

export const SESSION_LIST_STORAGE_KEY = 'agent-session-list'

/**
 * Filter sessions by search query. Matches against title and sessionId.
 * Returns the original array reference when query is empty (avoids re-renders).
 */
export function filterSessionsBySearch(
  sessions: AgentSession[],
  search: string,
): AgentSession[] {
  if (!search.trim()) return sessions
  const q = search.toLowerCase().trim()
  return sessions.filter(
    (s) =>
      (s.title && s.title.toLowerCase().includes(q)) ||
      s.sessionId.toLowerCase().includes(q),
  )
}

/**
 * Generate a new session ID. Uses crypto.randomUUID when available,
 * falls back to a timestamp-based ID.
 */
export function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}
