import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { z } from 'zod'
import type { Browser } from '../browser/browser'
import { enforceOwnership } from './ownership-enforcement'
import { ToolResponse, type ToolResult } from './response'

export interface ToolDefinition {
  name: string
  description: string
  input: z.ZodType
  output?: z.ZodType
  handler: ToolHandler
}

export type ToolHandler = (
  args: unknown,
  ctx: ToolContext,
  response: ToolResponse,
) => Promise<void>

export interface ToolDirectories {
  workingDir?: string
  resourcesDir?: string
}

export interface ToolSessionContext {
  origin?: 'sidepanel' | 'newtab'
  originPageId?: number
  conversationId?: string
}

export type ToolContext = {
  browser: Browser
  directories: ToolDirectories
  session?: ToolSessionContext
  /** When true, reject tool calls on tabs owned by another conversation. */
  strictOwnership?: boolean
}

export function resolveWorkingPath(
  ctx: ToolContext,
  targetPath: string,
  cwd?: string,
): string {
  return resolve(cwd ?? ctx.directories.workingDir ?? tmpdir(), targetPath)
}

export function defineTool<
  TInput extends z.ZodType,
  TOutput extends z.ZodType | undefined = undefined,
>(config: {
  name: string
  description: string
  input: TInput
  output?: TOutput
  handler: (
    args: z.infer<TInput>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<void>
}): ToolDefinition {
  return config as ToolDefinition
}

export async function executeTool(
  tool: ToolDefinition,
  args: unknown,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolResult> {
  const response = new ToolResponse()

  if (signal.aborted) {
    response.error('Request was aborted')
    return response.toResult()
  }

  // Centralized tab ownership enforcement: if the tool takes a `page` param,
  // auto-claim or reject based on ownership state before the handler runs.
  const ownershipPageId = (args as Record<string, unknown>).page
  if (typeof ownershipPageId === 'number') {
    const ownership = enforceOwnership(ctx, ownershipPageId)
    if (!ownership.allowed) {
      response.error(ownership.error ?? 'Tab ownership conflict')
      return response.toResult()
    }
    if (ownership.warning) {
      response.text(`\u26a0\ufe0f ${ownership.warning}`)
    }
  }

  try {
    await tool.handler(args, ctx, response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    response.error(`Internal error in ${tool.name}: ${message}`)
  }

  const result = await response.build(ctx.browser)

  const pageId = (args as Record<string, unknown>).page
  if (typeof pageId === 'number') {
    const tabId = ctx.browser.getTabIdForPage(pageId)
    if (tabId !== undefined) {
      result.metadata = { ...result.metadata, tabId }
    }
  }

  return result
}
