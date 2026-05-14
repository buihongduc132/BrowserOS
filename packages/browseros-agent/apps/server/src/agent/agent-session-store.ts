/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Ref-counted in-memory session store for ACP agent mode.
 *
 * Tracks active session handles (open connections). When multiple UI components
 * reference the same session, refCount increases. Session is only removed when
 * refCount drops to zero via close().
 *
 * This is distinct from SessionStore (which holds agent runtime state like
 * AiSdkAgent, browser context, MCP servers). AgentSessionStore wraps it —
 * when ref count hits 0, consumers should call SessionStore.delete(sessionId).
 */

export interface ActiveSession {
  sessionId: string
  agentId: string
  refCount: number
  createdAt: number
}

export class AgentSessionStore {
  private sessions = new Map<string, ActiveSession>()

  /**
   * Open a session handle. If session already exists, increments refCount.
   * Otherwise creates a new entry with refCount = 1.
   */
  open(agentId: string, sessionId: string): ActiveSession {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      existing.refCount++
      return existing
    }

    const session: ActiveSession = {
      sessionId,
      agentId,
      refCount: 1,
      createdAt: Date.now(),
    }
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Close a session handle. Decrements refCount.
   * Returns true only when the session was fully removed (refCount reached 0).
   * Returns false if session still has refs or doesn't exist.
   */
  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    session.refCount--
    if (session.refCount <= 0) {
      this.sessions.delete(sessionId)
      return true
    }
    return false
  }

  /**
   * Get all active sessions for a given agent.
   */
  listByAgent(agentId: string): ActiveSession[] {
    const result: ActiveSession[] = []
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId) {
        result.push(session)
      }
    }
    return result
  }

  /**
   * Check if a session exists in the store.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Total number of active sessions (unique IDs).
   */
  get size(): number {
    return this.sessions.size
  }
}
