/**
 * T08: Enrich list_pages with ownership info.
 *
 * Tests that list_pages returns `controlledBy` per page:
 *   - null for unlocked pages
 *   - { conversationId, agentId } for locked pages
 *   - Works for MCP callers (no session) too
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import type { Browser } from '../../src/browser/browser'
import type { PageInfo } from '../../src/browser/browser'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
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
  } as unknown as Browser

  return { browser, registry }
}

function makeCtx(browser: Browser, opts?: { conversationId?: string; origin?: 'sidepanel' | 'newtab' }): ToolContext {
  return {
    browser,
    directories: { workingDir: process.cwd() },
    session: opts?.conversationId
      ? { origin: opts?.origin ?? 'sidepanel', conversationId: opts.conversationId }
      : undefined,
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

async function runListPages(ctx: ToolContext) {
  const response = new ToolResponse()
  await list_pages.handler({}, ctx, response)
  return response.toResult()
}

// ── Tests ──

describe('list_pages ownership enrichment', () => {
  let mockBrowser: Browser
  let registry: TabOwnershipRegistry

  beforeEach(() => {
    const result = createMockBrowser([
      makePage({ pageId: 1, title: 'Page 1' }),
      makePage({ pageId: 2, title: 'Page 2' }),
      makePage({ pageId: 3, title: 'Page 3' }),
    ])
    mockBrowser = result.browser
    registry = result.registry
  })

  it('should include controlledBy: null for all unlocked pages', async () => {
    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
    const result = await runListPages(ctx)

    expect(result.isError).toBeFalsy()
    const data = result.structuredContent as { pages: Array<{ controlledBy: unknown }> }
    expect(data.pages).toHaveLength(3)
    for (const page of data.pages) {
      expect(page.controlledBy).toBeNull()
    }
  })

  it('should include controlledBy with owner info for locked pages', async () => {
    registry.claim('conv-A', 2, 'agent-X')

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
    const result = await runListPages(ctx)

    expect(result.isError).toBeFalsy()
    const data = result.structuredContent as {
      pages: Array<{ pageId: number; controlledBy: { conversationId: string; agentId?: string } | null }>
    }

    const page2 = data.pages.find((p) => p.pageId === 2)
    expect(page2).toBeDefined()
    expect(page2!.controlledBy).toEqual({
      conversationId: 'conv-A',
      agentId: 'agent-X',
    })

    // Unlocked pages still null
    const page1 = data.pages.find((p) => p.pageId === 1)
    expect(page1!.controlledBy).toBeNull()
  })

  it('should include controlledBy without agentId when agentId not provided', async () => {
    registry.claim('conv-B', 1)

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
    const result = await runListPages(ctx)

    const data = result.structuredContent as {
      pages: Array<{ pageId: number; controlledBy: { conversationId: string; agentId?: string } | null }>
    }

    const page1 = data.pages.find((p) => p.pageId === 1)
    expect(page1!.controlledBy).toEqual({
      conversationId: 'conv-B',
      agentId: undefined,
    })
  })

  it('should work for MCP callers (no session)', async () => {
    registry.claim('conv-C', 3, 'agent-MCP')

    const ctx = makeCtx(mockBrowser) // no conversationId → no session
    const result = await runListPages(ctx)

    expect(result.isError).toBeFalsy()
    const data = result.structuredContent as {
      pages: Array<{ pageId: number; controlledBy: { conversationId: string } | null }>
    }

    const page3 = data.pages.find((p) => p.pageId === 3)
    expect(page3!.controlledBy).toEqual({
      conversationId: 'conv-C',
      agentId: 'agent-MCP',
    })
  })

  it('should include controlledBy in text output for locked pages', async () => {
    registry.claim('conv-D', 1, 'agent-Y')

    const ctx = makeCtx(mockBrowser, { conversationId: 'conv-1' })
    const result = await runListPages(ctx)

    const text = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')

    expect(text).toContain('🔒')
    expect(text).toContain('conv-D')
  })

  it('should return empty pages with no controlledBy field issues', async () => {
    const { browser } = createMockBrowser([])
    const ctx = makeCtx(browser, { conversationId: 'conv-1' })
    const result = await runListPages(ctx)

    expect(result.isError).toBeFalsy()
    const data = result.structuredContent as { pages: unknown[]; count: number }
    expect(data.pages).toHaveLength(0)
    expect(data.count).toBe(0)
  })
})
