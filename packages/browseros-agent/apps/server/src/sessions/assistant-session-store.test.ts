/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from '../lib/db/schema'
import { AssistantSessionStore } from './assistant-session-store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'lib', 'db', 'migrations')

describe('AssistantSessionStore', () => {
  let sqlite: Database
  let store: AssistantSessionStore

  beforeEach(() => {
    sqlite = new Database(':memory:')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: migrationsDir })
    store = new AssistantSessionStore(db)
  })

  afterEach(() => {
    sqlite.close()
  })

  // ─── Worst-first: edge cases, failure zones ───

  describe('nonexistent session operations', () => {
    it('get returns null for nonexistent session', async () => {
      const result = await store.get('does-not-exist')
      expect(result).toBeNull()
    })

    it('delete returns false for nonexistent session', async () => {
      const result = await store.delete('does-not-exist')
      expect(result).toBe(false)
    })

    it('update is a no-op for nonexistent session', async () => {
      // Should not throw
      await store.update('does-not-exist', { title: 'x' })
    })

    it('getWorkspaces returns empty for nonexistent session', async () => {
      const ws = await store.getWorkspaces('does-not-exist')
      expect(ws).toEqual([])
    })

    it('getTags returns empty for nonexistent session', async () => {
      const tags = await store.getTags('does-not-exist')
      expect(tags).toEqual([])
    })
  })

  describe('double workspace add (idempotent via composite PK)', () => {
    it('adding same workspace twice results in only one row', async () => {
      await store.create({ id: 's1' })
      const ws = {
        workspaceId: 'w1',
        workspacePath: '/frontend',
        workspaceName: 'frontend',
      }

      await store.addWorkspace('s1', ws)
      await store.addWorkspace('s1', ws) // duplicate — should be idempotent

      const result = await store.get('s1')
      expect(result!.workspaces).toHaveLength(1)
      expect(result!.workspaces[0].workspaceId).toBe('w1')
    })
  })

  describe('delete cascades to workspaces and tags', () => {
    it('deleting session removes all associated workspaces and tags', async () => {
      await store.create({ id: 's1' })
      await store.addWorkspace('s1', {
        workspaceId: 'w1',
        workspacePath: '/a',
        workspaceName: 'a',
      })
      await store.addWorkspace('s1', {
        workspaceId: 'w2',
        workspacePath: '/b',
        workspaceName: 'b',
      })
      await store.setTags('s1', ['important', 'bug'])

      const deleted = await store.delete('s1')
      expect(deleted).toBe(true)

      // Verify cascading cleanup
      const ws = await store.getWorkspaces('s1')
      expect(ws).toEqual([])
      const tags = await store.getTags('s1')
      expect(tags).toEqual([])

      // Verify session is gone
      const session = await store.get('s1')
      expect(session).toBeNull()
    })
  })

  describe('cursor-based pagination', () => {
    it('paginates correctly with cursor', async () => {
      // Create 20 sessions with staggered timestamps
      for (let i = 0; i < 20; i++) {
        await store.create({ id: `s-${String(i).padStart(2, '0')}` })
        // Slight offset to ensure ordering
        await store.update(`s-${String(i).padStart(2, '0')}`, {
          updatedAt: 1000 + i,
          lastMessagePreview: `Session ${i}`,
        })
      }

      // Page 1: limit 5
      const page1 = await store.list({ limit: 5 })
      expect(page1.sessions).toHaveLength(5)
      // Most recent first (s-19 has highest updatedAt)
      expect(page1.sessions[0].id).toBe('s-19')
      expect(page1.nextCursor).toBe(page1.sessions[4].updatedAt)

      // Page 2: use cursor
      const page2 = await store.list({ limit: 5, cursor: page1.nextCursor! })
      expect(page2.sessions).toHaveLength(5)
      expect(page2.sessions[0].id).toBe('s-14')
      expect(page2.nextCursor).toBe(page2.sessions[4].updatedAt)

      // Page 4: last page
      const page3 = await store.list({ limit: 5, cursor: page2.nextCursor! })
      expect(page3.sessions).toHaveLength(5)
      const page4 = await store.list({ limit: 5, cursor: page3.nextCursor! })
      expect(page4.sessions).toHaveLength(5)
      expect(page4.nextCursor).toBeNull() // no more pages
    })

    it('returns empty with null cursor when no sessions', async () => {
      const result = await store.list({ limit: 10 })
      expect(result.sessions).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('filter by workspace', () => {
    it('returns sessions matching workspace path', async () => {
      await store.create({ id: 's1' })
      await store.create({ id: 's2' })
      await store.create({ id: 's3' })

      await store.addWorkspace('s1', {
        workspaceId: 'w1',
        workspacePath: '/frontend',
        workspaceName: 'frontend',
      })
      await store.addWorkspace('s2', {
        workspaceId: 'w2',
        workspacePath: '/backend',
        workspaceName: 'backend',
      })
      // s3 has no workspace

      const frontendSessions = await store.list({ workspacePath: '/frontend' })
      expect(frontendSessions.sessions).toHaveLength(1)
      expect(frontendSessions.sessions[0].id).toBe('s1')
    })

    it('multi-workspace session appears in multiple workspace filters', async () => {
      await store.create({ id: 'multi' })
      await store.addWorkspace('multi', {
        workspaceId: 'w1',
        workspacePath: '/frontend',
        workspaceName: 'frontend',
      })
      await store.addWorkspace('multi', {
        workspaceId: 'w2',
        workspacePath: '/backend',
        workspaceName: 'backend',
      })

      const frontendSessions = await store.list({ workspacePath: '/frontend' })
      const backendSessions = await store.list({ workspacePath: '/backend' })

      expect(frontendSessions.sessions).toHaveLength(1)
      expect(frontendSessions.sessions[0].id).toBe('multi')
      expect(backendSessions.sessions).toHaveLength(1)
      expect(backendSessions.sessions[0].id).toBe('multi')
    })
  })

  describe('filter by tag', () => {
    it('returns sessions matching tag', async () => {
      await store.create({ id: 's1' })
      await store.create({ id: 's2' })
      await store.setTags('s1', ['bug', 'urgent'])
      await store.setTags('s2', ['feature'])

      const bugSessions = await store.list({ tag: 'bug' })
      expect(bugSessions.sessions).toHaveLength(1)
      expect(bugSessions.sessions[0].id).toBe('s1')
    })

    it('multi-tag session appears in multiple tag queries', async () => {
      await store.create({ id: 'multi' })
      await store.setTags('multi', ['bug', 'urgent'])

      const bugSessions = await store.list({ tag: 'bug' })
      const urgentSessions = await store.list({ tag: 'urgent' })

      expect(bugSessions.sessions).toHaveLength(1)
      expect(bugSessions.sessions[0].id).toBe('multi')
      expect(urgentSessions.sessions).toHaveLength(1)
      expect(urgentSessions.sessions[0].id).toBe('multi')
    })
  })

  describe('setTags replaces (not appends)', () => {
    it('setTags fully replaces the tag set', async () => {
      await store.create({ id: 's1' })
      await store.setTags('s1', ['a', 'b'])
      await store.setTags('s1', ['c'])

      const tags = await store.getTags('s1')
      expect(tags).toEqual(['c'])
    })

    it('setTags with empty array clears all tags', async () => {
      await store.create({ id: 's1' })
      await store.setTags('s1', ['a', 'b'])
      await store.setTags('s1', [])

      const tags = await store.getTags('s1')
      expect(tags).toEqual([])
    })
  })

  describe('update partial fields', () => {
    it('only updated fields change, others remain', async () => {
      const now = Date.now()
      await store.create({ id: 's1', title: 'Original', mode: 'chat' })

      await store.update('s1', { title: 'Updated', messageCount: 5 })

      const session = await store.get('s1')
      expect(session!.title).toBe('Updated')
      expect(session!.messageCount).toBe(5)
      expect(session!.mode).toBe('chat') // unchanged
      expect(session!.model).toBeNull() // unchanged
    })
  })

  describe('full CRUD lifecycle', () => {
    it('create → get → update → addWorkspace → setTags → delete', async () => {
      // Create
      await store.create({
        id: 'lifecycle',
        title: 'Test Session',
        mode: 'agent',
      })

      // Get
      let session = await store.get('lifecycle')
      expect(session).not.toBeNull()
      expect(session!.id).toBe('lifecycle')
      expect(session!.title).toBe('Test Session')
      expect(session!.mode).toBe('agent')
      expect(session!.workspaces).toEqual([])
      expect(session!.tags).toEqual([])

      // Update
      await store.update('lifecycle', {
        title: 'Updated Title',
        messageCount: 10,
        lastMessagePreview: 'Hello world',
      })

      // Add workspaces
      await store.addWorkspace('lifecycle', {
        workspaceId: 'w1',
        workspacePath: '/project',
        workspaceName: 'project',
      })

      // Set tags
      await store.setTags('lifecycle', ['important', 'feature'])

      // Get with joins
      session = await store.get('lifecycle')
      expect(session!.title).toBe('Updated Title')
      expect(session!.messageCount).toBe(10)
      expect(session!.workspaces).toHaveLength(1)
      expect(session!.workspaces[0].workspaceName).toBe('project')
      expect([...session!.tags].sort()).toEqual(['feature', 'important'])

      // Delete
      const deleted = await store.delete('lifecycle')
      expect(deleted).toBe(true)
      expect(await store.get('lifecycle')).toBeNull()
    })
  })

  describe('removeWorkspace', () => {
    it('removes a specific workspace from session', async () => {
      await store.create({ id: 's1' })
      await store.addWorkspace('s1', {
        workspaceId: 'w1',
        workspacePath: '/a',
        workspaceName: 'a',
      })
      await store.addWorkspace('s1', {
        workspaceId: 'w2',
        workspacePath: '/b',
        workspaceName: 'b',
      })

      await store.removeWorkspace('s1', 'w1')

      const ws = await store.getWorkspaces('s1')
      expect(ws).toHaveLength(1)
      expect(ws[0].workspaceId).toBe('w2')
    })

    it('is a no-op for nonexistent workspace', async () => {
      await store.create({ id: 's1' })
      // Should not throw
      await store.removeWorkspace('s1', 'nonexistent')
      const ws = await store.getWorkspaces('s1')
      expect(ws).toEqual([])
    })
  })
})
