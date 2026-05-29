/**
 * Tests for close_window ownership enforcement (verifier BUG 1+2 fix).
 *
 * BUG 1: close_window leaks ownership locks for pages in the closed window.
 * BUG 2: close_window bypasses ownership enforcement in strict mode.
 *
 * Unit tests using a mocked Browser + TabOwnershipRegistry.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, PageInfo, WindowInfo } from '../../src/browser/browser'
import { TabOwnershipRegistry } from '../../src/browser/tab-ownership-registry'
import { executeTool } from '../../src/tools/framework'
import { close_window } from '../../src/tools/windows'

// ── Helpers ──

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function makeWindow(
  overrides: Partial<WindowInfo> & { windowId: number },
): WindowInfo {
  return {
    windowType: 'normal',
    bounds: {},
    isActive: false,
    isVisible: true,
    tabCount: 1,
    ...overrides,
  }
}

function makePage(
  overrides: Partial<PageInfo> & { pageId: number },
): PageInfo {
  return {
    pageId: overrides.pageId,
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Test',
    isHidden: overrides.isHidden ?? false,
    windowId: overrides.windowId ?? 1,
  }
}

function createMockBrowserWithOwnership(
  windows: WindowInfo[],
  pages: PageInfo[],
) {
  const tabOwnership = new TabOwnershipRegistry()
  let closeWindowCalled = false
  const closedWindowIds: number[] = []

  const browser = {
    listWindows: async () => windows,
    listPages: async () => pages,
    closeWindow: async (windowId: number) => {
      closeWindowCalled = true
      closedWindowIds.push(windowId)
    },
    getTabIdForPage: () => undefined,
  } as unknown as Browser

  // Attach the registry directly
  Object.defineProperty(browser, 'tabOwnership', {
    value: tabOwnership,
    writable: false,
    configurable: true,
  })

  return {
    browser,
    tabOwnership,
    wasCloseWindowCalled: () => closeWindowCalled,
    getClosedWindowIds: () => closedWindowIds,
  }
}

// ── Tests ──

describe('close_window ownership enforcement', () => {
  it('releases ownership locks for pages in the closed window', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 11, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, tabOwnership } = createMockBrowserWithOwnership(
      windows,
      pages,
    )

    // Simulate conversation A owning page 10 in window 1
    tabOwnership.claim('conv-A', 10, 'agent-A')

    // Close window 1 (conv-B)
    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-B' },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(!result.isError, `Expected success, got: ${textOf(result)}`)

    // Lock for page 10 should be released since window 1 was closed
    assert.ok(
      !tabOwnership.isLocked(10),
      'Lock for page 10 should be released after window close',
    )
    // Page 11 was never locked — no issue
    assert.ok(
      !tabOwnership.isLocked(11),
      'Page 11 should remain unlocked',
    )
    // Page 20 in window 2 should not be affected
    assert.ok(
      !tabOwnership.isLocked(20),
      'Page 20 should remain unlocked',
    )
  })

  it('releases multiple ownership locks in the closed window', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 11, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, tabOwnership } = createMockBrowserWithOwnership(
      windows,
      pages,
    )

    // Two conversations own pages in window 1
    tabOwnership.claim('conv-A', 10, 'agent-A')
    tabOwnership.claim('conv-B', 11, 'agent-B')
    // Also one in window 2
    tabOwnership.claim('conv-C', 20, 'agent-C')

    await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-D' },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !tabOwnership.isLocked(10),
      'Lock for page 10 should be released',
    )
    assert.ok(
      !tabOwnership.isLocked(11),
      'Lock for page 11 should be released',
    )
    assert.ok(
      tabOwnership.isLocked(20),
      'Lock for page 20 in window 2 should remain',
    )
  })

  it('rejects in strict mode when window contains foreign-owned pages', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, tabOwnership } = createMockBrowserWithOwnership(
      windows,
      pages,
    )

    // conv-A owns page 10 in window 1
    tabOwnership.claim('conv-A', 10, 'agent-A')

    // conv-B tries to close window 1 in strict mode
    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-B' },
        strictOwnership: true,
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error in strict mode')
    assert.ok(
      textOf(result).includes('locked by conversation'),
      `Expected ownership error mentioning lock, got: ${textOf(result)}`,
    )
    assert.ok(
      textOf(result).includes('conv-A'),
      `Expected ownership error mentioning conv-A, got: ${textOf(result)}`,
    )
    // Window should NOT have been closed
    assert.ok(
      !result.content.some(
        (c) => c.type === 'text' && c.text?.includes('Closed window'),
      ),
      'Window should not have been closed',
    )
  })

  it('allows closing window in strict mode when all pages are self-owned', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, tabOwnership } = createMockBrowserWithOwnership(
      windows,
      pages,
    )

    // conv-B owns page 10 — same conversation closing the window
    tabOwnership.claim('conv-B', 10, 'agent-B')

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-B' },
        strictOwnership: true,
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success when self-owned, got: ${textOf(result)}`,
    )
  })

  it('allows closing window in strict mode when no pages are locked', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser } = createMockBrowserWithOwnership(windows, pages)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-B' },
        strictOwnership: true,
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success when no locks, got: ${textOf(result)}`,
    )
  })

  it('warns in non-strict mode when window contains foreign-owned pages', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, tabOwnership } = createMockBrowserWithOwnership(
      windows,
      pages,
    )

    // conv-A owns page 10 in window 1
    tabOwnership.claim('conv-A', 10, 'agent-A')

    // conv-B closes window 1 in non-strict mode — should warn but succeed
    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-B' },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success in non-strict mode, got: ${textOf(result)}`,
    )
    assert.ok(
      textOf(result).includes('conv-A'),
      `Expected warning about conv-A, got: ${textOf(result)}`,
    )
  })
})
