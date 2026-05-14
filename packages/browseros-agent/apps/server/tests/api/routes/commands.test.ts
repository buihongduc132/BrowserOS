/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for /commands API routes.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createCommandsRoutes } from '../../../src/api/routes/commands'
import type { Env } from '../../../src/api/types'

let originalBrowserosDir: string | undefined
let tempBrowserosDir: string

function createApp() {
  return new Hono<Env>().route('/commands', createCommandsRoutes())
}

beforeEach(() => {
  originalBrowserosDir = process.env.BROWSEROS_DIR
  tempBrowserosDir = join(
    tmpdir(),
    `browseros-route-commands-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(tempBrowserosDir, { recursive: true })
  mkdirSync(join(tempBrowserosDir, 'commands'), { recursive: true })
  process.env.BROWSEROS_DIR = tempBrowserosDir
})

afterEach(() => {
  rmSync(tempBrowserosDir, { recursive: true, force: true })
  if (originalBrowserosDir === undefined) {
    delete process.env.BROWSEROS_DIR
  } else {
    process.env.BROWSEROS_DIR = originalBrowserosDir
  }
})

describe('GET /commands', () => {
  test('TC-S4.1: returns built-in commands', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.commands).toBeInstanceOf(Array)
    expect(body.commands.length).toBeGreaterThanOrEqual(6)

    const builtIn = body.commands.filter((c: any) => c.builtIn)
    expect(builtIn.length).toBe(6)
  })
})

describe('POST /commands', () => {
  test('TC-S4.2: creates custom command', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'foo',
        description: 'A test command',
        content: 'Do foo things.',
      }),
    })
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.command.id).toBe('foo')
    expect(body.command.name).toBe('/foo')
    expect(body.command.description).toBe('A test command')
  })

  test('TC-S4.3: rejects missing description', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'foo',
        content: 'Content.',
      }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects empty name', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        description: 'No name',
        content: 'Content.',
      }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /commands/:id', () => {
  test('TC-S4.4: returns built-in command detail', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands/clear')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.command.id).toBe('clear')
    expect(body.command.builtIn).toBe(true)
  })

  test('TC-S4.5: returns 404 for nonexistent', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands/nonexistent')
    expect(res.status).toBe(404)
  })

  test('returns custom command detail with content', async () => {
    const app = createApp()
    // Create first
    await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'analyze',
        description: 'Analyze code',
        content: 'Analyze the code thoroughly.',
      }),
    })
    const res = await app.request('http://localhost/commands/analyze')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.command.content).toBe('Analyze the code thoroughly.')
  })
})

describe('PUT /commands/:id', () => {
  test('TC-S4.6: updates custom command', async () => {
    const app = createApp()
    await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'analyze',
        description: 'Original',
        content: 'Original content.',
      }),
    })
    const res = await app.request('http://localhost/commands/analyze', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.command.description).toBe('Updated')
  })

  test('rejects update of built-in command', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands/clear', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Hacked' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /commands/:id', () => {
  test('TC-S4.7: deletes custom command', async () => {
    const app = createApp()
    await app.request('http://localhost/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'analyze',
        description: 'To delete',
        content: 'Content.',
      }),
    })
    const res = await app.request('http://localhost/commands/analyze', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('TC-S4.8: rejects delete of built-in command', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/commands/clear', {
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })
})
