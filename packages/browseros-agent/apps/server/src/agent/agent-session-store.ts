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

export interface SessionMeta {
  sessionId: string
  agentId: string
  title?: string
  turnCount?: number
  lastMessagePreview?: string
  lastMessageAt?: number
  mode?: string
  model?: string
  meta?: Record<string, unknown>
  cwd?: string
  createdAt: number
  updatedAt?: number
}

export interface ActiveSession {
  sessionId: string
  agentId: string
  refCount: number
  createdAt: number
}

export interface ListSessionsOptions {
  search?: string
  cursor?: string
  limit?: number
}

export class AgentSessionStore {
  /** Composite key: `${agentId}::${sessionId}` — prevents cross-agent session collision. */
  private static key(agentId: string, sessionId: string): string {
    return `${agentId}::${sessionId}`
  }

  private sessions = new Map<string, ActiveSession>()

  /**
   * Open a session handle. If session already exists, increments refCount.
   * Otherwise creates a new entry with refCount = 1.
   */
  open(agentId: string, sessionId: string): ActiveSession {
    const key = AgentSessionStore.key(agentId, sessionId)
    const existing = this.sessions.get(key)
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
    this.sessions.set(key, session)
    return session
  }

  /**
   * Close a session handle. Decrements refCount.
   * Returns true only when the session was fully removed (refCount reached 0).
   * Returns false if session still has refs or doesn't exist.
   */
  close(agentId: string, sessionId: string): boolean {
    const key = AgentSessionStore.key(agentId, sessionId)
    const session = this.sessions.get(key)
    if (!session) return false

    session.refCount--
    if (session.refCount <= 0) {
      this.sessions.delete(key)
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
  has(agentId: string, sessionId: string): boolean {
    return this.sessions.has(AgentSessionStore.key(agentId, sessionId))
  }

  /**
   * Get a session by agentId + sessionId.
   */
  get(agentId: string, sessionId: string): ActiveSession | undefined {
    return this.sessions.get(AgentSessionStore.key(agentId, sessionId))
  }

  /**
   * Total number of active sessions (unique composite keys).
   */
  get size(): number {
    return this.sessions.size
  }

  // ── Extended methods for ACP session routes ──

  private sessionMeta = new Map<string, SessionMeta>()

  async openSession(
    agentId: string,
    sessionId: string,
    cwd?: string,
  ): Promise<SessionMeta> {
    this.open(agentId, sessionId)
    const key = AgentSessionStore.key(agentId, sessionId)
    const meta: SessionMeta = {
      sessionId,
      agentId,
      cwd,
      createdAt: Date.now(),
    }
    this.sessionMeta.set(key, meta)
    return meta
  }

  async listSessions(
    agentId: string,
    options?: ListSessionsOptions,
  ): Promise<SessionMeta[]> {
    let results: SessionMeta[] = []
    for (const meta of this.sessionMeta.values()) {
      if (meta.agentId === agentId) results.push(meta)
    }
    if (options?.search) {
      const q = options.search.toLowerCase()
      results = results.filter(
        (m) =>
          m.title?.toLowerCase().includes(q) ||
          m.lastMessagePreview?.toLowerCase().includes(q),
      )
    }
    results.sort(
      (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
    )
    if (options?.cursor) {
      const idx = results.findIndex((m) => m.sessionId === options.cursor)
      if (idx >= 0) results = results.slice(idx + 1)
    }
    if (options?.limit) results = results.slice(0, options.limit)
    return results
  }

  async getSessionMeta(
    agentId: string,
    sessionId: string,
  ): Promise<SessionMeta | undefined> {
    return this.sessionMeta.get(AgentSessionStore.key(agentId, sessionId))
  }

  async updateSessionMeta(
    agentId: string,
    sessionId: string,
    updates: Partial<Omit<SessionMeta, 'sessionId' | 'agentId' | 'createdAt'>>,
  ): Promise<SessionMeta | undefined> {
    const key = AgentSessionStore.key(agentId, sessionId)
    const existing = this.sessionMeta.get(key)
    if (!existing) return undefined
    Object.assign(existing, updates, { updatedAt: Date.now() })
    return existing
  }

  async closeSession(agentId: string, sessionId: string): Promise<number> {
    const removed = this.close(agentId, sessionId)
    if (removed) {
      this.sessionMeta.delete(AgentSessionStore.key(agentId, sessionId))
    }
    const remaining = this.get(agentId, sessionId)
    return remaining?.refCount ?? 0
  }
}
