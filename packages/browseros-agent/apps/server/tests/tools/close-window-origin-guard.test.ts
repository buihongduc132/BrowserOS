/**
 * Origin-tab guard for close_window.
 *
 * close_window rejects closing a window that contains the session's originPageId,
 * preventing the agent from destroying its own browser tab.
 *
 * Unit tests using a mocked Browser.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, PageInfo, WindowInfo } from '../../src/browser/browser'
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
    title: 'Test',
    isHidden: false,
    windowId: 1,
    ...overrides,
  }
}

function createMockBrowser(windows: WindowInfo[], pages: PageInfo[]) {
  let closeWindowCalled = false
  const browser = {
    listWindows: async () => windows,
    listPages: async () => pages,
    closeWindow: async () => {
      closeWindowCalled = true
    },
    getTabIdForPage: () => undefined,
  } as unknown as Browser
  return { browser, wasCloseWindowCalled: () => closeWindowCalled }
}

// ── Tests ──

describe('close_window origin-tab guard', () => {
  it('rejects closing window containing the origin tab', async () => {
    const windows = [makeWindow({ windowId: 1 }), makeWindow({ windowId: 2 })]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows, pages)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 10 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error')
    assert.ok(
      textOf(result).includes('active tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(!wasCloseWindowCalled(), 'closeWindow should NOT have been called')
  })

  it('allows closing window that does NOT contain the origin tab', async () => {
    const windows = [makeWindow({ windowId: 1 }), makeWindow({ windowId: 2 })]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows, pages)

    const result = await executeTool(
      close_window,
      { windowId: 2 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 10 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(!result.isError, `Expected success, got: ${textOf(result)}`)
    assert.ok(wasCloseWindowCalled(), 'closeWindow should have been called')
  })

  it('allows closing window when no session (MCP without originPageId)', async () => {
    const windows = [makeWindow({ windowId: 1 }), makeWindow({ windowId: 2 })]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows, pages)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success without session, got: ${textOf(result)}`,
    )
    assert.ok(wasCloseWindowCalled(), 'closeWindow should have been called')
  })

  it('rejects closing window containing origin tab even with other windows visible', async () => {
    const windows = [
      makeWindow({ windowId: 1 }),
      makeWindow({ windowId: 2 }),
      makeWindow({ windowId: 3 }),
    ]
    const pages = [
      makePage({ pageId: 10, windowId: 1 }),
      makePage({ pageId: 20, windowId: 2 }),
      makePage({ pageId: 30, windowId: 3 }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows, pages)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 10 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error even with other windows')
    assert.ok(
      textOf(result).includes('active tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(!wasCloseWindowCalled(), 'closeWindow should NOT have been called')
  })
})
