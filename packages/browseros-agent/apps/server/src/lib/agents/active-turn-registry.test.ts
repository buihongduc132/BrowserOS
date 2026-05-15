/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, beforeEach } from 'bun:test'
import { TurnRegistry } from './active-turn-registry'

describe('TurnRegistry sessionId parameterization', () => {
  let registry: TurnRegistry

  beforeEach(() => {
    registry = new TurnRegistry()
  })

  // ─── WORST FIRST ───

  describe('custom sessionId isolation', () => {
    it('turns with different sessionIds are independent', () => {
      // Register turn for 'main' session
      const mainTurn = registry.register('agent-1', 'main', {
        prompt: 'main task',
      })

      // Register turn for custom session — should NOT conflict
      const customTurn = registry.register('agent-1', 'custom-session-42', {
        prompt: 'custom task',
      })

      expect(mainTurn.turnId).not.toBe(customTurn.turnId)
      expect(mainTurn.sessionId).toBe('main')
      expect(customTurn.sessionId).toBe('custom-session-42')

      // Both should be active
      expect(registry.getActiveFor('agent-1', 'main')?.turnId).toBe(
        mainTurn.turnId,
      )
      expect(
        registry.getActiveFor('agent-1', 'custom-session-42')?.turnId,
      ).toBe(customTurn.turnId)
    })

    it('getActiveFor returns undefined for wrong sessionId', () => {
      const turn = registry.register('agent-1', 'session-a', {
        prompt: 'task a',
      })

      expect(registry.getActiveFor('agent-1', 'session-a')?.turnId).toBe(
        turn.turnId,
      )
      expect(registry.getActiveFor('agent-1', 'session-b')).toBeUndefined()
      expect(registry.getActiveFor('agent-1', 'main')).toBeUndefined()
    })

    it('cancelling one session does not affect another', () => {
      const turnA = registry.register('agent-1', 'session-a')
      const turnB = registry.register('agent-1', 'session-b')

      registry.cancel(turnA.turnId)

      expect(registry.getActiveFor('agent-1', 'session-a')).toBeUndefined()
      expect(registry.getActiveFor('agent-1', 'session-b')?.turnId).toBe(
        turnB.turnId,
      )
    })
  })

  // ─── BACKWARD COMPAT ───

  describe('default sessionId = main', () => {
    it('register without sessionId defaults to main', () => {
      const turn = registry.register('agent-1')
      expect(turn.sessionId).toBe('main')
    })

    it('register with explicit sessionId = main works', () => {
      const turn = registry.register('agent-1', 'main')
      expect(turn.sessionId).toBe('main')
    })

    it('getActiveFor without sessionId defaults to main', () => {
      const turn = registry.register('agent-1', 'main')
      expect(registry.getActiveFor('agent-1')?.turnId).toBe(turn.turnId)
    })
  })

  // ─── DESCRIBE (metadata) ───

  describe('describe returns correct sessionId', () => {
    it('describe includes custom sessionId', () => {
      const turn = registry.register('agent-1', 'my-custom-session', {
        prompt: 'test',
      })
      const info = registry.describe(turn.turnId)
      expect(info).not.toBeNull()
      expect(info!.sessionId).toBe('my-custom-session')
    })
  })
})
