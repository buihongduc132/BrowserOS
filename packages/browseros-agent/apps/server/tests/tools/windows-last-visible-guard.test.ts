/**
 * Last-visible-window guard for close_window and set_window_visibility.
 *
 * close_window must reject closing the last visible window.
 * set_window_visibility must reject hiding the last visible window.
 * Hidden windows do NOT count as visible.
 *
 * Unit tests using a mocked Browser.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser, WindowInfo } from '../../src/browser/browser'
import { executeTool } from '../../src/tools/framework'
import {
  close_window,
  set_window_visibility,
} from '../../src/tools/windows'

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

function createMockBrowser(windows: WindowInfo[]) {
  let closeWindowCalled = false
  let setWindowVisibilityCalled = false
  const browser = {
    listWindows: async () => windows,
    closeWindow: async () => {
      closeWindowCalled = true
    },
    listPages: async () => [],
    setWindowVisibility: async (
      _windowId: number,
      opts: { visible: boolean; activate?: boolean },
    ) => {
      setWindowVisibilityCalled = true
      const target = windows.find((w) => w.windowId === _windowId)
      return {
        previousWindowId: _windowId,
        replaced: false,
        window: {
          ...(target ?? makeWindow({ windowId: _windowId })),
          isVisible: opts.visible,
        },
      }
    },
  } as unknown as Browser

  return {
    browser,
    wasCloseWindowCalled: () => closeWindowCalled,
    wasSetWindowVisibilityCalled: () => setWindowVisibilityCalled,
  }
}

// ── close_window tests ──

describe('close_window last-visible-window guard', () => {
  it('rejects closing the only visible window', async () => {
    const windows = [makeWindow({ windowId: 1, isVisible: true })]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error when closing last visible window')
    assert.ok(
      textOf(result).includes('Cannot close the last visible window'),
      `Expected last-visible-window error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasCloseWindowCalled(),
      'closeWindow should NOT have been called',
    )
  })

  it('allows closing one of multiple visible windows', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(wasCloseWindowCalled(), 'closeWindow should have been called')
  })

  it('rejects closing the last visible window when hidden windows exist', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: false }),
    ]
    const { browser } = createMockBrowser(windows)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      result.isError,
      'Expected error — hidden windows do not count as visible',
    )
    assert.ok(
      textOf(result).includes('Cannot close the last visible window'),
      `Expected last-visible-window error, got: ${textOf(result)}`,
    )
  })

  it('allows closing a hidden window when visible windows remain', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: false }),
    ]
    const { browser, wasCloseWindowCalled } = createMockBrowser(windows)

    const result = await executeTool(
      close_window,
      { windowId: 2 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasCloseWindowCalled(),
      'closeWindow should have been called for hidden window',
    )
  })

  it('guard works for all window types (popup, devtools)', async () => {
    // A popup window is the last visible window — still should not close
    const windows = [
      makeWindow({
        windowId: 1,
        isVisible: true,
        windowType: 'popup',
      }),
    ]
    const { browser } = createMockBrowser(windows)

    const result = await executeTool(
      close_window,
      { windowId: 1 },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error for popup window')
    assert.ok(
      textOf(result).includes('Cannot close the last visible window'),
      `Expected last-visible-window error, got: ${textOf(result)}`,
    )
  })
})

// ── set_window_visibility tests ──

describe('set_window_visibility last-visible-window guard', () => {
  it('rejects hiding the only visible window', async () => {
    const windows = [makeWindow({ windowId: 1, isVisible: true })]
    const { browser, wasSetWindowVisibilityCalled } =
      createMockBrowser(windows)

    const result = await executeTool(
      set_window_visibility,
      { windowId: 1, visible: false },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(result.isError, 'Expected error when hiding last visible window')
    assert.ok(
      textOf(result).includes('Cannot hide the last visible window'),
      `Expected last-visible-window error, got: ${textOf(result)}`,
    )
    assert.ok(
      !wasSetWindowVisibilityCalled(),
      'setWindowVisibility should NOT have been called',
    )
  })

  it('allows hiding one of multiple visible windows', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: true }),
    ]
    const { browser, wasSetWindowVisibilityCalled } =
      createMockBrowser(windows)

    const result = await executeTool(
      set_window_visibility,
      { windowId: 1, visible: false },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasSetWindowVisibilityCalled(),
      'setWindowVisibility should have been called',
    )
  })

  it('rejects hiding the last visible window when hidden windows exist', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: false }),
    ]
    const { browser } = createMockBrowser(windows)

    const result = await executeTool(
      set_window_visibility,
      { windowId: 1, visible: false },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      result.isError,
      'Expected error — hidden windows do not count as visible',
    )
    assert.ok(
      textOf(result).includes('Cannot hide the last visible window'),
      `Expected last-visible-window error, got: ${textOf(result)}`,
    )
  })

  it('allows showing a hidden window', async () => {
    const windows = [
      makeWindow({ windowId: 1, isVisible: true }),
      makeWindow({ windowId: 2, isVisible: false }),
    ]
    const { browser, wasSetWindowVisibilityCalled } =
      createMockBrowser(windows)

    const result = await executeTool(
      set_window_visibility,
      { windowId: 2, visible: true },
      { browser, directories: { workingDir: process.cwd() } },
      AbortSignal.timeout(30_000),
    )

    assert.ok(
      !result.isError,
      `Expected success, got error: ${textOf(result)}`,
    )
    assert.ok(
      wasSetWindowVisibilityCalled(),
      'setWindowVisibility should have been called',
    )
  })
})
