/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { BrowserOsDatabase } from '../lib/db'
import type { AssistantSessionRow } from '../lib/db/schema'
import {
  assistantSessions,
  sessionTags,
  sessionWorkspaces,
} from '../lib/db/schema'
import { logger } from '../lib/logger'

export interface AssistantSessionWithJoins {
  id: string
  title: string | null
  mode: 'chat' | 'agent'
  model: string | null
  messageCount: number
  lastMessagePreview: string | null
  lastMessageAt: number | null
  createdAt: number
  updatedAt: number
  meta: Record<string, unknown> | null
  workspaces: SessionWorkspaceResult[]
  tags: string[]
}

export interface SessionWorkspaceResult {
  sessionId: string
  workspaceId: string
  workspacePath: string
  workspaceName: string
}

export interface ListSessionsOptions {
  cursor?: number
  limit?: number
  workspacePath?: string
  tag?: string
}

export interface ListSessionsResult {
  sessions: AssistantSessionRow[]
  nextCursor: number | null
}

/** Manages assistant session metadata in SQLite via Drizzle. */
export class AssistantSessionStore {
  constructor(private readonly db: BrowserOsDatabase) {}

  async create(input: {
    id: string
    title?: string
    mode?: 'chat' | 'agent'
  }): Promise<AssistantSessionRow> {
    const now = Date.now()
    const row = {
      id: input.id,
      title: input.title ?? null,
      mode: input.mode ?? ('chat' as const),
      createdAt: now,
      updatedAt: now,
    }
    this.db.insert(assistantSessions).values(row).run()
    logger.debug('Assistant session created', { sessionId: input.id })
    return row as AssistantSessionRow
  }

  async get(sessionId: string): Promise<AssistantSessionWithJoins | null> {
    const row = this.db
      .select()
      .from(assistantSessions)
      .where(eq(assistantSessions.id, sessionId))
      .get()

    if (!row) return null

    const workspaces = await this.getWorkspaces(sessionId)
    const tags = await this.getTags(sessionId)

    return {
      ...row,
      meta: parseJsonOrNull(row.meta),
      workspaces,
      tags,
    }
  }

  async list(options: ListSessionsOptions = {}): Promise<ListSessionsResult> {
    const limit = options.limit ?? 50

    // Build base conditions
    const conditions = []
    if (options.cursor !== undefined) {
      conditions.push(lt(assistantSessions.updatedAt, options.cursor))
    }

    // Filter by workspace
    if (options.workspacePath) {
      const matchingSessionIds = this.db
        .select({ id: sessionWorkspaces.sessionId })
        .from(sessionWorkspaces)
        .where(eq(sessionWorkspaces.workspacePath, options.workspacePath))
        .all()
        .map((r) => r.id)

      if (matchingSessionIds.length === 0) {
        return { sessions: [], nextCursor: null }
      }
      conditions.push(
        sql`${assistantSessions.id} IN (${sql.join(
          matchingSessionIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
    }

    // Filter by tag
    if (options.tag) {
      const taggedSessionIds = this.db
        .select({ id: sessionTags.sessionId })
        .from(sessionTags)
        .where(eq(sessionTags.tag, options.tag))
        .all()
        .map((r) => r.id)

      if (taggedSessionIds.length === 0) {
        return { sessions: [], nextCursor: null }
      }
      conditions.push(
        sql`${assistantSessions.id} IN (${sql.join(
          taggedSessionIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
    }

    const whereClause =
      conditions.length > 0 ? sql.join(conditions, sql` AND `) : undefined

    const rows = this.db
      .select()
      .from(assistantSessions)
      .where(whereClause ?? undefined)
      .orderBy(desc(assistantSessions.updatedAt))
      .limit(limit + 1) // fetch one extra to detect next page
      .all()

    const hasMore = rows.length > limit
    const sessions = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? sessions[sessions.length - 1].updatedAt : null

    return { sessions, nextCursor }
  }

  async update(
    sessionId: string,
    data: Partial<
      Pick<
        AssistantSessionRow,
        | 'title'
        | 'mode'
        | 'model'
        | 'messageCount'
        | 'lastMessagePreview'
        | 'lastMessageAt'
        | 'meta'
        | 'updatedAt'
      >
    >,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: data.updatedAt ?? Date.now(),
    }
    if (data.meta !== undefined) {
      updateData.meta = JSON.stringify(data.meta)
    }

    this.db
      .update(assistantSessions)
      .set(updateData)
      .where(eq(assistantSessions.id, sessionId))
      .run()
  }

  async delete(sessionId: string): Promise<boolean> {
    // Delete cascading: tags, workspaces, then session
    this.db
      .delete(sessionTags)
      .where(eq(sessionTags.sessionId, sessionId))
      .run()
    this.db
      .delete(sessionWorkspaces)
      .where(eq(sessionWorkspaces.sessionId, sessionId))
      .run()
    const result = this.db
      .delete(assistantSessions)
      .where(eq(assistantSessions.id, sessionId))
      .run()
    return (result as unknown as { changes: number }).changes > 0
  }

  async addWorkspace(
    sessionId: string,
    workspace: Omit<SessionWorkspaceResult, 'sessionId'>,
  ): Promise<void> {
    this.db
      .insert(sessionWorkspaces)
      .values({
        sessionId,
        ...workspace,
      })
      .onConflictDoNothing()
      .run()
  }

  async removeWorkspace(sessionId: string, workspaceId: string): Promise<void> {
    this.db
      .delete(sessionWorkspaces)
      .where(
        and(
          eq(sessionWorkspaces.sessionId, sessionId),
          eq(sessionWorkspaces.workspaceId, workspaceId),
        ),
      )
      .run()
  }

  async getWorkspaces(sessionId: string): Promise<SessionWorkspaceResult[]> {
    return this.db
      .select()
      .from(sessionWorkspaces)
      .where(eq(sessionWorkspaces.sessionId, sessionId))
      .all() as SessionWorkspaceResult[]
  }

  async setTags(sessionId: string, tags: string[]): Promise<void> {
    // Full replace: delete all, then insert new
    this.db
      .delete(sessionTags)
      .where(eq(sessionTags.sessionId, sessionId))
      .run()

    if (tags.length > 0) {
      this.db
        .insert(sessionTags)
        .values(tags.map((tag) => ({ sessionId, tag })))
        .run()
    }
  }

  async getTags(sessionId: string): Promise<string[]> {
    return this.db
      .select({ tag: sessionTags.tag })
      .from(sessionTags)
      .where(eq(sessionTags.sessionId, sessionId))
      .all()
      .map((r) => r.tag)
  }
}

function parseJsonOrNull(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
