/**
 * Last-visible-tab guard for close_page.
 *
 * When only one visible tab remains, close_page must reject the request
 * because closing it would exit the browser. This applies to ALL session
 * modes (sidepanel, newtab, MCP/undefined).
 *
 * These are unit tests using a mocked Browser — no real browser needed.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, PageInfo } from '../../src/browser/browser'
import { executeTool } from '../../src/tools/framework'
import { close_page } from '../../src/tools/navigation'

// ── Helpers ──

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function makePage(
  overrides: Partial<PageInfo> & { pageId: number },
): PageInfo {
  return {
    targetId: `target-${overrides.pageId}`,
    tabId: overrides.pageId * 100,
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Test Page',
    isActive: overrides.isActive ?? false,
    isLoading: false,
    loadProgress: 100,
    isPinned: false,
    isHidden: false,
    windowId: 1,
    ...overrides,
  }
}

function createMockBrowser(pages: PageInfo[]) {
  let closePageCalled = false
  const browser = {
    listPages: async () => pages,
    closePage: async () => {
      closePageCalled = true
    },
    getTabIdForPage: () => 1,
  } as unknown as Browser

  return {
    browser,
    wasClosePageCalled: () => closePageCalled,
  }
}

async function executeClosePage(
  browser: Browser,
  pageId: number,
  session?: { origin: 'sidepanel' | 'newtab'; originPageId: number },
) {
  return executeTool(
    close_page,
    { page: pageId },
    {
      browser,
      directories: { workingDir: process.cwd() },
      ...(session && { session }),
    },
    AbortSignal.timeout(30_000),
  )
}

// ── Tests ──

describe('close_page last-visible-tab guard', () => {
  it('rejects closing the only visible tab', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(result.isError, 'Expected error when closing last visible tab')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasClosePageCalled(),
      'closePage should NOT have been called after guard rejection',
    )
  })

  it('allows closing one of multiple visible tabs', async () => {
    const pages = [makePage({ pageId: 1 }), makePage({ pageId: 2 })]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasClosePageCalled(),
      'closePage should have been called after guard passed',
    )
  })

  it('rejects closing the last visible tab when hidden tabs exist', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2, isHidden: true }),
    ]
    const { browser } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(
      result.isError,
      'Expected error — hidden tabs do not count as visible',
    )
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('allows closing a hidden tab when visible tabs remain', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2, isHidden: true }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 2)

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasClosePageCalled(), 'closePage should have been called')
  })

  it('allows closing a visible tab when other visible tabs remain in different windows', async () => {
    const pages = [
      makePage({ pageId: 1, windowId: 1 }),
      makePage({ pageId: 2, windowId: 2 }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasClosePageCalled(), 'closePage should have been called')
  })

  it('guard works when session is undefined (MCP mode)', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(result.isError, 'Expected error for MCP mode (no session)')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('guard works for sidepanel mode', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1, {
      origin: 'sidepanel',
      originPageId: 99,
    })

    assert.ok(result.isError, 'Expected error for sidepanel mode')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('guard works for newtab mode (closing non-origin last visible tab)', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser } = createMockBrowser(pages)

    // originPageId is 99 (different from 1), so newtab guard passes
    const result = await executeClosePage(browser, 1, {
      origin: 'newtab',
      originPageId: 99,
    })

    assert.ok(result.isError, 'Expected error for newtab mode')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('last-visible-tab guard takes priority over newtab guard when both apply', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser } = createMockBrowser(pages)

    // originPageId IS 1, so both guards would trigger
    // Last-visible-tab guard fires first (more critical)
    const result = await executeClosePage(browser, 1, {
      origin: 'newtab',
      originPageId: 1,
    })

    assert.ok(result.isError, 'Expected error')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error (not newtab error), got: ${textOf(result)}`,
    )
  })

  it('rejects closing a non-existent page ID without crashing', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    // Closing a page that doesn't exist in listPages
    const result = await executeClosePage(browser, 999)

    // Should either error (page not found) or the guard shouldn't block
    // because page 999 isn't in the visible list — page 1 is still there
    // The key invariant: guard only triggers if closing the target would leave 0 visible
    // Since page 999 isn't in the list, closing it doesn't affect visible count
    assert.ok(
      !textOf(result).includes('Cannot close the last visible tab'),
      `Last-visible-tab guard should NOT trigger for non-existent page`,
    )
  })

  it('guard still blocks when all pages have about:blank URLs', async () => {
    // Edge case: about:blank pages are still visible tabs
    const pages = [makePage({ pageId: 1, url: 'about:blank' })]
    const { browser } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(result.isError, 'Expected error — about:blank is still a visible tab')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('guard allows closing user tab when chrome-extension:// tab is also visible', async () => {
    // Edge case: chrome-extension:// pages are excluded from list_pages output
    // but count as visible tabs in the guard. If a chrome-extension:// tab
    // remains visible, closing the last user tab is allowed because the
    // browser still has a visible tab (extension page).
    const pages = [
      makePage({ pageId: 1, url: 'https://example.com' }),
      makePage({ pageId: 2, url: 'chrome-extension://abcdef/popup.html' }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(
      !result.isError,
      `Expected success (chrome-extension tab keeps browser alive), got: ${textOf(result)}`,
    )
    assert.ok(wasClosePageCalled(), 'closePage should have been called')
  })

  it('guard blocks closing when only chrome-extension:// tabs remain', async () => {
    // If ALL visible tabs are chrome-extension:// pages, closing the last
    // one should still be blocked — these are real tabs and closing all
    // of them would exit the browser.
    const pages = [
      makePage({ pageId: 1, url: 'chrome-extension://abcdef/popup.html' }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeClosePage(browser, 1)

    assert.ok(result.isError, 'Expected error — only chrome-extension tab')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
    assert.ok(!wasClosePageCalled(), 'closePage should NOT have been called')
  })

  it('newtab guard still works when multiple visible tabs exist', async () => {
    const pages = [makePage({ pageId: 1 }), makePage({ pageId: 2 })]
    const { browser } = createMockBrowser(pages)

    // Closing the origin tab when there are other visible tabs
    const result = await executeClosePage(browser, 1, {
      origin: 'newtab',
      originPageId: 1,
    })

    assert.ok(result.isError, 'Expected error')
    assert.ok(
      textOf(result).includes('Cannot close the origin tab'),
      `Expected newtab guard error, got: ${textOf(result)}`,
    )
  })
})
