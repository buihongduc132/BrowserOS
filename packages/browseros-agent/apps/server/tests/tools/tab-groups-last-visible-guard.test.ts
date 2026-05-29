/**
 * Last-visible-tab guard for close_tab_group.
 *
 * close_tab_group bypasses close_page entirely — it calls CDP closeTabGroup
 * which closes all tabs in the group at Chromium level. Must check if closing
 * the group would leave 0 visible tabs.
 *
 * Unit tests using a mocked Browser.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, PageInfo } from '../../src/browser/browser'
import { executeTool } from '../../src/tools/framework'
import { close_tab_group } from '../../src/tools/tab-groups'

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

function createMockBrowser(
  pages: PageInfo[],
  groupPageIds: number[],
) {
  let closeTabGroupCalled = false
  const browser = {
    listPages: async () => pages,
    listTabGroups: async () => [
      {
        groupId: 'group-1',
        windowId: 1,
        title: 'Test Group',
        color: 'blue',
        collapsed: false,
        pageIds: groupPageIds,
      },
    ],
    closeTabGroup: async () => {
      closeTabGroupCalled = true
    },
    resolveTabIds: async () => new Map(),
  } as unknown as Browser

  return {
    browser,
    wasCloseTabGroupCalled: () => closeTabGroupCalled,
  }
}

// ── Tests ──

describe('close_tab_group last-visible-tab guard', () => {
  it('rejects if closing the group would leave 0 visible tabs', async () => {
    const pages = [makePage({ pageId: 1, groupId: 'group-1' })]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error when closing last visible tabs')
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasCloseTabGroupCalled(),
      'closeTabGroup should NOT have been called',
    )
  })

  it('allows closing group when other visible tabs exist outside group', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2 }), // outside group
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasCloseTabGroupCalled(),
      'closeTabGroup should have been called',
    )
  })

  it('rejects if group contains all visible tabs (some hidden exist)', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2, isHidden: true }),
    ]
    const { browser } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      result.isError,
      'Expected error — hidden tabs do not count as visible',
    )
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('allows closing group when group has hidden tabs and visible tabs exist outside', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1', isHidden: true }),
      makePage({ pageId: 2 }), // visible, outside group
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasCloseTabGroupCalled(),
      'closeTabGroup should have been called',
    )
  })

  it('rejects if group contains multiple visible tabs that are the only visible tabs', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2, groupId: 'group-1' }),
      makePage({ pageId: 3, isHidden: true }),
    ]
    const { browser } = createMockBrowser(pages, [1, 2])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      result.isError,
      'Expected error — group contains all visible tabs',
    )
    assert.ok(
      textOf(result).includes('Cannot close the last visible tab'),
      `Expected last-visible-tab error, got: ${textOf(result)}`,
    )
  })

  it('allows closing group when group has multiple visible tabs but others exist outside', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2, groupId: 'group-1' }),
      makePage({ pageId: 3 }), // visible, outside group
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(
      pages,
      [1, 2],
    )

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasCloseTabGroupCalled(),
      'closeTabGroup should have been called',
    )
  })
})
