/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for slash command parsing and template resolution.
 * Covers TDD suites 1 (state machine logic) and 3 (command parsing).
 */

import { describe, expect, it } from 'bun:test'
import {
  BUILTIN_COMMAND_NAMES,
  isModelAvailable,
  parseSlashCommand,
  resolveTemplate,
} from './slash-command-resolver'

// --- Suite 3: Chat.tsx Command Parsing ---

describe('parseSlashCommand', () => {
  it('TC-C3.1: /command args detected', () => {
    const result = parseSlashCommand('/analyze Button.tsx performance')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('analyze')
    expect(result?.args).toBe('Button.tsx performance')
    expect(result?.positional).toEqual(['Button.tsx', 'performance'])
  })

  it('TC-C3.2: regular message returns null', () => {
    const result = parseSlashCommand('Hello, can you help?')
    expect(result).toBeNull()
  })

  it('TC-C3.3: unknown command still parses (resolution checks separately)', () => {
    const result = parseSlashCommand('/foobar something')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('foobar')
    expect(result?.args).toBe('something')
  })

  it('parses /clear without args', () => {
    const result = parseSlashCommand('/clear')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('clear')
    expect(result?.args).toBe('')
  })

  it('parses /compact', () => {
    const result = parseSlashCommand('/compact')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('compact')
  })

  it('handles command with extra spaces', () => {
    const result = parseSlashCommand('/analyze   Button.tsx   performance')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('analyze')
    // \s+ in regex consumes leading spaces; args starts after first whitespace group
    expect(result?.args).toBe('Button.tsx   performance')
    // Positional args are split by whitespace (trim())
    expect(result?.positional).toEqual(['Button.tsx', 'performance'])
  })

  it('rejects input starting with https://', () => {
    const result = parseSlashCommand('https://example.com')
    expect(result).toBeNull()
  })

  it('is case-insensitive for command name', () => {
    const result = parseSlashCommand('/CLEAR')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('clear')
  })

  it('handles command with hyphen in name', () => {
    const result = parseSlashCommand('/run-tests unit')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('run-tests')
    expect(result?.args).toBe('unit')
  })

  it('returns null for just /', () => {
    const result = parseSlashCommand('/')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseSlashCommand('')
    expect(result).toBeNull()
  })

  it('returns null for whitespace only', () => {
    const result = parseSlashCommand('   ')
    expect(result).toBeNull()
  })
})

describe('resolveTemplate', () => {
  it('TC-C3.6: resolves $ARGUMENTS placeholder', () => {
    const parsed = parseSlashCommand('/analyze Button.tsx')!
    const result = resolveTemplate('Deep analysis of $ARGUMENTS', parsed)
    expect(result).toBe('Deep analysis of Button.tsx')
  })

  it('resolves positional args $1, $2', () => {
    const parsed = parseSlashCommand('/test Button.tsx performance')!
    const result = resolveTemplate('Test $1 with focus on $2', parsed)
    expect(result).toBe('Test Button.tsx with focus on performance')
  })

  it('leaves unresolved placeholders as-is', () => {
    const parsed = parseSlashCommand('/test Button.tsx')!
    const result = resolveTemplate('Test $1 and $2 and $3', parsed)
    expect(result).toBe('Test Button.tsx and $2 and $3')
  })

  it('resolves mixed $ARGUMENTS and positional', () => {
    const parsed = parseSlashCommand('/cmd foo bar baz')!
    const result = resolveTemplate('$1 + $2 = $ARGUMENTS', parsed)
    expect(result).toBe('foo + bar = foo bar baz')
  })

  it('handles template with no placeholders', () => {
    const parsed = parseSlashCommand('/help')!
    const result = resolveTemplate('Show help information', parsed)
    expect(result).toBe('Show help information')
  })

  it('handles empty args with $ARGUMENTS', () => {
    const parsed = parseSlashCommand('/help')!
    const result = resolveTemplate('Help: $ARGUMENTS', parsed)
    expect(result).toBe('Help: ')
  })
})

describe('isModelAvailable', () => {
  it('TC-C3.8: returns false for unavailable model', () => {
    expect(isModelAvailable('nonexistent-model', ['gpt-4', 'claude-3'])).toBe(
      false,
    )
  })

  it('TC-C3.7: returns true for available model', () => {
    expect(isModelAvailable('gpt-4', ['gpt-4', 'claude-3'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isModelAvailable('GPT-4', ['gpt-4'])).toBe(true)
  })

  it('returns false for undefined model', () => {
    expect(isModelAvailable(undefined, ['gpt-4'])).toBe(false)
  })

  it('returns false for empty model', () => {
    expect(isModelAvailable('', ['gpt-4'])).toBe(false)
  })
})

describe('BUILTIN_COMMAND_NAMES', () => {
  it('contains expected built-in commands', () => {
    expect(BUILTIN_COMMAND_NAMES.has('clear')).toBe(true)
    expect(BUILTIN_COMMAND_NAMES.has('compact')).toBe(true)
    expect(BUILTIN_COMMAND_NAMES.has('reset')).toBe(true)
    expect(BUILTIN_COMMAND_NAMES.has('help')).toBe(true)
  })
})
