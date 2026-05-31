import { z } from 'zod'
import { defineTool } from './framework'

const windowInfoSchema = z.object({
  windowId: z.number(),
  windowType: z.enum([
    'normal',
    'popup',
    'app',
    'devtools',
    'app_popup',
    'picture_in_picture',
  ]),
  bounds: z.object({
    left: z.number().optional(),
    top: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    windowState: z
      .enum(['normal', 'minimized', 'maximized', 'fullscreen'])
      .optional(),
  }),
  isActive: z.boolean(),
  isVisible: z.boolean(),
  tabCount: z.number(),
  activeTabId: z.number().optional(),
})

export const list_windows = defineTool({
  name: 'list_windows',
  description: 'List all browser windows',
  input: z.object({}),
  output: z.object({
    windows: z.array(windowInfoSchema),
    count: z.number(),
  }),
  handler: async (_args, ctx, response) => {
    const windows = await ctx.browser.listWindows()

    if (windows.length === 0) {
      response.text('No windows found.')
      response.data({ windows: [], count: 0 })
      return
    }

    const lines: string[] = [`Found ${windows.length} windows:`, '']
    for (const w of windows) {
      const markers: string[] = []
      if (!w.isVisible) markers.push('HIDDEN')
      if (w.isActive) markers.push('ACTIVE')
      const suffix = markers.length > 0 ? ` [${markers.join(', ')}]` : ''
      lines.push(
        `Window ${w.windowId} (${w.windowType}, ${w.tabCount} tabs)${suffix}`,
      )
    }

    response.text(lines.join('\n'))
    response.data({ windows, count: windows.length })
  },
})

export const create_window = defineTool({
  name: 'create_window',
  description: 'Create a new browser window',
  input: z.object({
    hidden: z.boolean().optional().describe('Create as hidden window'),
  }),
  output: z.object({
    window: windowInfoSchema,
  }),
  handler: async (args, ctx, response) => {
    const window = await ctx.browser.createWindow(args)
    const hiddenMarker = !window.isVisible ? ' (hidden)' : ''
    response.text(`Created window ${window.windowId}${hiddenMarker}`)
    response.data({ window })
  },
})

export const create_hidden_window = defineTool({
  name: 'create_hidden_window',
  description:
    'Create a new hidden browser window. Hidden windows are not visible to the user and useful for background automation.',
  input: z.object({}),
  output: z.object({
    window: windowInfoSchema,
  }),
  handler: async (_args, ctx, response) => {
    const window = await ctx.browser.createWindow({ hidden: true })
    response.text(`Created hidden window ${window.windowId}`)
    response.data({ window })
  },
})

export const close_window = defineTool({
  name: 'close_window',
  description: 'Close a browser window',
  input: z.object({
    windowId: z.number().describe('Window ID to close'),
  }),
  output: z.object({
    action: z.literal('close_window'),
    windowId: z.number(),
  }),
  handler: async (args, ctx, response) => {
    // Last-visible-window guard: reject if closing would leave 0 visible windows.
    const windows = await ctx.browser.listWindows()
    const visibleWindows = windows.filter((w) => w.isVisible)
    const target = windows.find((w) => w.windowId === args.windowId)
    const isTargetVisible = target?.isVisible ?? false
    const remainingVisible = isTargetVisible
      ? visibleWindows.filter((w) => w.windowId !== args.windowId)
      : visibleWindows
    if (remainingVisible.length === 0) {
      response.error(
        'Cannot close the last visible window — this would close the browser.',
      )
      return
    }

    // Origin-tab guard: reject if window contains the origin tab
    if (ctx.session?.originPageId !== undefined) {
      const allPages = await ctx.browser.listPages()
      const originInWindow = allPages.find(
        (p) =>
          p.pageId === ctx.session?.originPageId &&
          p.windowId === args.windowId,
      )
      if (originInWindow) {
        response.error(
          'Cannot close a window that contains the active tab — this would disrupt the current chat session.',
        )
        return
      }
    }

    // Ownership guard: check if any pages in the target window are owned
    // by a different conversation. In strict mode, reject. Otherwise warn.
    const allPages = await ctx.browser.listPages()
    const windowPages = allPages.filter(
      (p) => p.windowId === args.windowId,
    )
    const registry = ctx.browser.tabOwnership
    const conversationId = ctx.session?.conversationId
    if (registry && conversationId) {
      const foreignOwned = windowPages.filter((p) => {
        const owner = registry.getOwner(p.pageId)
        return owner && owner.ownerConversationId !== conversationId
      })

      if (foreignOwned.length > 0) {
        const ownerIds = [
          ...new Set(
            foreignOwned.map((p) => registry.getOwner(p.pageId)?.ownerConversationId),
          ),
        ].filter(Boolean)

        if (ctx.strictOwnership) {
          response.error(
            `Cannot close window ${args.windowId}: contains ${foreignOwned.length} page(s) locked by conversation(s) ${ownerIds.join(', ')}. Use list_pages to find unlocked tabs.`,
          )
          return
        }

        response.text(
          `⚠️ Window ${args.windowId} contains ${foreignOwned.length} page(s) locked by conversation(s) ${ownerIds.join(', ')}. Proceeding in non-strict mode.`,
        )
      }
    }

    await ctx.browser.closeWindow(args.windowId)

    // Release ownership locks for pages in the closed window to prevent stale locks
    if (registry) {
      for (const page of windowPages) {
        registry.forceReleasePage(page.pageId)
      }
    }

    response.text(`Closed window ${args.windowId}`)
    response.data({ action: 'close_window', windowId: args.windowId })
    response.includePages()
  },
})

export const activate_window = defineTool({
  name: 'activate_window',
  description: 'Activate (focus) a browser window',
  input: z.object({
    windowId: z.number().describe('Window ID to activate'),
  }),
  output: z.object({
    action: z.literal('activate_window'),
    windowId: z.number(),
  }),
  handler: async (args, ctx, response) => {
    await ctx.browser.activateWindow(args.windowId)
    response.text(`Activated window ${args.windowId}`)
    response.data({ action: 'activate_window', windowId: args.windowId })
  },
})

export const set_window_visibility = defineTool({
  name: 'set_window_visibility',
  description:
    'Set a browser window visible or hidden. Returns the new window ID because BrowserOS may replace the window during the transition.',
  input: z.object({
    windowId: z.number().describe('Window ID to show or hide'),
    visible: z.boolean().describe('Set true to show, false to hide'),
    activate: z
      .boolean()
      .optional()
      .describe(
        'Activate (focus) the window after making it visible. Has no effect when visible is false.',
      ),
  }),
  output: z.object({
    action: z.literal('set_window_visibility'),
    previousWindowId: z.number(),
    newWindowId: z.number(),
    replaced: z.boolean(),
    window: windowInfoSchema,
  }),
  handler: async (args, ctx, response) => {
    // Last-visible-window guard for hiding: reject if hiding would leave 0 visible windows.
    if (!args.visible) {
      const windows = await ctx.browser.listWindows()
      const visibleWindows = windows.filter((w) => w.isVisible)
      const target = windows.find((w) => w.windowId === args.windowId)
      const isTargetVisible = target?.isVisible ?? false
      const remainingVisible = isTargetVisible
        ? visibleWindows.filter((w) => w.windowId !== args.windowId)
        : visibleWindows
      if (remainingVisible.length === 0) {
        response.error(
          'Cannot hide the last visible window — this would close the browser.',
        )
        return
      }
    }

    const result = await ctx.browser.setWindowVisibility(args.windowId, {
      visible: args.visible,
      activate: args.activate,
    })
    const newWindowId = result.window.windowId
    const state = result.window.isVisible ? 'visible' : 'hidden'
    response.text(
      `Set window ${args.windowId} ${state}. New window ID: ${newWindowId}`,
    )
    response.data({
      action: 'set_window_visibility',
      previousWindowId: result.previousWindowId,
      newWindowId,
      replaced: result.replaced,
      window: result.window,
    })
    response.includePages()
  },
})
