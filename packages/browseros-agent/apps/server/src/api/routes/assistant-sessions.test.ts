/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { Hono } from 'hono'
import { z } from 'zod'
import * as schema from '../../lib/db/schema'
import { AssistantSessionStore } from '../../sessions/assistant-session-store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', '..', 'lib', 'db', 'migrations')

// ─── ChatRequestSchema evolution tests ─────────────────────────

describe('ChatRequestSchema backward compatibility', () => {
  const WorkspaceSchema = z.object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
  })

  const ChatRequestSchema = z.object({
    provider: z.string(),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    conversationId: z.string().uuid(),
    message: z.string().optional().default(''),
    userWorkingDir: z.string().min(1).optional(),
    // NEW: multi-workspace support
    userWorkspaces: z.array(WorkspaceSchema).optional(),
  })

  const makeBaseRequest = () => ({
    provider: 'openai',
    model: 'gpt-4',
    conversationId: '550e8400-e29b-41d4-a716-446655440000',
  })

  it('accepts legacy format with userWorkingDir only', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
      userWorkingDir: '/path/to/workspace',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userWorkingDir).toBe('/path/to/workspace')
      expect(result.data.userWorkspaces).toBeUndefined()
    }
  })

  it('accepts new format with userWorkspaces only', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
      userWorkspaces: [
        { id: 'ws-1', path: '/path/to/frontend', name: 'frontend' },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userWorkspaces).toHaveLength(1)
      expect(result.data.userWorkspaces![0].path).toBe('/path/to/frontend')
      expect(result.data.userWorkingDir).toBeUndefined()
    }
  })

  it('accepts both formats simultaneously', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
      userWorkingDir: '/legacy/path',
      userWorkspaces: [{ id: 'ws-1', path: '/new/path', name: 'new' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userWorkingDir).toBe('/legacy/path')
      expect(result.data.userWorkspaces).toHaveLength(1)
    }
  })

  it('accepts neither format (no workspace)', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userWorkingDir).toBeUndefined()
      expect(result.data.userWorkspaces).toBeUndefined()
    }
  })

  it('rejects invalid userWorkspaces (missing required fields)', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
      userWorkspaces: [{ id: 'ws-1' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty userWorkspaces array', () => {
    const result = ChatRequestSchema.safeParse({
      ...makeBaseRequest(),
      userWorkspaces: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userWorkspaces).toHaveLength(0)
    }
  })
})

// ─── resolveWorkspaces helper tests ─────────────────────────────

describe('resolveWorkspaces', () => {
  function resolveWorkspaces(request: {
    userWorkspaces?: Array<{ id: string; path: string; name: string }>
    userWorkingDir?: string
  }): Array<{ id: string; path: string; name: string }> {
    if (request.userWorkspaces && request.userWorkspaces.length > 0) {
      return request.userWorkspaces
    }
    if (request.userWorkingDir) {
      const basename =
        request.userWorkingDir.split('/').pop() ?? request.userWorkingDir
      const hash = request.userWorkingDir.split('').reduce((a, b) => {
        a = ((a << 5) - a + b.charCodeAt(0)) | 0
        return a
      }, 0)
      return [
        {
          id: `ws-${Math.abs(hash).toString(16)}`,
          path: request.userWorkingDir,
          name: basename,
        },
      ]
    }
    return []
  }

  it('prefers userWorkspaces when present', () => {
    const result = resolveWorkspaces({
      userWorkspaces: [{ id: 'a', path: '/a', name: 'a' }],
      userWorkingDir: '/legacy',
    })
    expect(result).toEqual([{ id: 'a', path: '/a', name: 'a' }])
  })

  it('falls back to userWorkingDir with generated id and name', () => {
    const result = resolveWorkspaces({
      userWorkingDir: '/home/user/frontend',
    })
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/home/user/frontend')
    expect(result[0].name).toBe('frontend')
    expect(result[0].id).toMatch(/^ws-[0-9a-f]+$/)
  })

  it('returns empty when neither present', () => {
    expect(resolveWorkspaces({})).toEqual([])
  })

  it('ignores empty userWorkspaces array, falls back to userWorkingDir', () => {
    const result = resolveWorkspaces({
      userWorkspaces: [],
      userWorkingDir: '/fallback',
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('fallback')
  })
})

// ─── Assistant Session Routes tests ─────────────────────────────

describe('Assistant Session Routes', () => {
  let store: AssistantSessionStore
  let app: Hono

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: migrationsDir })
    store = new AssistantSessionStore(db)

    const { createAssistantSessionRoutes } = require('./assistant-sessions')
    app = new Hono()
    app.route('/', createAssistantSessionRoutes({ store }))
  })

  // ─── Worst-first: error cases ──────────────────────────────

  it('GET /:id returns 404 for nonexistent session', async () => {
    const res = await app.request('/nonexistent-id')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('DELETE /:id returns 404 for nonexistent session', async () => {
    const res = await app.request('/nonexistent-id', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('PATCH /:id returns 404 for nonexistent session', async () => {
    const res = await app.request('/nonexistent-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST / with missing id returns 400', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /:id/compact returns 404 for nonexistent session', async () => {
    const res = await app.request('/nonexistent-id/compact', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('GET / with invalid query params still returns 200 (graceful)', async () => {
    const res = await app.request('/?limit=abc')
    expect(res.status).toBe(200)
  })

  // ─── Happy path lifecycle ──────────────────────────────────

  it('create → get → update → add workspace → list by workspace → delete', async () => {
    // Create
    const createRes = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '550e8400-e29b-41d4-a716-446655440001',
        title: 'Test session',
        mode: 'chat',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.id).toBe('550e8400-e29b-41d4-a716-446655440001')

    // Get
    const getRes = await app.request('/550e8400-e29b-41d4-a716-446655440001')
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json()
    expect(fetched.id).toBe('550e8400-e29b-41d4-a716-446655440001')
    expect(fetched.title).toBe('Test session')
    expect(fetched.workspaces).toEqual([])
    expect(fetched.tags).toEqual([])

    // Update title
    const patchRes = await app.request(
      '/550e8400-e29b-41d4-a716-446655440001',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated title' }),
      },
    )
    expect(patchRes.status).toBe(200)

    // Add workspace via PATCH
    const wsRes = await app.request('/550e8400-e29b-41d4-a716-446655440001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaces: [
          {
            workspaceId: 'ws-1',
            workspacePath: '/home/user/frontend',
            workspaceName: 'frontend',
          },
        ],
      }),
    })
    expect(wsRes.status).toBe(200)

    // List by workspace filter
    const listRes = await app.request('/?workspacePath=/home/user/frontend')
    expect(listRes.status).toBe(200)
    const listed = await listRes.json()
    expect(listed.sessions.length).toBeGreaterThanOrEqual(1)
    const found = listed.sessions.find(
      (s: any) => s.id === '550e8400-e29b-41d4-a716-446655440001',
    )
    expect(found).toBeDefined()

    // Delete
    const delRes = await app.request('/550e8400-e29b-41d4-a716-446655440001', {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)

    // Verify deleted
    const afterDelete = await app.request(
      '/550e8400-e29b-41d4-a716-446655440001',
    )
    expect(afterDelete.status).toBe(404)
  })

  it('set tags replaces, does not append', async () => {
    // Create
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '550e8400-e29b-41d4-a716-446655440002' }),
    })

    // Set tags first time
    await app.request('/550e8400-e29b-41d4-a716-446655440002', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['bug', 'frontend'] }),
    })

    // Set tags second time (replace)
    await app.request('/550e8400-e29b-41d4-a716-446655440002', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['feature'] }),
    })

    // Get and verify
    const getRes = await app.request('/550e8400-e29b-41d4-a716-446655440002')
    const session = await getRes.json()
    expect(session.tags).toEqual(['feature'])
  })

  it('PATCH only title — other fields unchanged', async () => {
    // Create with mode
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '550e8400-e29b-41d4-a716-446655440003',
        title: 'Original',
        mode: 'agent',
      }),
    })

    // Patch only title
    await app.request('/550e8400-e29b-41d4-a716-446655440003', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
    })

    // Verify mode unchanged
    const getRes = await app.request('/550e8400-e29b-41d4-a716-446655440003')
    const session = await getRes.json()
    expect(session.title).toBe('New title')
    expect(session.mode).toBe('agent')
  })

  it('list returns empty for unknown workspace', async () => {
    const res = await app.request('/?workspacePath=/nonexistent/path')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toEqual([])
  })

  it('list returns empty for unknown tag', async () => {
    const res = await app.request('/?tag=nonexistent-tag')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toEqual([])
  })

  it('list with pagination cursor', async () => {
    // Create multiple sessions with distinct timestamps
    // by updating their updatedAt after creation
    for (let i = 0; i < 5; i++) {
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `550e8400-e29b-41d4-a716-4466554400${10 + i}`,
          title: `Session ${i}`,
        }),
      })
      // Ensure distinct updatedAt by updating each session
      if (i < 4) {
        await new Promise((r) => setTimeout(r, 2))
      }
    }

    // Get first page with limit 2
    const page1 = await app.request('/?limit=2')
    expect(page1.status).toBe(200)
    const body1 = await page1.json()
    expect(body1.sessions.length).toBe(2)
    expect(body1.nextCursor).toBeDefined()

    // Get second page
    const page2 = await app.request(`/?limit=2&cursor=${body1.nextCursor}`)
    expect(page2.status).toBe(200)
    const body2 = await page2.json()
    expect(body2.sessions.length).toBe(2)
    expect(body2.sessions[0].id).not.toBe(body1.sessions[0].id)
  })
})
