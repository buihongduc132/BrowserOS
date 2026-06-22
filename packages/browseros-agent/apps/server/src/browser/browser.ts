import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { logger } from '../lib/logger'
import type { CdpBackend } from './backends/types'
import type { BookmarkNode } from './bookmarks'
import * as bookmarks from './bookmarks'
import {
  ConsoleCollector,
  type GetConsoleLogsOptions,
  type GetConsoleLogsResult,
} from './console-collector'
import { type DomSearchResult, parseNodeAttributes } from './dom'
import * as elements from './elements'
import * as extensionBridge from './extension-bridge'
import * as extensions from './extensions'
import type { HistoryEntry } from './history'
import * as history from './history'
import * as keyboard from './keyboard'
import * as mouse from './mouse'
import type { TabGroup } from './tab-groups'
import * as tabGroups from './tab-groups'
import { TabOwnershipRegistry } from './tab-ownership-registry'

export type { PageInfo } from './core/pages'

/** Server/eval facade over BrowserSession for callers that are not MCP tools. */
export class Browser {
  private cdp: CdpBackend
  private consoleCollector: ConsoleCollector
  private pages = new Map<number, PageInfo>()
  private sessions = new Map<string, string>()
  private nextPageId = 1
  readonly tabOwnership = new TabOwnershipRegistry()

  constructor(cdp: CdpBackend) {
    this.cdp = cdp
    this.consoleCollector = new ConsoleCollector(cdp)
    this.setupEventHandlers()
    this.startTabOwnershipIdleSweep()
  }

  /**
   * Start the idle sweep for tab ownership locks using shared config.
   * Called automatically in constructor. Override via TIMEOUTS.TAB_LOCK_IDLE
   * and TIMEOUTS.TAB_LOCK_SWEEP_INTERVAL config keys.
   */
  startTabOwnershipIdleSweep(): void {
    this.tabOwnership.startIdleSweep(
      TIMEOUTS.TAB_LOCK_IDLE,
      TIMEOUTS.TAB_LOCK_SWEEP_INTERVAL,
    )
  }

  /**
   * Stop the idle sweep. Call on shutdown.
   */
  stopTabOwnershipIdleSweep(): void {
    this.tabOwnership.stopIdleSweep()
  }

  isCdpConnected(): boolean {
    return this.core.isConnected()
  }

  /** Browser-core session shared by MCP and the in-process agent. */
  get session(): BrowserSession {
    return this.core
  }

  private async resolveSession(page: number): Promise<ProtocolApi> {
    return (await this.core.pages.getSession(page)).session
  }

  /** Resolves a window's active page to the CDP session used by screencast. */
  async getActivePageForWindow(windowId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getActiveSessionForWindow(windowId)
  }

  /** Resolves a BrowserOS page id to the CDP session used by screencast. */
  async getPageSession(pageId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getSession(pageId)
  }

  async listPages(): Promise<PageInfo[]> {
    const result = await this.cdp.Browser.getTabs({ includeHidden: true })
    const tabs = (result.tabs as TabInfo[]).filter(
      (t) => !EXCLUDED_URL_PREFIXES.some((prefix) => t.url.startsWith(prefix)),
    )

    const seenTargetIds = new Set<string>()

    for (const tab of tabs) {
      seenTargetIds.add(tab.targetId)

      let found = false
      for (const info of this.pages.values()) {
        if (info.targetId === tab.targetId) {
          info.url = tab.url
          info.title = tab.title
          info.tabId = tab.tabId
          info.isActive = tab.isActive
          info.isLoading = tab.isLoading
          info.loadProgress = tab.loadProgress
          info.isPinned = tab.isPinned
          info.isHidden = tab.isHidden
          // CDP omits windowId for hidden tabs, so preserve the
          // value we cached when the tab was created via newPage —
          // otherwise downstream filters (e.g. the tab picker
          // scoped to a thread's hidden window) lose every entry.
          info.windowId = tab.windowId ?? info.windowId
          info.index = tab.index
          info.groupId = tab.groupId
          found = true
          break
        }
      }

      if (!found) {
        const pageId = this.nextPageId++
        this.pages.set(pageId, {
          pageId,
          targetId: tab.targetId,
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          isActive: tab.isActive,
          isLoading: tab.isLoading,
          loadProgress: tab.loadProgress,
          isPinned: tab.isPinned,
          isHidden: tab.isHidden,
          windowId: tab.windowId,
          index: tab.index,
          groupId: tab.groupId,
        })
      }
    }

    for (const [pageId, info] of this.pages) {
      if (!seenTargetIds.has(info.targetId)) {
        this.consoleCollector.detach(pageId)
        this.pages.delete(pageId)
        this.tabOwnership.forceReleasePage(pageId)
      }
    }

    return [...this.pages.values()].sort((a, b) => a.pageId - b.pageId)
  }

  getTabIdForPage(pageId: number): number | undefined {
    return this.pages.get(pageId)?.tabId
  }

  getPageInfo(pageId: number): PageInfo | undefined {
    return this.pages.get(pageId)
  }

  async refreshPageInfo(pageId: number): Promise<PageInfo | undefined> {
    let info = this.pages.get(pageId)
    if (!info) {
      await this.listPages()
      info = this.pages.get(pageId)
    }
    if (!info) return undefined

    try {
      const result = await this.cdp.Browser.getTabInfo({ tabId: info.tabId })
      const tab = result.tab as TabInfo
      const updated: PageInfo = {
        ...info,
        targetId: tab.targetId,
        tabId: tab.tabId,
        url: tab.url,
        title: tab.title,
        isActive: tab.isActive,
        isLoading: tab.isLoading,
        loadProgress: tab.loadProgress,
        isPinned: tab.isPinned,
        isHidden: tab.isHidden,
        windowId: tab.windowId,
        index: tab.index,
        groupId: tab.groupId,
      }
      this.pages.set(pageId, updated)
      return updated
    } catch {
      await this.listPages()
      return this.pages.get(pageId)
    }
  }

  async getSession(pageId: number): Promise<ProtocolApi | null> {
    const info = this.pages.get(pageId)
    if (!info) return null
    const sessionId = this.sessions.get(info.targetId)
    if (!sessionId) return null
    return this.cdp.session(sessionId)
  }

  async getActivePage(): Promise<PageInfo | null> {
    const result = await this.cdp.Browser.getActiveTab()

    if (!result.tab) return null

    await this.listPages()

    for (const info of this.pages.values()) {
      if (info.targetId === (result.tab as TabInfo).targetId) return info
    }

    return null
  }

  async newPage(
    url: string,
    opts?: { hidden?: boolean; background?: boolean; windowId?: number },
  ): Promise<number> {
    if (opts?.hidden) return this.core.pages.newPage(url, opts)
    const windowId = await this.resolveVisibleWindowId(opts?.windowId)
    return this.core.pages.newPage(url, {
      background: opts?.background,
      windowId,
    })
  }

  async closePage(page: number): Promise<void> {
    await this.core.pages.close(page)
  }

  async resolveTabIds(tabIds: number[]): Promise<Map<number, number>> {
    return this.core.pages.resolveTabIds(tabIds)
  }

  private async resolveVisibleWindowId(
    requestedWindowId?: number,
  ): Promise<number | undefined> {
    if (requestedWindowId !== undefined) return requestedWindowId

    const windows = await this.core.windows.list()
    const visibleWindow =
      windows.find((window) => window.isVisible && window.isActive) ??
      windows.find((window) => window.isVisible)
    if (visibleWindow) return visibleWindow.windowId

    logger.warn('No visible browser window found; creating one for new page')
    return (await this.core.windows.create({ hidden: false })).windowId
  }

  /** Captures a page screenshot and reports DPR for direct eval capture. */
  async screenshot(
    page: number,
    opts: { format: string; quality?: number; fullPage: boolean },
  ): Promise<{ data: string; mimeType: string; devicePixelRatio: number }> {
    const session = await this.resolveSession(page)

    const params: Record<string, unknown> = {
      format: opts.format,
      captureBeyondViewport: opts.fullPage,
    }
    if (opts.quality !== undefined) params.quality = opts.quality

    const [screenshotResult, dprResult] = await Promise.allSettled([
      session.Page.captureScreenshot(
        params as Parameters<ProtocolApi['Page']['captureScreenshot']>[0],
      ),
      session.Runtime.evaluate({
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      }),
    ])

    if (screenshotResult.status === 'rejected') throw screenshotResult.reason

    const result = screenshotResult.value
    const devicePixelRatio =
      dprResult.status === 'fulfilled' &&
      typeof dprResult.value.result?.value === 'number'
        ? dprResult.value.result.value
        : 1

    return {
      data: result.data,
      mimeType: `image/${opts.format}`,
      devicePixelRatio,
    }
  }

  /** Evaluates page JavaScript for direct eval/captcha detection callers. */
  async evaluate(
    page: number,
    expression: string,
  ): Promise<{
    value?: unknown
    error?: string
    description?: string
  }> {
    const session = await this.resolveSession(page)

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    })

    if (result.exceptionDetails) {
      return {
        error:
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      }
    }

    return {
      value: result.result?.value,
      description: result.result?.description,
    }
  }

  async getDom(page: number, opts?: { selector?: string }): Promise<string> {
    const session = await this.resolveSession(page)
    const doc = await session.DOM.getDocument({ depth: 0 })

    let nodeId = doc.root.nodeId
    if (opts?.selector) {
      const found = await session.DOM.querySelector({
        nodeId: doc.root.nodeId,
        selector: opts.selector,
      })
      if (!found.nodeId) return ''
      nodeId = found.nodeId
    }

    const result = await session.DOM.getOuterHTML({ nodeId })
    return result.outerHTML
  }

  async searchDom(
    page: number,
    query: string,
    opts?: { limit?: number },
  ): Promise<{ results: DomSearchResult[]; totalCount: number }> {
    const session = await this.resolveSession(page)
    const limit = opts?.limit ?? 25

    await session.DOM.getDocument({ depth: 0 })
    const search = await session.DOM.performSearch({ query })
    const count = Math.min(search.resultCount, limit)

    if (count === 0) {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
      return { results: [], totalCount: search.resultCount }
    }

    try {
      const matched = await session.DOM.getSearchResults({
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: count,
      })

      const results: DomSearchResult[] = []
      const seen = new Set<number>()
      for (const nodeId of matched.nodeIds) {
        try {
          const desc = await session.DOM.describeNode({ nodeId, depth: 0 })
          let node = desc.node
          let resolvedNodeId = nodeId

          // Text/comment nodes: resolve to parent element via JS
          if (node.nodeType !== 1) {
            const resolved = await session.DOM.resolveNode({ nodeId })
            if (!resolved.object.objectId) continue
            const parentResult = await session.Runtime.callFunctionOn({
              objectId: resolved.object.objectId,
              functionDeclaration: 'function() { return this.parentElement; }',
              returnByValue: false,
            })
            if (!parentResult.result.objectId) continue
            const parentNode = await session.DOM.requestNode({
              objectId: parentResult.result.objectId,
            })
            resolvedNodeId = parentNode.nodeId
            const parentDesc = await session.DOM.describeNode({
              nodeId: parentNode.nodeId,
              depth: 0,
            })
            node = parentDesc.node
          }

          if (node.nodeType !== 1) continue
          if (seen.has(node.backendNodeId)) continue
          seen.add(node.backendNodeId)

          results.push({
            tag: node.localName,
            nodeId: resolvedNodeId,
            backendNodeId: node.backendNodeId,
            attributes: parseNodeAttributes(node),
          })
        } catch {
          // node may have been removed between search and describe
        }
      }

      return { results, totalCount: search.resultCount }
    } finally {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
    }
  }

  // --- Input ---

  async click(
    page: number,
    element: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<{ x: number; y: number } | undefined> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)

    try {
      const { x, y } = await elements.getElementCenter(session, element)
      await mouse.dispatchClick(
        session,
        x,
        y,
        opts?.button ?? 'left',
        opts?.clickCount ?? 1,
        0,
      )
      return { x, y }
    } catch {
      logger.debug(
        `CDP click failed for element=${element}, falling back to JS click`,
      )
      await elements.jsClick(session, element)
      return undefined
    }
  }

  async clickAt(
    page: number,
    x: number,
    y: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchClick(
      session,
      x,
      y,
      opts?.button ?? 'left',
      opts?.clickCount ?? 1,
      0,
    )
  }

  async hoverAt(page: number, x: number, y: number): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchHover(session, x, y)
  }

  async typeAt(
    page: number,
    x: number,
    y: number,
    text: string,
    clear = false,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchClick(session, x, y, 'left', 1, 0)
    if (clear) await keyboard.clearField(session)
    await keyboard.typeText(session, text)
  }

  async dragAt(
    page: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await mouse.dispatchDrag(session, from, to)
  }

  async hover(
    page: number,
    element: number,
  ): Promise<{ x: number; y: number }> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)
    const { x, y } = await elements.getElementCenter(session, element)
    await mouse.dispatchHover(session, x, y)
    return { x, y }
  }

  async fill(
    page: number,
    element: number,
    text: string,
    clear = true,
  ): Promise<{ x: number; y: number } | undefined> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, element)

    // Always click to guarantee real keyboard focus.
    // DOM.focus() is unreliable for shadow DOM, iframes, and custom components.
    let coords: { x: number; y: number } | undefined
    try {
      const { x, y } = await elements.getElementCenter(session, element)
      await mouse.dispatchClick(session, x, y, 'left', 1, 0)
      coords = { x, y }
    } catch {
      // Fallback to DOM.focus() if we can't get coordinates
      try {
        await elements.focusElement(session, element)
      } catch {
        logger.warn('Could not focus element via click or DOM.focus()')
      }
    }

    if (clear) {
      // Primary: keyboard select-all + backspace
      await keyboard.clearField(session)

      // Fallback: if field still has content, triple-click to select all
      // then typeText will overwrite the selection
      if (coords) {
        const value = await elements.getInputValue(session, element)
        if (value) {
          await mouse.dispatchClick(session, coords.x, coords.y, 'left', 3, 0)
        }
      }
    }

    await keyboard.typeText(session, text)
    return coords
  }

  async pressKey(page: number, key: string): Promise<void> {
    const session = await this.resolveSession(page)
    await keyboard.pressCombo(session, key)
  }

  async drag(
    page: number,
    sourceElement: number,
    target: { element?: number; x?: number; y?: number },
  ): Promise<{
    from: { x: number; y: number }
    to: { x: number; y: number }
  }> {
    const session = await this.resolveSession(page)

    await elements.scrollIntoView(session, sourceElement)
    const from = await elements.getElementCenter(session, sourceElement)

    let to: { x: number; y: number }
    if (target.element !== undefined) {
      to = await elements.getElementCenter(session, target.element)
    } else if (target.x !== undefined && target.y !== undefined) {
      to = { x: target.x, y: target.y }
    } else {
      throw new Error(
        'Provide either target element or both targetX and targetY.',
      )
    }

    await mouse.dispatchDrag(session, from, to)
    return { from, to }
  }

  async scroll(
    page: number,
    direction: string,
    amount: number,
    element?: number,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    const pixels = amount * 120
    const deltaX =
      direction === 'left' ? -pixels : direction === 'right' ? pixels : 0
    const deltaY =
      direction === 'up' ? -pixels : direction === 'down' ? pixels : 0

    if (deltaX === 0 && deltaY === 0) return

    let x: number
    let y: number
    if (element !== undefined) {
      const center = await elements.getElementCenter(session, element)
      x = center.x
      y = center.y
    } else {
      const metrics = await session.Page.getLayoutMetrics()
      x = metrics.layoutViewport.clientWidth / 2
      y = metrics.layoutViewport.clientHeight / 2
    }

    const beforeWindowPosition =
      element === undefined
        ? await this.getWindowScrollPosition(session)
        : undefined

    await mouse.dispatchScroll(session, x, y, deltaX, deltaY)

    if (beforeWindowPosition === undefined) return

    const afterWindowPosition = await this.getWindowScrollPosition(session)
    const moved = this.didScrollInExpectedDirection(
      beforeWindowPosition,
      afterWindowPosition,
      deltaX,
      deltaY,
    )
    if (moved) return

    await this.fallbackWindowScroll(session, deltaX, deltaY)
  }

  private async getWindowScrollPosition(
    session: ProtocolApi,
  ): Promise<{ x: number; y: number }> {
    const result = await session.Runtime.evaluate({
      expression:
        '({ x: window.scrollX ?? window.pageXOffset ?? 0, y: window.scrollY ?? window.pageYOffset ?? 0 })',
      returnByValue: true,
    })
    const value = (result.result?.value ?? {}) as { x?: number; y?: number }
    return {
      x: typeof value.x === 'number' ? value.x : 0,
      y: typeof value.y === 'number' ? value.y : 0,
    }
  }

  private didScrollInExpectedDirection(
    before: { x: number; y: number },
    after: { x: number; y: number },
    deltaX: number,
    deltaY: number,
  ): boolean {
    if (deltaX > 0 && after.x > before.x) return true
    if (deltaX < 0 && after.x < before.x) return true
    if (deltaY > 0 && after.y > before.y) return true
    if (deltaY < 0 && after.y < before.y) return true
    return false
  }

  private async fallbackWindowScroll(
    session: ProtocolApi,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await session.Runtime.evaluate({
      expression: `window.scrollBy(${deltaX}, ${deltaY})`,
      returnByValue: true,
    })
  }

  async handleDialog(
    page: number,
    accept: boolean,
    promptText?: string,
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await session.Page.handleJavaScriptDialog({
      accept,
      ...(promptText !== undefined && { promptText }),
    })
  }

  async selectOption(
    page: number,
    element: number,
    value: string,
  ): Promise<string | null> {
    const session = await this.resolveSession(page)

    const selected = await elements.callOnElement(
      session,
      element,
      `function(val){
				for(var i=0;i<this.options.length;i++){
					if(this.options[i].value===val||this.options[i].textContent.trim()===val){
						this.selectedIndex=i;
						this.dispatchEvent(new Event('change',{bubbles:true}));
						return this.options[i].textContent.trim();
					}
				}
				return null;
			}`,
      [value],
    )

    return selected as string | null
  }

  // --- Form helpers ---

  async focus(page: number, element: number): Promise<void> {
    const session = await this.resolveSession(page)
    await elements.scrollIntoView(session, element)
    await elements.focusElement(session, element)
  }

  async check(page: number, element: number): Promise<boolean> {
    const session = await this.resolveSession(page)
    const checked = await elements.callOnElement(
      session,
      element,
      'function(){return this.checked}',
    )
    if (!checked) await this.click(page, element)
    return true
  }

  async uncheck(page: number, element: number): Promise<boolean> {
    const session = await this.resolveSession(page)
    const checked = await elements.callOnElement(
      session,
      element,
      'function(){return this.checked}',
    )
    if (checked) await this.click(page, element)
    return false
  }

  async uploadFile(
    page: number,
    element: number,
    files: string[],
  ): Promise<void> {
    const session = await this.resolveSession(page)
    await session.DOM.setFileInputFiles({ files, backendNodeId: element })
  }

  // --- File operations ---

  async printToPDF(
    page: number,
    opts?: { landscape?: boolean; printBackground?: boolean },
  ): Promise<{ data: string }> {
    const session = await this.resolveSession(page)
    const result = await session.Page.printToPDF({
      landscape: opts?.landscape ?? false,
      printBackground: opts?.printBackground ?? true,
    })
    return { data: result.data }
  }

  async downloadViaClick(
    page: number,
    element: number,
    downloadPath: string,
  ): Promise<{ filePath: string; suggestedFilename: string }> {
    await this.cdp.Browser.setDownloadBehavior({
      behavior: 'allowAndName',
      downloadPath,
      eventsEnabled: true,
    })

    return new Promise<{ filePath: string; suggestedFilename: string }>(
      (resolve, reject) => {
        let guid = ''
        let suggestedFilename = ''
        const timeout = setTimeout(() => {
          cleanUp()
          reject(new Error('Download timed out after 60s'))
        }, 60000)

        const unsubBegin = this.cdp.Browser.on(
          'downloadWillBegin',
          (params) => {
            guid = params.guid
            suggestedFilename = params.suggestedFilename
          },
        )

        const unsubProgress = this.cdp.Browser.on(
          'downloadProgress',
          (params) => {
            if (params.guid === guid && params.state === 'completed') {
              cleanUp()
              resolve({
                filePath: `${downloadPath}/${guid}`,
                suggestedFilename,
              })
            }
            if (params.guid === guid && params.state === 'canceled') {
              cleanUp()
              reject(new Error('Download was canceled'))
            }
          },
        )

        const cleanUp = () => {
          clearTimeout(timeout)
          unsubBegin()
          unsubProgress()
          this.cdp.Browser.setDownloadBehavior({ behavior: 'default' }).catch(
            () => {},
          )
        }

        this.click(page, element).catch((err) => {
          cleanUp()
          reject(err)
        })
      },
    )
  }

  // --- Windows ---

  async listWindows(): Promise<WindowInfo[]> {
    const result = await this.cdp.Browser.getWindows()
    return result.windows as WindowInfo[]
  }

  async createWindow(opts?: { hidden?: boolean }): Promise<WindowInfo> {
    const result = await this.cdp.Browser.createWindow({
      ...(opts?.hidden !== undefined && { hidden: opts.hidden }),
    })
    return result.window as WindowInfo
  }

  async closeWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.closeWindow({ windowId })
  }

  async activateWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.activateWindow({ windowId })
  }

  /**
   * Changes a window between hidden and visible states.
   * BrowserOS may replace the underlying window, so callers must use the returned window ID.
   */
  async setWindowVisibility(
    windowId: number,
    opts: { visible: boolean; activate?: boolean },
  ): Promise<SetWindowVisibilityResult> {
    const result = await this.cdp.Browser.setWindowVisibility({
      windowId,
      visible: opts.visible,
      ...(opts.activate !== undefined && { activate: opts.activate }),
    })
    return {
      window: result.window as WindowInfo,
      replaced: result.replaced,
      previousWindowId: result.previousWindowId,
    }
  }

  async showPage(
    page: number,
    opts?: { windowId?: number; index?: number; activate?: boolean },
  ): Promise<PageInfo> {
    const info = this.pages.get(page)
    if (!info)
      throw new Error(
        `Unknown page ${page}. Use list_pages to see available pages.`,
      )

    const result = await this.cdp.Browser.showTab({
      tabId: info.tabId,
      ...(opts?.windowId !== undefined && { windowId: opts.windowId }),
      ...(opts?.index !== undefined && { index: opts.index }),
      ...(opts?.activate !== undefined && { activate: opts.activate }),
    })

    const tab = result.tab as TabInfo
    const updated: PageInfo = {
      ...info,
      isHidden: tab.isHidden,
      isActive: tab.isActive,
      windowId: tab.windowId,
      index: tab.index,
    }
    this.pages.set(page, updated)
    return updated
  }

  async movePage(
    page: number,
    opts?: { windowId?: number; index?: number },
  ): Promise<PageInfo> {
    const info = this.pages.get(page)
    if (!info)
      throw new Error(
        `Unknown page ${page}. Use list_pages to see available pages.`,
      )

    const result = await this.cdp.Browser.moveTab({
      tabId: info.tabId,
      ...(opts?.windowId !== undefined && { windowId: opts.windowId }),
      ...(opts?.index !== undefined && { index: opts.index }),
    })

    const tab = result.tab as TabInfo
    const updated: PageInfo = {
      ...info,
      windowId: tab.windowId,
      index: tab.index,
    }
    this.pages.set(page, updated)
    return updated
  }

  // --- Bookmarks ---

  async getBookmarks(): Promise<BookmarkNode[]> {
    return bookmarks.getBookmarks(this.cdp)
  }

  async createBookmark(params: {
    title: string
    url?: string
    parentId?: string
  }): Promise<BookmarkNode> {
    return bookmarks.createBookmark(this.cdp, params)
  }

  async removeBookmark(id: string): Promise<void> {
    return bookmarks.removeBookmark(this.cdp, id)
  }

  async updateBookmark(
    id: string,
    changes: { url?: string; title?: string },
  ): Promise<BookmarkNode> {
    return bookmarks.updateBookmark(this.cdp, id, changes)
  }

  async moveBookmark(
    id: string,
    destination: { parentId?: string; index?: number },
  ): Promise<BookmarkNode> {
    return bookmarks.moveBookmark(this.cdp, id, destination)
  }

  async searchBookmarks(query: string): Promise<BookmarkNode[]> {
    return bookmarks.searchBookmarks(this.cdp, query)
  }

  // --- History ---

  async searchHistory(
    query: string,
    maxResults?: number,
  ): Promise<HistoryEntry[]> {
    return history.searchHistory(this.cdp, query, maxResults)
  }

  async getRecentHistory(maxResults?: number): Promise<HistoryEntry[]> {
    return history.getRecentHistory(this.cdp, maxResults)
  }

  async deleteHistoryUrl(url: string): Promise<void> {
    return history.deleteUrl(this.cdp, url)
  }

  async deleteHistoryRange(startTime: number, endTime: number): Promise<void> {
    return history.deleteRange(this.cdp, startTime, endTime)
  }

  // --- Extension Management ---

  async loadUnpackedExtension(path: string): Promise<string> {
    return extensions.loadUnpackedExtension(this.cdp, path)
  }

  async uninstallExtension(id: string): Promise<void> {
    return extensions.uninstallExtension(this.cdp, id)
  }

  async getExtensionStorage(
    id: string,
    storageArea: extensions.StorageArea,
    keys?: string[],
  ): Promise<Record<string, unknown>> {
    return extensions.getStorageItems(this.cdp, id, storageArea, keys)
  }

  async setExtensionStorage(
    id: string,
    storageArea: extensions.StorageArea,
    values: Record<string, unknown>,
  ): Promise<void> {
    return extensions.setStorageItems(this.cdp, id, storageArea, values)
  }

  async removeExtensionStorage(
    id: string,
    storageArea: extensions.StorageArea,
    keys: string[],
  ): Promise<void> {
    return extensions.removeStorageItems(this.cdp, id, storageArea, keys)
  }

  async clearExtensionStorage(
    id: string,
    storageArea: extensions.StorageArea,
  ): Promise<void> {
    return extensions.clearStorageItems(this.cdp, id, storageArea)
  }

  // --- L2 Extension Management: list/getInfo/enable/disable ---

  async listExtensions(): Promise<extensions.ExtensionInfo[]> {
    return extensions.listExtensions(this.cdp)
  }

  async getExtensionInfo(id: string): Promise<extensions.ExtensionInfo> {
    return extensions.getExtensionInfo(this.cdp, id)
  }

  async enableExtension(id: string): Promise<void> {
    return extensions.enableExtension(this.cdp, id)
  }

  async disableExtension(id: string): Promise<void> {
    return extensions.disableExtension(this.cdp, id)
  }

  // --- Extension Message Bridge (L3) ---

  async listMessageableExtensions(): Promise<
    extensionBridge.MessageableExtension[]
  > {
    return extensionBridge.listMessageableExtensions(this.cdp)
  }

  async sendExtensionMessage(
    extensionId: string,
    message: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    return extensionBridge.sendExtensionMessage(
      this.cdp,
      extensionId,
      message,
      timeoutMs,
    )
  }

  // --- Tab Groups ---

  private resolvePageIdsToTabIds(pageIds: number[]): number[] {
    return pageIds.map((pageId) => {
      const info = this.pages.get(pageId)
      if (!info)
        throw new Error(
          `Unknown page ${pageId}. Use list_pages to see available pages.`,
        )
      return info.tabId
    })
  }

  async listTabGroups(): Promise<
    (Omit<TabGroup, 'tabIds'> & { pageIds: number[] })[]
  > {
    await this.listPages()
    const groups = await tabGroups.listTabGroups(this.cdp)

    const tabToPage = new Map<number, number>()
    for (const info of this.pages.values()) {
      tabToPage.set(info.tabId, info.pageId)
    }

    return groups.map((group) => {
      const { tabIds, ...rest } = group
      return {
        ...rest,
        pageIds: tabIds
          .map((tabId) => tabToPage.get(tabId))
          .filter((id): id is number => id !== undefined),
      }
    })
  }

  async groupTabs(
    pageIds: number[],
    opts?: { title?: string; groupId?: string },
  ): Promise<Omit<TabGroup, 'tabIds'> & { pageIds: number[] }> {
    await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    const group = await tabGroups.groupTabs(this.cdp, tabIds, opts)

    const tabToPage = new Map<number, number>()
    for (const info of this.pages.values()) {
      tabToPage.set(info.tabId, info.pageId)
    }

    const { tabIds: groupTabIds, ...rest } = group
    return {
      ...rest,
      pageIds: groupTabIds
        .map((tabId) => tabToPage.get(tabId))
        .filter((id): id is number => id !== undefined),
    }
  }

  async updateTabGroup(
    groupId: string,
    opts: { title?: string; color?: string; collapsed?: boolean },
  ): Promise<TabGroup> {
    return tabGroups.updateTabGroup(this.cdp, groupId, opts)
  }

  async ungroupTabs(pageIds: number[]): Promise<void> {
    await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    return tabGroups.ungroupTabs(this.cdp, tabIds)
  }

  async closeTabGroup(groupId: string): Promise<void> {
    return tabGroups.closeTabGroup(this.cdp, groupId)
  }

  // --- Console ---

  async getConsoleLogs(
    page: number,
    opts?: GetConsoleLogsOptions,
  ): Promise<GetConsoleLogsResult> {
    await this.resolveSession(page)
    return this.consoleCollector.getLogs(page, opts)
  }
}
