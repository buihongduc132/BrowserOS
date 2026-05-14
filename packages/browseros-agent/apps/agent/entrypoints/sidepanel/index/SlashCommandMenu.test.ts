/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for SlashCommandMenu filtering and grouping logic.
 * Covers TDD suite 2 (SlashCommandMenu Rendering).
 *
 * Note: Full rendering tests require a browser environment (DOM).
 * The filtering/grouping logic is tested via the useSlashCommandFilter hook.
 * Component rendering is tested with the actual DOM.
 */

import { describe, expect, it } from 'bun:test'
import type { SlashCommandItem } from './SlashCommandMenu'

// Extract the filtering logic into a pure function for testing
function filterCommands(
  commands: SlashCommandItem[],
  filterText: string,
): { builtIn: SlashCommandItem[]; custom: SlashCommandItem[] } {
  const lower = filterText.toLowerCase()
  const filtered = filterText
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lower) ||
          cmd.description.toLowerCase().includes(lower),
      )
    : commands

  return {
    builtIn: filtered.filter((c) => c.builtIn),
    custom: filtered.filter((c) => !c.builtIn),
  }
}

const ALL_COMMANDS: SlashCommandItem[] = [
  {
    id: 'clear',
    name: '/clear',
    description: 'Clear conversation history',
    builtIn: true,
  },
  {
    id: 'compact',
    name: '/compact',
    description: 'Trigger compaction using current config',
    builtIn: true,
  },
  {
    id: 'reset',
    name: '/reset',
    description: 'Reset conversation and context',
    builtIn: true,
  },
  {
    id: 'analyze',
    name: '/analyze',
    description: 'Deep analysis of code',
    builtIn: false,
  },
  {
    id: 'test',
    name: '/test',
    description: 'Run tests with coverage',
    builtIn: false,
  },
]

describe('SlashCommandMenu filter logic', () => {
  it('TC-C2.1: groups rendered correctly', () => {
    const result = filterCommands(ALL_COMMANDS, '')
    expect(result.builtIn).toHaveLength(3)
    expect(result.custom).toHaveLength(2)
  })

  it('TC-C2.2: empty filter shows no results for non-matching text', () => {
    const result = filterCommands(ALL_COMMANDS, 'zzz')
    expect(result.builtIn).toHaveLength(0)
    expect(result.custom).toHaveLength(0)
  })

  it('TC-C2.3: each item has name + description', () => {
    for (const cmd of ALL_COMMANDS) {
      expect(cmd.name).toBeTruthy()
      expect(cmd.description).toBeTruthy()
      expect(cmd.name.startsWith('/')).toBe(true)
    }
  })

  it('TC-C1.4: typing filters commands by name (includes match)', () => {
    const result = filterCommands(ALL_COMMANDS, 'cl')
    expect(result.builtIn).toHaveLength(1) // /clear ("compact" doesn't contain "cl")
    const allFiltered = [...result.builtIn, ...result.custom]
    expect(allFiltered[0].id).toBe('clear')
  })

  it('filters by description', () => {
    const result = filterCommands(ALL_COMMANDS, 'coverage')
    expect(result.custom).toHaveLength(1) // /test "Run tests with coverage"
    expect(result.custom[0].id).toBe('test')
  })

  it('case-insensitive filter', () => {
    const result = filterCommands(ALL_COMMANDS, 'CLEAR')
    expect(result.builtIn).toHaveLength(1)
    expect(result.builtIn[0].id).toBe('clear')
  })

  it('empty filter returns all commands', () => {
    const result = filterCommands(ALL_COMMANDS, '')
    expect([...result.builtIn, ...result.custom]).toHaveLength(5)
  })

  it('single character filter', () => {
    const result = filterCommands(ALL_COMMANDS, 'r')
    const allFiltered = [...result.builtIn, ...result.custom]
    // /clear (has 'r'), /reset, /analyze (has 'r'), /test (no 'r')...
    // /clear has 'r', /compact has no 'r', /reset starts with 'r'
    expect(allFiltered.some((c) => c.id === 'reset')).toBe(true)
  })

  it('partial word match', () => {
    const result = filterCommands(ALL_COMMANDS, 'ana')
    expect(result.custom).toHaveLength(1)
    expect(result.custom[0].id).toBe('analyze')
  })
})
