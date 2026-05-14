/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for command frontmatter parsing, built-in definitions,
 * and loader validation.
 */
import { describe, expect, it } from 'bun:test'
import { getBuiltinCommands } from '../../src/commands/builtin'
import { isValidCommandFrontmatter } from '../../src/commands/loader'

// ─── Suite 1: Command Types & Frontmatter Parsing ──────────

describe('isValidCommandFrontmatter', () => {
  it('TC-S1.1: valid frontmatter with description and model', () => {
    const data = { description: 'Run tests', model: 'gpt-4' }
    expect(isValidCommandFrontmatter(data)).toBe(true)
  })

  it('TC-S1.2: missing description rejects', () => {
    const data = { model: 'gpt-4' }
    expect(isValidCommandFrontmatter(data)).toBe(false)
  })

  it('TC-S1.3: unknown fields accepted (not rejected)', () => {
    const data = { description: 'x', unknownField: 'y' }
    expect(isValidCommandFrontmatter(data)).toBe(true)
  })

  it('TC-S1.4: deferred fields accepted', () => {
    const data = { description: 'x', agent: 'build', subtask: true }
    expect(isValidCommandFrontmatter(data)).toBe(true)
  })

  it('TC-S1.5: empty description rejects', () => {
    const data = { description: '' }
    expect(isValidCommandFrontmatter(data)).toBe(false)
  })

  it('null input rejects', () => {
    expect(isValidCommandFrontmatter(null)).toBe(false)
  })

  it('non-object rejects', () => {
    expect(isValidCommandFrontmatter('string')).toBe(false)
  })
})

// ─── Suite 2: Built-in Command Definitions ─────────────────

describe('getBuiltinCommands', () => {
  const commands = getBuiltinCommands()

  it('TC-S2.1: all built-in commands have required fields', () => {
    for (const cmd of commands) {
      expect(cmd.id).toBeTruthy()
      expect(cmd.name).toMatch(/^\//)
      expect(cmd.description).toBeTruthy()
      expect(cmd.action).toBeTruthy()
    }
  })

  it('TC-S2.2: built-in command names are unique', () => {
    const names = commands.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('TC-S2.3: built-in list matches spec', () => {
    const names = commands.map((c) => c.name).sort()
    expect(names).toEqual([
      '/clear',
      '/compact',
      '/help',
      '/mode',
      '/model',
      '/reset',
    ])
  })

  it('each built-in has an action', () => {
    for (const cmd of commands) {
      expect(cmd.action).toMatch(/^(clear|compact|mode|model|help|reset)$/)
    }
  })
})
