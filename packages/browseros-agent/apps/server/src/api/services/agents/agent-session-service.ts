/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto'
import type {
  ActiveSession,
  AgentSessionStore,
} from '../../../agent/agent-session-store'

/**
 * Persistent session metadata for an ACP agent session.
 * The in-memory AgentSessionStore tracks active handles; this service
 * adds durable metadata on top.
 */
export interface AgentSessionInfo {
  id: string
  agentId: string
  title: string | null
  cwd: string | null
  mode: 'code' | 'ask' | 'agent'
  model: string | null
  turnCount: number
  lastMessagePreview: string | null
  lastMessageAt: number | null
  createdAt: number
  updatedAt: number
}

export interface SessionListResponse {
  sessions: AgentSessionInfo[]
  nextCursor: string | null
}

/**
 * Service for ACP agent session management.
 *
 * Uses AgentSessionStore for ref-counted in-memory tracking and an
 * internal Map for persistent metadata. When wired to a real DB,
 * the Map would be replaced with Drizzle queries on agentSessions table.
 */
export class AgentSessionService {
  /** Persistent session metadata. In production, this would be Drizzle/SQLite. */
  private sessions = new Map<string, AgentSessionInfo>()

  constructor(private memStore: AgentSessionStore) {}

  async createSession(
    agentId: string,
    cwd?: string,
  ): Promise<AgentSessionInfo> {
    const now = Date.now()
    const session: AgentSessionInfo = {
      id: randomUUID(),
      agentId,
      title: null,
      cwd: cwd ?? null,
      mode: 'agent',
      model: null,
      turnCount: 0,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.sessions.set(session.id, session)
    this.memStore.open(agentId, session.id)

    return session
  }

  async listSessions(
    agentId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<SessionListResponse> {
    let agentSessions = Array.from(this.sessions.values())
      .filter((s) => s.agentId === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    // Cursor-based pagination: cursor is updatedAt of last item
    if (cursor) {
      const cursorTime = Number.parseInt(cursor, 10)
      if (!Number.isNaN(cursorTime)) {
        agentSessions = agentSessions.filter((s) => s.updatedAt < cursorTime)
      }
    }

    const hasMore = agentSessions.length > limit
    const sliced = agentSessions.slice(0, limit)

    return {
      sessions: sliced,
      nextCursor:
        hasMore && sliced.length > 0
          ? String(sliced[sliced.length - 1].updatedAt)
          : null,
    }
  }

  async getSession(sessionId: string): Promise<AgentSessionInfo | null> {
    return this.sessions.get(sessionId) ?? null
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Remove from persistent store
    this.sessions.delete(sessionId)

    // Remove from in-memory ref-counted store
    return this.memStore.close(session.agentId, sessionId)
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    session.title = title
    session.updatedAt = Date.now()
  }
}
