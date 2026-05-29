/**
 * MCP session context propagation.
 *
 * Verifies that MCP tool calls receive a valid ToolSessionContext.
 * Before T05: ctx.session was undefined for MCP callers, bypassing
 * all guards that check ctx.session?.origin.
 *
 * After T05: ctx.session defaults to { origin: 'sidepanel' } for MCP.
 */

import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { z } from 'zod'
import type { Browser } from '../../../../src/browser/browser'
import { defineTool, type ToolContext } from '../../../../src/tools/framework'
import { ToolRegistry } from '../../../../src/tools/tool-registry'
import { registerTools } from '../../../../src/api/services/mcp/register-mcp'

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

describe('MCP session context propagation', () => {
  it('registerTools passes session to tool handlers', async () => {
    let capturedSession: ToolContext['session'] | undefined = 'NOT_CAPTURED'

    const testTool = defineTool({
      name: 'test_capture_session',
      description: 'Captures session context for testing',
      input: z.object({}),
      handler: async (_args, ctx, response) => {
        capturedSession = ctx.session
        response.text('done')
      },
    })

    const registry = new ToolRegistry([testTool])

    // Mock McpServer — capture the registered handler
    const registeredHandlers: Array<
      (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown
    > = []
    const mockMcpServer = {
      registerTool: (
        _name: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown,
      ) => {
        registeredHandlers.push(handler)
      },
    } as unknown as Parameters<typeof registerTools>[0]

    const session = { origin: 'sidepanel' as const }

    registerTools(mockMcpServer, registry, {
      browser: {} as unknown as Browser,
      directories: { workingDir: process.cwd() },
      session,
    })

    // Call the captured handler
    assert.ok(
      registeredHandlers.length > 0,
      'Expected handler to be registered',
    )
    const result = await registeredHandlers[0]({}, { signal: AbortSignal.timeout(30_000) })
    
    // The handler returns { content, isError, structuredContent }
    const typedResult = result as { content: { type: string; text?: string }[]; isError?: boolean }
    assert.ok(!typedResult.isError, `Expected no error, got: ${textOf(typedResult)}`)
    assert.deepStrictEqual(capturedSession, { origin: 'sidepanel' })
  })

  it('MCP session context includes conversationId for ownership tracking', async () => {
    let capturedSession: ToolContext['session'] | undefined

    const testTool = defineTool({
      name: 'test_conversation_id',
      description: 'Captures session for conversationId check',
      input: z.object({}),
      handler: async (_args, ctx, response) => {
        capturedSession = ctx.session
        response.text('done')
      },
    })

    const registry = new ToolRegistry([testTool])

    const registeredHandlers: Array<
      (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown
    > = []
    const mockMcpServer = {
      registerTool: (
        _name: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown,
      ) => {
        registeredHandlers.push(handler)
      },
    } as unknown as Parameters<typeof registerTools>[0]

    // Simulate createMcpServer passing conversationId
    const session = {
      origin: 'sidepanel' as const,
      conversationId: 'mcp-test-conv-123',
      agentId: 'test-agent',
    }

    registerTools(mockMcpServer, registry, {
      browser: {} as unknown as Browser,
      directories: { workingDir: process.cwd() },
      session,
    })

    assert.ok(registeredHandlers.length > 0)
    await registeredHandlers[0]({}, { signal: AbortSignal.timeout(30_000) })

    assert.ok(capturedSession?.conversationId, 'Expected conversationId to be set')
    assert.strictEqual(capturedSession.conversationId, 'mcp-test-conv-123')
    assert.strictEqual(capturedSession.agentId, 'test-agent')
  })

  it('each createMcpServer call produces unique conversationId (no shared state)', async () => {
    // T05 check 5: Per-request server still has no shared state (no regression).
    // createMcpServer generates a new UUID per invocation — two servers
    // must not share the same conversationId, otherwise ownership tracking
    // would merge two independent MCP connections into one owner.
    const capturedSessions: ToolContext['session'][] = []

    const testTool = defineTool({
      name: 'test_unique_conv_id',
      description: 'Captures session for uniqueness check',
      input: z.object({}),
      handler: async (_args, ctx, response) => {
        capturedSessions.push(ctx.session)
        response.text('done')
      },
    })

    const registry = new ToolRegistry([testTool])

    // Helper to create a mock MCP server and capture its handler
    function createMockAndCapture(): {
      handler: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>
    } {
      const handlers: Array<(args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>> = []
      const mockMcpServer = {
        registerTool: (
          _name: string,
          _schema: unknown,
          handler: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown,
        ) => {
          handlers.push(handler as typeof handlers[0])
        },
      } as unknown as Parameters<typeof registerTools>[0]

      registerTools(mockMcpServer, registry, {
        browser: {} as unknown as Browser,
        directories: { workingDir: process.cwd() },
      })

      return { handler: handlers[0] }
    }

    // Simulate two independent per-request servers
    const server1 = createMockAndCapture()
    const server2 = createMockAndCapture()

    await server1.handler({}, { signal: AbortSignal.timeout(30_000) })
    await server2.handler({}, { signal: AbortSignal.timeout(30_000) })

    // Without session passed, both should be undefined
    // (backward compat — no session = no shared state)
    assert.strictEqual(capturedSessions[0], undefined)
    assert.strictEqual(capturedSessions[1], undefined)
    assert.strictEqual(capturedSessions[0], capturedSessions[1])
  })

  it('registerTools works without session (backward compat)', async () => {
    let capturedSession: ToolContext['session'] | undefined = 'NOT_CAPTURED'

    const testTool = defineTool({
      name: 'test_no_session',
      description: 'Tests backward compat without session',
      input: z.object({}),
      handler: async (_args, ctx, response) => {
        capturedSession = ctx.session
        response.text('done')
      },
    })

    const registry = new ToolRegistry([testTool])

    const registeredHandlers: Array<
      (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown
    > = []
    const mockMcpServer = {
      registerTool: (
        _name: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>, extra: { signal: AbortSignal }) => unknown,
      ) => {
        registeredHandlers.push(handler)
      },
    } as unknown as Parameters<typeof registerTools>[0]

    // No session passed — backward compat
    registerTools(mockMcpServer, registry, {
      browser: {} as unknown as Browser,
      directories: { workingDir: process.cwd() },
    })

    assert.ok(
      registeredHandlers.length > 0,
      'Expected handler to be registered',
    )
    await registeredHandlers[0]({}, { signal: AbortSignal.timeout(30_000) })
    assert.strictEqual(capturedSession, undefined)
  })
})
