/**
 * Origin-tab guard for close_tab_group.
 *
 * close_tab_group rejects closing a group that contains the session's originPageId,
 * preventing the agent from destroying its own browser tab.
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

function createMockBrowser(pages: PageInfo[], groupPageIds: number[]) {
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
  return { browser, wasCloseTabGroupCalled: () => closeTabGroupCalled }
}

// ── Tests ──

describe('close_tab_group origin-tab guard', () => {
  it('rejects closing group containing the origin tab', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2 }), // outside group
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 1 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error')
    assert.ok(
      textOf(result).includes('active tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasCloseTabGroupCalled(),
      'closeTabGroup should NOT have been called',
    )
  })

  it('allows closing group that does NOT contain the origin tab', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2 }), // origin tab, outside group
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 2 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(!result.isError, `Expected success, got: ${textOf(result)}`)
    assert.ok(
      wasCloseTabGroupCalled(),
      'closeTabGroup should have been called',
    )
  })

  it('allows closing group when no session (MCP)', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2 }),
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
      `Expected success without session, got: ${textOf(result)}`,
    )
    assert.ok(
      wasCloseTabGroupCalled(),
      'closeTabGroup should have been called',
    )
  })

  it('rejects closing group containing origin tab even with visible tabs outside', async () => {
    const pages = [
      makePage({ pageId: 1, groupId: 'group-1' }),
      makePage({ pageId: 2, groupId: 'group-1' }),
      makePage({ pageId: 3 }), // visible outside
    ]
    const { browser, wasCloseTabGroupCalled } = createMockBrowser(pages, [1, 2])

    const result = await executeTool(
      close_tab_group,
      { groupId: 'group-1' },
      {
        browser,
        directories: { workingDir: process.cwd() },
        session: { conversationId: 'conv-A', originPageId: 1 },
      },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error even with outside visible tabs')
    assert.ok(
      textOf(result).includes('active tab'),
      `Expected origin-tab error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasCloseTabGroupCalled(),
      'closeTabGroup should NOT have been called',
    )
  })
})
