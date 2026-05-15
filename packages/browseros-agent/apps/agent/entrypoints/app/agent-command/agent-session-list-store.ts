import type { AgentSession } from './agent-session-list-types'
import {
  SESSION_LIST_STORAGE_KEY,
  filterSessionsBySearch,
  generateSessionId,
} from './agent-session-list-types'

/**
 * Pure session list store — no React dependency.
 * Uses localStorage for persistence across page reloads.
 * The React hook `useAgentSessionList` wraps this.
 */
export class AgentSessionListStore {
  private sessions: AgentSession[]
  private agentId: string

  constructor(agentId: string, initial?: AgentSession[]) {
    this.agentId = agentId
    this.sessions = initial ?? this.loadFromStorage()
  }

  /** Get all sessions for this agent, sorted newest first. */
  getAll(): AgentSession[] {
    return [...this.sessions].sort(
      (a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt),
    )
  }

  /** Get sessions filtered by search query. */
  getFiltered(search: string): AgentSession[] {
    return filterSessionsBySearch(this.getAll(), search)
  }

  /** Create a new session and return its ID. */
  createSession(): string {
    const sessionId = generateSessionId()
    const now = Date.now()
    const session: AgentSession = {
      sessionId,
      agentId: this.agentId,
      title: null,
      lastMessagePreview: null,
      lastMessageAt: null,
      createdAt: now,
    }
    this.sessions = [session, ...this.sessions]
    this.saveToStorage()
    return sessionId
  }

  /** Remove a session by ID. */
  removeSession(sessionId: string): void {
    this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId)
    this.saveToStorage()
  }

  /** Update a session's title. */
  updateTitle(sessionId: string, title: string): void {
    this.sessions = this.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, title } : s,
    )
    this.saveToStorage()
  }

  /** Update a session's last message info. */
  updateLastMessage(
    sessionId: string,
    preview: string,
    timestamp: number,
  ): void {
    this.sessions = this.sessions.map((s) =>
      s.sessionId === sessionId
        ? { ...s, lastMessagePreview: preview, lastMessageAt: timestamp }
        : s,
    )
    this.saveToStorage()
  }

  /** Count of sessions for this agent. */
  get count(): number {
    return this.sessions.length
  }

  // -- persistence (localStorage, keyed per agent) --

  private storageKey(): string {
    return `${SESSION_LIST_STORAGE_KEY}:${this.agentId}`
  }

  private loadFromStorage(): AgentSession[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(this.storageKey())
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      // Basic shape validation
      return parsed.filter(
        (item: unknown): item is AgentSession =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).sessionId === 'string' &&
          typeof (item as Record<string, unknown>).agentId === 'string',
      )
    } catch {
      return []
    }
  }

  private saveToStorage(): void {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.sessions))
    } catch {
      // localStorage full or unavailable — silently degrade
    }
  }
}
