/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import type { AssistantSessionStore } from '../../sessions/assistant-session-store'

export interface AssistantSessionRoutesDeps {
  store: AssistantSessionStore
}

export function createAssistantSessionRoutes(deps: AssistantSessionRoutesDeps) {
  const { store } = deps
  return (
    new Hono()
      // ─── List sessions ──────────────────────────────────────
      .get('/', async (c) => {
        const limit = parseInt(c.req.query('limit') ?? '50', 10)
        const cursorParam = c.req.query('cursor')
        const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined
        const workspacePath = c.req.query('workspacePath')
        const tag = c.req.query('tag')

        const result = await store.list({
          limit: Number.isNaN(limit) ? 50 : limit,
          cursor: Number.isNaN(cursor as number) ? undefined : cursor,
          workspacePath: workspacePath ?? undefined,
          tag: tag ?? undefined,
        })

        return c.json(result)
      })

      // ─── Create session ─────────────────────────────────────
      .post('/', async (c) => {
        const body = await c.req.json().catch(() => null)
        if (!body?.id) {
          return c.json({ error: 'Missing required field: id' }, 400)
        }

        const session = await store.create({
          id: body.id,
          title: body.title,
          mode: body.mode,
        })

        return c.json(session, 201)
      })

      // ─── Get session ────────────────────────────────────────
      .get('/:id', async (c) => {
        const id = c.req.param('id')
        const session = await store.get(id)

        if (!session) {
          return c.json({ error: 'Session not found' }, 404)
        }

        return c.json(session)
      })

      // ─── Update session ─────────────────────────────────────
      .patch('/:id', async (c) => {
        const id = c.req.param('id')
        const existing = await store.get(id)

        if (!existing) {
          return c.json({ error: 'Session not found' }, 404)
        }

        const body = await c.req.json().catch(() => ({}))

        // Update scalar fields
        const updateFields: Record<string, unknown> = {}
        if (body.title !== undefined) updateFields.title = body.title
        if (body.mode !== undefined) updateFields.mode = body.mode
        if (body.model !== undefined) updateFields.model = body.model
        if (body.messageCount !== undefined)
          updateFields.messageCount = body.messageCount
        if (body.lastMessagePreview !== undefined)
          updateFields.lastMessagePreview = body.lastMessagePreview
        if (body.lastMessageAt !== undefined)
          updateFields.lastMessageAt = body.lastMessageAt
        if (body.meta !== undefined) updateFields.meta = body.meta

        if (Object.keys(updateFields).length > 0) {
          await store.update(id, updateFields)
        }

        // Update workspaces (additive)
        if (Array.isArray(body.workspaces)) {
          for (const ws of body.workspaces) {
            if (ws.workspaceId && ws.workspacePath && ws.workspaceName) {
              await store.addWorkspace(id, {
                workspaceId: ws.workspaceId,
                workspacePath: ws.workspacePath,
                workspaceName: ws.workspaceName,
              })
            }
          }
        }

        // Update tags (full replace)
        if (Array.isArray(body.tags)) {
          await store.setTags(id, body.tags)
        }

        const updated = await store.get(id)
        return c.json(updated)
      })

      // ─── Delete session ─────────────────────────────────────
      .delete('/:id', async (c) => {
        const id = c.req.param('id')
        const deleted = await store.delete(id)

        if (!deleted) {
          return c.json({ error: 'Session not found' }, 404)
        }

        return c.json({ success: true })
      })

      // ─── Trigger compaction ─────────────────────────────────
      .post('/:id/compact', async (c) => {
        const id = c.req.param('id')
        const session = await store.get(id)

        if (!session) {
          return c.json({ error: 'Session not found' }, 404)
        }

        // Compaction is handled by the existing compaction system.
        // This endpoint is a future hook for manual trigger.
        // For now, return success to acknowledge the request.
        return c.json({ success: true, message: 'Compaction scheduled' })
      })
  )
}
