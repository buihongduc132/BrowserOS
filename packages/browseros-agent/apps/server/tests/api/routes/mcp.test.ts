/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * TDD tests for MCP route spec compliance.
 *
 * Covers the MCP Streamable HTTP transport spec requirements:
 * - Server MUST provide endpoint supporting both POST and GET
 * - Client MAY issue GET with Accept: text/event-stream → server MUST
 *   return text/event-stream OR 405 Method Not Allowed
 * - Server MUST NOT return 200 + application/json when client expects SSE
 *
 * Regression guard for PR #490 (bde80fed) which broke SSE GET by
 * splitting .all('/') into separate .get() + .post() handlers.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createMcpRoutes } from '../../../src/api/routes/mcp'
import { ToolRegistry } from '../../../src/tools/tool-registry'
import type { Env } from '../../../src/api/types'

// ── Minimal mocks ──

function mockPolicyService() {
  return { getEnabledRules: () => [] } as any
}

function mockDeps() {
  return {
    version: 'test',
    registry: new ToolRegistry([]),
    browser: {} as any,
    executionDir: tmpdir(),
    resourcesDir: tmpdir(),
    policyService: mockPolicyService(),
  }
}

let tempDir: string
let originalBrowserosDir: string | undefined

function createApp() {
  return new Hono<Env>().route('/mcp', createMcpRoutes(mockDeps()))
}

beforeEach(() => {
  originalBrowserosDir = process.env.BROWSEROS_DIR
  tempDir = join(
    tmpdir(),
    `browseros-mcp-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(tempDir, { recursive: true })
  process.env.BROWSEROS_DIR = tempDir
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  if (originalBrowserosDir === undefined) {
    delete process.env.BROWSEROS_DIR
  } else {
    process.env.BROWSEROS_DIR = originalBrowserosDir
  }
})

// ── GET /mcp (health check — no SSE) ──

describe('GET /mcp (health check)', () => {
  test('TC-MCP1: returns 200 JSON when no Accept: text/event-stream', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/mcp')

    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
  })

  test('TC-MCP2: response body has { status: "ok", message: string }', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/mcp')
    const body = await res.json()

    expect(body.status).toBe('ok')
    expect(typeof body.message).toBe('string')
    expect(body.message.length).toBeGreaterThan(0)
  })
})

// ── GET /mcp (SSE — spec compliance) ──

describe('GET /mcp (SSE stream — MCP spec compliance)', () => {
  test('TC-MCP3: with Accept: text/event-stream returns SSE content type', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/mcp', {
      headers: { Accept: 'text/event-stream' },
    })

    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('text/event-stream')
  })

  test('TC-MCP4: REGRESSION — SSE request MUST NOT return application/json', async () => {
    // PR #490 (bde80fed) broke this by returning static JSON from GET handler
    // before the transport could handle SSE. The spec says server MUST return
    // text/event-stream or 405 — never 200 + application/json for SSE clients.
    const app = createApp()
    const res = await app.request('http://localhost/mcp', {
      headers: { Accept: 'text/event-stream' },
    })

    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).not.toContain('application/json')
  })

  test('TC-MCP5: SSE endpoint returns 200 (not 405)', async () => {
    // Spec allows 405 if server doesn't support SSE streams.
    // Since we DO support SSE, we must return 200, not 405.
    const app = createApp()
    const res = await app.request('http://localhost/mcp', {
      headers: { Accept: 'text/event-stream' },
    })

    expect(res.status).toBe(200)
  })
})

// ── POST /mcp ──

describe('POST /mcp', () => {
  test('TC-MCP6: valid JSON-RPC initialize returns 200', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    })

    // Either JSON response or SSE stream — both are valid per spec
    expect(res.status).toBe(200)
  })

  test('TC-MCP7: initialize response contains server info', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    })

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = await res.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.result).toBeDefined()
      expect(body.result.serverInfo).toBeDefined()
    } else if (contentType.includes('text/event-stream')) {
      // SSE stream — read first event
      const text = await res.text()
      expect(text.length).toBeGreaterThan(0)
    }
  })
})

// ── Spec structural guard ──

describe('MCP spec structural requirements', () => {
  test('TC-MCP8: GET and POST share the same endpoint path', async () => {
    // Spec: "The server MUST provide a single HTTP endpoint path that
    // supports both POST and GET methods."
    const app = createApp()

    const getRes = await app.request('http://localhost/mcp')
    expect(getRes.status).toBe(200)

    const postRes = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    })
    expect(postRes.status).toBe(200)
  })
})
