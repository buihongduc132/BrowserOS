/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { AgentSessionStore } from '../../../agent/agent-session-store'
import { AgentSessionService } from './agent-session-service'

describe('AgentSessionService', () => {
  let service: AgentSessionService
  let memStore: AgentSessionStore

  beforeEach(() => {
    memStore = new AgentSessionStore()
    service = new AgentSessionService(memStore)
  })

  // ─── WORST FIRST ───

  describe('nonexistent session operations', () => {
    it('getSession returns null for unknown session', async () => {
      expect(await service.getSession('nonexistent')).toBeNull()
    })

    it('closeSession returns false for unknown session', async () => {
      expect(await service.closeSession('nonexistent')).toBe(false)
    })

    it('updateTitle on nonexistent session throws', async () => {
      expect(service.updateTitle('nonexistent', 'title')).rejects.toThrow()
    })

    it('listSessions returns empty for agent with no sessions', async () => {
      const result = await service.listSessions('agent-1')
      expect(result.sessions).toEqual([])
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('closeSession on already-closed session returns false', async () => {
      const session = await service.createSession('agent-1')
      await service.closeSession(session.id)
      // Already gone from mem store
      expect(await service.closeSession(session.id)).toBe(false)
    })

    it('updateTitle with empty string works (clears title)', async () => {
      const session = await service.createSession('agent-1')
      await service.updateTitle(session.id, 'My Title')
      await service.updateTitle(session.id, '')
      const updated = await service.getSession(session.id)
      expect(updated!.title).toBe('')
    })
  })

  // ─── HAPPY PATH ───

  describe('full lifecycle', () => {
    it('create → list → get → updateTitle → close', async () => {
      // Create
      const created = await service.createSession(
        'agent-1',
        '/home/user/project',
      )
      expect(created.id).toBeTruthy()
      expect(created.agentId).toBe('agent-1')
      expect(created.cwd).toBe('/home/user/project')
      expect(created.mode).toBe('agent')
      expect(created.title).toBeNull()
      expect(created.turnCount).toBe(0)

      // List
      const listed = await service.listSessions('agent-1')
      expect(listed.sessions).toHaveLength(1)
      expect(listed.sessions[0].id).toBe(created.id)

      // Get
      const got = await service.getSession(created.id)
      expect(got).not.toBeNull()
      expect(got!.id).toBe(created.id)

      // Update title
      await service.updateTitle(created.id, 'Bug fix session')
      const titled = await service.getSession(created.id)
      expect(titled!.title).toBe('Bug fix session')

      // Close
      const closed = await service.closeSession(created.id)
      expect(closed).toBe(true)

      // Verify gone
      expect(await service.getSession(created.id)).toBeNull()
    })
  })

  describe('multiple sessions per agent', () => {
    it('lists all sessions for same agent', async () => {
      const s1 = await service.createSession('agent-1')
      const s2 = await service.createSession('agent-1')
      const s3 = await service.createSession('agent-1')

      const listed = await service.listSessions('agent-1')
      expect(listed.sessions).toHaveLength(3)

      const ids = listed.sessions.map((s) => s.id)
      expect(ids).toContain(s1.id)
      expect(ids).toContain(s2.id)
      expect(ids).toContain(s3.id)
    })

    it('does not mix sessions between agents', async () => {
      await service.createSession('agent-1')
      await service.createSession('agent-2')

      const agent1List = await service.listSessions('agent-1')
      const agent2List = await service.listSessions('agent-2')

      expect(agent1List.sessions).toHaveLength(1)
      expect(agent2List.sessions).toHaveLength(1)
      expect(agent1List.sessions[0].agentId).toBe('agent-1')
      expect(agent2List.sessions[0].agentId).toBe('agent-2')
    })
  })

  describe('session ID generation', () => {
    it('generates unique IDs for each session', async () => {
      const s1 = await service.createSession('agent-1')
      const s2 = await service.createSession('agent-1')
      expect(s1.id).not.toBe(s2.id)
    })

    it('IDs are valid UUIDs', async () => {
      const s = await service.createSession('agent-1')
      // UUID v4 format
      expect(s.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
    })
  })

  describe('ref-count integration with mem store', () => {
    it('createSession opens a handle in mem store', async () => {
      const session = await service.createSession('agent-1')
      expect(memStore.has('agent-1', session.id)).toBe(true)
      expect(memStore.get('agent-1', session.id)?.agentId).toBe('agent-1')
    })

    it('closeSession removes from mem store when ref hits 0', async () => {
      const session = await service.createSession('agent-1')
      expect(memStore.has('agent-1', session.id)).toBe(true)
      await service.closeSession(session.id)
      expect(memStore.has('agent-1', session.id)).toBe(false)
    })
  })
})
