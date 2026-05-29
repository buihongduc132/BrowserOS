/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for T11: Wire TabOwnershipRegistry to glow dispatch.
 * Verifies that executeTool() enriches tool result metadata with
 * ownership data (lockHeld, controlledBy) from the registry.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
import { defineTool, executeTool, type ToolContext } from '../../src/tools/framework'
import type { Browser } from '../../src/browser/browser'

function createMockBrowser(tabOwnership: TabOwnershipRegistry): Browser {
  return {
    tabOwnership,
    getTabIdForPage: (_pageId: number) => 42,
  } as unknown as Browser
}

function createCtx(browser: Browser, session?: ToolContext['session']): ToolContext {
  return {
    browser,
    directories: {},
    session,
  }
}

describe('executeTool ownership metadata enrichment (T11)', () => {
  const registry = new TabOwnershipRegistry()

  const dummyTool = defineTool({
    name: 'test_tool',
    description: 'Test tool for metadata enrichment',
    input: z.object({ page: z.number() }),
    handler: async (_args, _ctx, response) => {
      response.text('ok')
    },
  })

  it('enriches metadata with lockHeld=true when page is owned', async () => {
    registry.claim('conv-1', 10, 'agent-1')

    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'sidepanel',
      conversationId: 'conv-2',
    })

    const result = await executeTool(dummyTool, { page: 10 }, ctx, new AbortController().signal)

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.lockHeld).toBe(true)
    expect(result.metadata?.controlledBy).toEqual({
      conversationId: 'conv-1',
      agentId: 'agent-1',
    })
    expect(result.metadata?.tabId).toBe(42)

    // cleanup
    registry.release('conv-1', 10)
  })

  it('sets lockHeld to true when auto-claimed by calling conversation', async () => {
    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'sidepanel',
      conversationId: 'conv-1',
    })

    const result = await executeTool(dummyTool, { page: 99 }, ctx, new AbortController().signal)

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.tabId).toBe(42)
    // enforceOwnership auto-claims for conv-1, so metadata reflects that ownership
    expect(result.metadata?.lockHeld).toBe(true)
    expect(result.metadata?.controlledBy?.conversationId).toBe('conv-1')

    // cleanup
    registry.release('conv-1', 99)
  })

  it('no lockHeld when no session context (MCP legacy)', async () => {
    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser) // no session

    const result = await executeTool(dummyTool, { page: 88 }, ctx, new AbortController().signal)

    expect(result.metadata).toBeDefined()
    expect(result.metadata?.tabId).toBe(42)
    // No session → no auto-claim → no lockHeld
    expect(result.metadata?.lockHeld).toBeUndefined()
    expect(result.metadata?.controlledBy).toBeUndefined()
  })

  it('includes agentId in controlledBy when owner has an agentId', async () => {
    registry.claim('conv-a', 20, 'my-agent')

    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'mcp',
      conversationId: 'conv-b',
    })

    const result = await executeTool(dummyTool, { page: 20 }, ctx, new AbortController().signal)

    expect(result.metadata?.lockHeld).toBe(true)
    expect(result.metadata?.controlledBy?.agentId).toBe('my-agent')
    expect(result.metadata?.controlledBy?.conversationId).toBe('conv-a')

    registry.release('conv-a', 20)
  })

  it('controlledBy has undefined agentId when owner has no agentId', async () => {
    registry.claim('conv-x', 30)

    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'sidepanel',
      conversationId: 'conv-y',
    })

    const result = await executeTool(dummyTool, { page: 30 }, ctx, new AbortController().signal)

    expect(result.metadata?.lockHeld).toBe(true)
    expect(result.metadata?.controlledBy?.conversationId).toBe('conv-x')
    expect(result.metadata?.controlledBy?.agentId).toBeUndefined()

    registry.release('conv-x', 30)
  })

  it('no metadata enrichment when tool has no page param', async () => {
    const noPageTool = defineTool({
      name: 'no_page_tool',
      description: 'Tool without page param',
      input: z.object({ query: z.string() }),
      handler: async (_args, _ctx, response) => {
        response.text('done')
      },
    })

    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'sidepanel',
      conversationId: 'conv-1',
    })

    const result = await executeTool(noPageTool, { query: 'test' }, ctx, new AbortController().signal)

    expect(result.metadata).toBeUndefined()
  })

  it('metadata reflects current ownership state (not stale)', async () => {
    registry.claim('conv-1', 40, 'agent-1')

    const browser = createMockBrowser(registry)
    const ctx = createCtx(browser, {
      origin: 'sidepanel',
      conversationId: 'conv-2',
    })

    // First call: owned by conv-1, conv-2 gets warning (non-strict)
    const result1 = await executeTool(dummyTool, { page: 40 }, ctx, new AbortController().signal)
    expect(result1.metadata?.lockHeld).toBe(true)
    expect(result1.metadata?.controlledBy?.conversationId).toBe('conv-1')

    // Release conv-1 ownership → conv-2 auto-claims on next call
    registry.release('conv-1', 40)

    // Second call: now auto-claimed by conv-2
    const result2 = await executeTool(dummyTool, { page: 40 }, ctx, new AbortController().signal)
    expect(result2.metadata?.lockHeld).toBe(true)
    expect(result2.metadata?.controlledBy?.conversationId).toBe('conv-2')

    // cleanup
    registry.release('conv-2', 40)
  })
})
