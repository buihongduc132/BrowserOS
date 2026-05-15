/**
 * Default session identifier used when no explicit session is selected.
 * Matches the server-side convention where 'main' is the hardcoded default.
 */
export const DEFAULT_SESSION_ID = 'main'

/**
 * Resolve a session ID from a route param or other source.
 * Falls back to DEFAULT_SESSION_ID ('main') for empty/undefined values.
 *
 * Pure function — safe to test without React context.
 */
export function resolveSessionId(
  sessionId: string | undefined,
): string {
  if (!sessionId) return DEFAULT_SESSION_ID
  return sessionId
}

/**
 * Build the X-Session-Id header object for fetch requests.
 * Uses the provided sessionId or falls back to 'main'.
 */
export function buildSessionIdHeader(
  sessionId?: string,
): Record<string, string> {
  return { 'X-Session-Id': resolveSessionId(sessionId) }
}
