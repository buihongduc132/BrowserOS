/**
 * T10: glow.content ownership badge — type and logic tests.
 *
 * Tests GlowMessage type extensions and badge rendering logic.
 * DOM interaction tests require browser extension runtime (WXT).
 */

import { describe, it, expect } from 'bun:test'
import type { GlowMessage } from '../../../src/tools/../../../agent/entrypoints/glow.content/GlowMessage'

// We test the GlowMessage type contract — all ownership fields are optional
// and backward-compatible with existing messages.
describe('GlowMessage ownership extensions', () => {
  it('existing messages without ownership fields are still valid', () => {
    const msg: GlowMessage = {
      conversationId: 'conv-1',
      isActive: true,
    }
    expect(msg.conversationId).toBe('conv-1')
    expect(msg.lockHeld).toBeUndefined()
    expect(msg.agentName).toBeUndefined()
    expect(msg.controlledBy).toBeUndefined()
  })

  it('messages with showConfetti are still valid', () => {
    const msg: GlowMessage = {
      conversationId: 'conv-1',
      isActive: false,
      showConfetti: true,
    }
    expect(msg.showConfetti).toBe(true)
  })

  it('messages with ownership fields are valid', () => {
    const msg: GlowMessage = {
      conversationId: 'conv-1',
      isActive: true,
      lockHeld: true,
      agentName: 'Agent-1',
      controlledBy: {
        conversationId: 'conv-1',
        agentId: 'agent-1',
      },
    }
    expect(msg.lockHeld).toBe(true)
    expect(msg.agentName).toBe('Agent-1')
    expect(msg.controlledBy?.conversationId).toBe('conv-1')
    expect(msg.controlledBy?.agentId).toBe('agent-1')
  })

  it('lockHeld false with controlledBy is valid', () => {
    const msg: GlowMessage = {
      conversationId: 'conv-1',
      isActive: true,
      lockHeld: false,
      controlledBy: null,
    }
    expect(msg.lockHeld).toBe(false)
  })

  it('controlledBy without agentId is valid', () => {
    const msg: GlowMessage = {
      conversationId: 'conv-1',
      isActive: true,
      lockHeld: true,
      controlledBy: {
        conversationId: 'conv-2',
      },
    }
    expect(msg.controlledBy?.agentId).toBeUndefined()
  })
})
