/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for command CRUD service and command resolution.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  parseCommandInput,
  resolveCommand,
  resolveTemplate,
  slugify,
  updateCommand,
} from '../../src/commands/service'

// Use a temp dir for test isolation
const TEST_DIR = join(tmpdir(), `browseros-cmd-test-${Date.now()}`)

// Override getCommandsDir for testing via env
const originalDir = process.env.BROWSEROS_DIR

beforeEach(() => {
  process.env.BROWSEROS_DIR = TEST_DIR
})

afterEach(async () => {
  process.env.BROWSEROS_DIR = originalDir
  await rm(TEST_DIR, { recursive: true }).catch(() => {})
})

// ─── Suite 3: Command CRUD Service ─────────────────────────

describe('createCommand', () => {
  it('TC-S3.1: creates custom command', async () => {
    const cmd = await createCommand({
      name: 'analyze',
      description: 'Analyze code',
      content: 'Analyze the code thoroughly.',
    })
    expect(cmd.id).toBe('analyze')
    expect(cmd.name).toBe('/analyze')
    expect(cmd.description).toBe('Analyze code')
    expect(cmd.builtIn).toBe(false)
    expect(cmd.enabled).toBe(true)
  })

  it('TC-S3.2: duplicate name rejects', async () => {
    await createCommand({
      name: 'analyze',
      description: 'First',
      content: 'Content 1',
    })
    await expect(
      createCommand({
        name: 'analyze',
        description: 'Second',
        content: 'Content 2',
      }),
    ).rejects.toThrow('already exists')
  })

  it('TC-S3.3: custom command shadows built-in (can create)', async () => {
    // Built-in "help" exists — creating custom "help" should succeed (shadows)
    const cmd = await createCommand({
      name: 'help',
      description: 'Custom help',
      content: 'Custom help content.',
    })
    expect(cmd.id).toBe('help')
  })
})

describe('updateCommand', () => {
  it('TC-S3.4: update preserves file', async () => {
    await createCommand({
      name: 'analyze',
      description: 'Original',
      content: 'Original content.',
    })
    const updated = await updateCommand('analyze', {
      description: 'New desc',
    })
    expect(updated.description).toBe('New desc')

    // Verify content preserved
    const detail = await getCommand('analyze')
    expect(detail?.content).toBe('Original content.')
  })

  it('rejects update of built-in command', async () => {
    await expect(
      updateCommand('clear', { description: 'Hacked' }),
    ).rejects.toThrow('built-in')
  })

  it('persist enabled: false and read it back', async () => {
    await createCommand({
      name: 'toggle-test',
      description: 'Toggle test',
      content: 'Content.',
    })
    // Disable the command
    const updated = await updateCommand('toggle-test', { enabled: false })
    expect(updated.enabled).toBe(false)

    // Re-read from disk to verify persistence
    const detail = await getCommand('toggle-test')
    expect(detail?.enabled).toBe(false)
  })

  it('re-enable a previously disabled command', async () => {
    await createCommand({
      name: 'reenable-test',
      description: 'Reenable test',
      content: 'Content.',
    })
    await updateCommand('reenable-test', { enabled: false })
    const updated = await updateCommand('reenable-test', { enabled: true })
    expect(updated.enabled).toBe(true)

    const detail = await getCommand('reenable-test')
    expect(detail?.enabled).toBe(true)
  })

  it('update with other fields preserves existing enabled: false state', async () => {
    await createCommand({
      name: 'preserve-test',
      description: 'Original',
      content: 'Content.',
    })
    // Disable first
    await updateCommand('preserve-test', { enabled: false })

    // Update description only — enabled should remain false
    const updated = await updateCommand('preserve-test', {
      description: 'Updated desc',
    })
    expect(updated.description).toBe('Updated desc')
    expect(updated.enabled).toBe(false)

    const detail = await getCommand('preserve-test')
    expect(detail?.enabled).toBe(false)
  })
})

describe('createCommand enabled default', () => {
  it('returns enabled: true by default for new commands', async () => {
    const cmd = await createCommand({
      name: 'default-enabled',
      description: 'Test',
      content: 'Content.',
    })
    expect(cmd.enabled).toBe(true)

    // Also verify getCommand returns true
    const detail = await getCommand('default-enabled')
    expect(detail?.enabled).toBe(true)
  })
})

describe('deleteCommand', () => {
  it('TC-S3.5: delete built-in rejects', async () => {
    await expect(deleteCommand('clear')).rejects.toThrow('built-in')
  })

  it('TC-S3.6: delete custom command', async () => {
    await createCommand({
      name: 'analyze',
      description: 'Analyze',
      content: 'Content.',
    })
    await deleteCommand('analyze')
    const detail = await getCommand('analyze')
    // After deleting custom, built-in may still be found or null
    // "analyze" is not a built-in, so should be null
    expect(detail).toBeNull()
  })
})

// ─── Suite 5: External Directory Loading ───────────────────

describe('listCommands with external dirs', () => {
  it('TC-S5.2: invalid .md files skipped (no crash)', async () => {
    // Create a broken .md file in commands dir
    const dir = join(TEST_DIR, 'commands')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken.md'), 'not valid yaml ---')
    await writeFile(
      join(dir, 'good.md'),
      '---\ndescription: Good command\n---\nDo good things.',
    )
    const commands = await listCommands()
    // Should include built-in + "good" command, skip broken
    const goodCmd = commands.find((c) => c.id === 'good')
    expect(goodCmd).toBeDefined()
    expect(goodCmd?.description).toBe('Good command')
  })

  it('TC-S5.3: non-existent dir skipped (built-ins still load)', async () => {
    // BROWSEROS_DIR points to empty temp — commands dir doesn't exist
    const commands = await listCommands()
    // Should still have built-in commands
    const names = commands.map((c) => c.name)
    expect(names).toContain('/clear')
    expect(names).toContain('/compact')
  })

  it('TC-S5.4: user dir command overrides built-in', async () => {
    // Create custom "help" command in user dir
    await createCommand({
      name: 'help',
      description: 'Custom help override',
      content: 'Custom help.',
    })
    const commands = await listCommands()
    // Should have exactly one "help" — the custom one (not built-in + custom)
    const helpCmds = commands.filter((c) => c.id === 'help')
    expect(helpCmds.length).toBe(1)
    expect(helpCmds[0].description).toBe('Custom help override')
    expect(helpCmds[0].builtIn).toBe(false)
  })
})

// ─── Suite 6: Command Resolution ───────────────────────────

describe('parseCommandInput', () => {
  it('TC-S6.1: parse /command with args', () => {
    const result = parseCommandInput('/analyze Button.tsx')
    expect(result).toEqual({ commandName: 'analyze', args: 'Button.tsx' })
  })

  it('TC-S6.2: parse /command with no args', () => {
    const result = parseCommandInput('/clear')
    expect(result).toEqual({ commandName: 'clear', args: '' })
  })

  it('TC-S6.3: non-command input passes through', () => {
    const result = parseCommandInput('Hello world')
    expect(result).toBeNull()
  })

  it('TC-S6.4: URL-like input not treated as command', () => {
    const result = parseCommandInput('https://example.com')
    expect(result).toBeNull()
  })

  it('parses command with hyphens', () => {
    const result = parseCommandInput('/deep-research AI trends')
    expect(result).toEqual({
      commandName: 'deep-research',
      args: 'AI trends',
    })
  })

  it('parses command with underscores', () => {
    const result = parseCommandInput('/my_command arg1')
    expect(result).toEqual({ commandName: 'my_command', args: 'arg1' })
  })

  it('returns null for just slash', () => {
    const result = parseCommandInput('/')
    expect(result).toBeNull()
  })
})

describe('resolveTemplate', () => {
  it('TC-S6.5: $ARGUMENTS placeholder resolved', () => {
    const result = resolveTemplate('Analyze $ARGUMENTS in detail', 'Button.tsx')
    expect(result).toBe('Analyze Button.tsx in detail')
  })

  it('TC-S6.6: positional args resolved', () => {
    const result = resolveTemplate('Compare $1 with $2', 'Button.tsx Input.tsx')
    expect(result).toBe('Compare Button.tsx with Input.tsx')
  })

  it('TC-S6.7: !`cmd` NOT executed — literal text', () => {
    const result = resolveTemplate('Run !`npm test` and report', '')
    expect(result).toBe('Run !`npm test` and report')
  })

  it('resolves $ARGUMENTS with empty args', () => {
    const result = resolveTemplate('Hello $ARGUMENTS', '')
    expect(result).toBe('Hello ')
  })

  it('unmatched positional args left as-is', () => {
    const result = resolveTemplate('$1 and $2 and $3', 'one two')
    expect(result).toBe('one and two and $3')
  })
})

describe('resolveCommand', () => {
  it('TC-S6.8: model specified AND available → override', async () => {
    await createCommand({
      name: 'analyze',
      description: 'Analyze',
      content: 'Analyze $ARGUMENTS',
      model: 'gpt-4',
    })
    const result = await resolveCommand('analyze', 'Button.tsx', [
      'gpt-4',
      'claude-3',
    ])
    expect(result.resolvedTemplate).toBe('Analyze Button.tsx')
    expect(result.modelOverride).toBe('gpt-4')
  })

  it('TC-S6.9: model specified but NOT available → fallback to current', async () => {
    await createCommand({
      name: 'analyze2',
      description: 'Analyze2',
      content: 'Analyze $ARGUMENTS',
      model: 'claude-opus-99',
    })
    const result = await resolveCommand('analyze2', 'Button.tsx', ['gpt-4'])
    expect(result.resolvedTemplate).toBe('Analyze Button.tsx')
    expect(result.modelOverride).toBeNull()
  })

  it('TC-S6.10: no model specified → no override', async () => {
    await createCommand({
      name: 'nomodel',
      description: 'No model',
      content: 'Do stuff.',
    })
    const result = await resolveCommand('nomodel', '', ['gpt-4'])
    expect(result.resolvedTemplate).toBe('Do stuff.')
    expect(result.modelOverride).toBeNull()
  })

  it('built-in command with no template passes args through', async () => {
    const result = await resolveCommand('clear', '')
    expect(result.resolvedTemplate).toBe('')
    expect(result.modelOverride).toBeNull()
  })
})

describe('slugify', () => {
  it('strips leading slashes', () => {
    expect(slugify('/clear')).toBe('clear')
  })

  it('lowercases', () => {
    expect(slugify('MyCommand')).toBe('mycommand')
  })

  it('replaces non-alphanumeric with hyphens', () => {
    expect(slugify('deep research')).toBe('deep-research')
  })

  it('empty result for special chars only', () => {
    expect(slugify('!!!')).toBe('')
  })
})
