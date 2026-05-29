/**
 * Sidepanel origin-tab guard for close_page and navigate_page.
 *
 * Extends the existing newtab-only guard to also protect the sidepanel
 * active tab. In sidepanel mode, the active tab is the origin tab —
 * closing/navigating it disrupts the user's workflow.
 *
 * For navigate_page: only URL navigation is blocked on the origin tab.
 * Back/forward/reload are safe (don't destroy the chat UI).
 *
 * Unit tests using a mocked Browser.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, PageInfo } from '../../src/browser/browser'
import { executeTool } from '../../src/tools/framework'
import { close_page, navigate_page, new_page } from '../../src/tools/navigation'

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
    url: 'https://example.com',
    title: 'Test Page',
    isActive: false,
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
  let gotoCalled = false
  let goBackCalled = false
  let goForwardCalled = false
  let reloadCalled = false
  let newPageCalled = false

  const browser = {
    listPages: async () => pages,
    closePage: async () => {
      closePageCalled = true
    },
    goto: async () => {
      gotoCalled = true
    },
    goBack: async () => {
      goBackCalled = true
    },
    goForward: async () => {
      goForwardCalled = true
    },
    reload: async () => {
      reloadCalled = true
    },
    newPage: async () => {
      newPageCalled = true
      return 999
    },
    getTabIdForPage: () => 1,
  } as unknown as Browser

  return {
    browser,
    wasClosePageCalled: () => closePageCalled,
    wasGotoCalled: () => gotoCalled,
    wasGoBackCalled: () => goBackCalled,
    wasGoForwardCalled: () => goForwardCalled,
    wasReloadCalled: () => reloadCalled,
    wasNewPageCalled: () => newPageCalled,
  }
}

function makeSidepanelSession(originPageId: number) {
  return { origin: 'sidepanel' as const, originPageId }
}

function makeNewtabSession(originPageId: number) {
  return { origin: 'newtab' as const, originPageId }
}

// ── close_page tests ──

describe('close_page sidepanel origin-tab guard', () => {
  it('rejects closing the sidepanel origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeTool(
      close_page,
      { page: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error for sidepanel origin tab')
    assert.ok(
      textOf(result).includes('Cannot close the origin tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(!wasClosePageCalled(), 'closePage should NOT have been called')
  })

  it('allows closing non-origin tab in sidepanel mode', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
      makePage({ pageId: 3 }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeTool(
      close_page,
      { page: 2 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasClosePageCalled(), 'closePage should have been called')
  })

  it('does not block when originPageId is undefined (MCP)', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasClosePageCalled } = createMockBrowser(pages)

    const result = await executeTool(
      close_page,
      { page: 1 },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { origin: 'sidepanel' },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success (no originPageId), got error: ${textOf(result)}`,
    )
    assert.ok(wasClosePageCalled(), 'closePage should have been called')
  })
})

// ── navigate_page tests ──

describe('navigate_page sidepanel origin-tab guard', () => {
  it('rejects URL navigation on sidepanel origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasGotoCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'url', url: 'https://evil.com' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error for URL navigation on origin tab')
    assert.ok(
      textOf(result).includes('Cannot navigate the origin tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(!wasGotoCalled(), 'goto should NOT have been called')
  })

  it('allows back navigation on sidepanel origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasGoBackCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'back' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasGoBackCalled(), 'goBack should have been called')
  })

  it('allows forward navigation on sidepanel origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasGoForwardCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'forward' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasGoForwardCalled(), 'goForward should have been called')
  })

  it('allows reload on sidepanel origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasReloadCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'reload' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasReloadCalled(), 'reload should have been called')
  })

  it('allows URL navigation on non-origin tab in sidepanel mode', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
      makePage({ pageId: 3 }),
    ]
    const { browser, wasGotoCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 2, action: 'url', url: 'https://example.com' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasGotoCalled(), 'goto should have been called')
  })

  it('also narrows newtab guard to URL-only (back allowed)', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser, wasGoBackCalled } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'back' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeNewtabSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success (back is safe), got error: ${textOf(result)}`,
    )
    assert.ok(wasGoBackCalled(), 'goBack should have been called')
  })

  it('still rejects URL navigation on newtab origin tab', async () => {
    const pages = [
      makePage({ pageId: 1 }),
      makePage({ pageId: 2 }),
    ]
    const { browser } = createMockBrowser(pages)

    const result = await executeTool(
      navigate_page,
      { page: 1, action: 'url', url: 'https://evil.com' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeNewtabSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error for newtab URL navigation')
    assert.ok(
      textOf(result).includes('Cannot navigate the origin tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
  })
})

// ── new_page sanity check ──

describe('new_page not affected by origin-tab guard', () => {
  it('new_page works in sidepanel mode', async () => {
    const pages = [makePage({ pageId: 1 })]
    const { browser, wasNewPageCalled } = createMockBrowser(pages)

    const result = await executeTool(
      new_page,
      { url: 'https://example.com' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: makeSidepanelSession(1),
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasNewPageCalled(), 'newPage should have been called')
  })
})
