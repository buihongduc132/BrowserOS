/**
 * T09: MCP lock_tab / unlock_tab tools.
 *
 * Explicit MCP tools for tab ownership management:
 *   - lock_tab: claims ownership of a page for the calling conversation
 *   - unlock_tab: releases ownership of a page
 *
 * Tests verify:
 *   - lock_tab claims ownership for the calling conversation
 *   - unlock_tab releases ownership
 *   - Cannot lock a page already owned by another conversation
 *   - Tools appear in registry (MCP tool list)
 *   - list_pages reflects lock state
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import type { Browser } from '../../src/browser/browser'
import type { PageInfo } from '../../src/browser/browser'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
import { lock_tab, unlock_tab } from '../../src/tools/navigation'
import { list_pages } from '../../src/tools/navigation'
import { ToolResponse } from '../../src/tools/response'
import type { ToolContext } from '../../src/tools/framework'

// ── Helpers ──

function createMockBrowser(pages: PageInfo[]): {
  browser: Browser
  registry: TabOwnershipRegistry
} {
  const registry = new TabOwnershipRegistry()
  const browser = {
    tabOwnership: registry,
    listPages: async () => pages,
    getPageInfo: (pageId: number) => pages.find((p) => p.pageId === pageId),
  } as unknown as Browser

  return { browser, registry }
}

function makeCtx(
  browser: Browser,
  opts?: { conversationId?: string; agentId?: string },
): ToolContext {
  return {
    browser,
    directories: { workingDir: process.cwd() },
    session: {
      origin: 'sidepanel',
      conversationId: opts?.conversationId ?? 'conv-1',
      agentId: opts?.agentId,
    },
  } as ToolContext
}

function makePage(overrides: Partial<PageInfo> & { pageId: number }): PageInfo {
  return {
    targetId: `target-${overrides.pageId}`,
    tabId: overrides.pageId * 10,
    url: 'https://example.com',
    title: 'Example',
    isActive: false,
    isLoading: false,
    loadProgress: 100,
    isPinned: false,
    isHidden: false,
    ...overrides,
  }
}

async function runTool(
  tool: typeof lock_tab | typeof unlock_tab,
  ctx: ToolContext,
  args: Record<string, unknown>,
) {
  const response = new ToolResponse()
  await tool.handler(args, ctx, response)
  return response.toResult()
}

// ── Tests ──

describe('lock_tab tool', () => {
  let mockBrowser: Browser
  let registry: TabOwnershipRegistry
  const pages = [makePage({ pageId: 1 }), makePage({ pageId: 2 })]

  beforeEach(() => {
    const result = createMockBrowser(pages)
    mockBrowser = result.browser
    registry = result.registry
  })

  it('should claim ownership for the calling conversation', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result = await runTool(lock_tab, ctx, { page: 1 })

    expect(result.isError).toBeFalsy()
    expect(registry.isLocked(1)).toBe(true)
    expect(registry.getOwner(1)?.ownerConversationId).toBe('conv-A')
  })

  it('should include agentId when available', async () => {
    const ctx = makeCtx(mockBrowser, {
      conversationId: 'conv-B',
      agentId: 'agent-1',
    })
    await runTool(lock_tab, ctx, { page: 2 })

    expect(registry.getOwner(2)?.ownerAgentId).toBe('agent-1')
  })

  it('should reject locking a page already owned by another conversation', async () => {
    registry.claim('conv-X', 1, 'agent-old')

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-Y' })
    const result = await runTool(lock_tab, ctx, { page: 1 })

    expect(result.isError).toBeTruthy()
    const text = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
    expect(text).toContain('conv-X')
  })

  it('should allow re-locking by the same conversation (idempotent)', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result1 = await runTool(lock_tab, ctx, { page: 1 })
    expect(result1.isError).toBeFalsy()

    const result2 = await runTool(lock_tab, ctx, { page: 1 })
    expect(result2.isError).toBeFalsy()
    expect(registry.isLocked(1)).toBe(true)
  })

  it('should error for non-existent page', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result = await runTool(lock_tab, ctx, { page: 999 })

    expect(result.isError).toBeTruthy()
  })
})

describe('unlock_tab tool', () => {
  let mockBrowser: Browser
  let registry: TabOwnershipRegistry
  const pages = [makePage({ pageId: 1 }), makePage({ pageId: 2 })]

  beforeEach(() => {
    const result = createMockBrowser(pages)
    mockBrowser = result.browser
    registry = result.registry
  })

  it('should release ownership for the owning conversation', async () => {
    registry.claim('conv-A', 1)

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result = await runTool(unlock_tab, ctx, { page: 1 })

    expect(result.isError).toBeFalsy()
    expect(registry.isLocked(1)).toBe(false)
  })

  it('should reject releasing a page owned by another conversation', async () => {
    registry.claim('conv-X', 1)

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-Y' })
    const result = await runTool(unlock_tab, ctx, { page: 1 })

    expect(result.isError).toBeTruthy()
    expect(registry.isLocked(1)).toBe(true) // still locked
  })

  it('should succeed for an unlocked page (idempotent)', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result = await runTool(unlock_tab, ctx, { page: 1 })

    expect(result.isError).toBeFalsy()
  })

  it('should error for non-existent page', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })
    const result = await runTool(unlock_tab, ctx, { page: 999 })

    expect(result.isError).toBeTruthy()
  })
})

describe('lock_tab / unlock_tab integration with list_pages', () => {
  let mockBrowser: Browser
  let registry: TabOwnershipRegistry
  const pages = [makePage({ pageId: 1 }), makePage({ pageId: 2 })]

  beforeEach(() => {
    const result = createMockBrowser(pages)
    mockBrowser = result.browser
    registry = result.registry
  })

  it('list_pages reflects lock state after lock_tab', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })

    // Lock page 1
    await runTool(lock_tab, ctx, { page: 1 })

    // list_pages should show page 1 as controlled
    const response = new ToolResponse()
    await list_pages.handler({}, ctx, response)
    const result = response.toResult()
    const data = result.structuredContent as {
      pages: Array<{
        pageId: number
        controlledBy: { conversationId: string } | null
      }>
    }

    const page1 = data.pages.find((p) => p.pageId === 1)
    expect(page1?.controlledBy?.conversationId).toBe('conv-A')

    const page2 = data.pages.find((p) => p.pageId === 2)
    expect(page2?.controlledBy).toBeNull()
  })

  it('list_pages reflects unlock after unlock_tab', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-A' })

    // Lock then unlock
    await runTool(lock_tab, ctx, { page: 1 })
    await runTool(unlock_tab, ctx, { page: 1 })

    // list_pages should show page 1 as unlocked
    const response = new ToolResponse()
    await list_pages.handler({}, ctx, response)
    const result = response.toResult()
    const data = result.structuredContent as {
      pages: Array<{
        pageId: number
        controlledBy: unknown
      }>
    }

    const page1 = data.pages.find((p) => p.pageId === 1)
    expect(page1?.controlledBy).toBeNull()
  })
})
