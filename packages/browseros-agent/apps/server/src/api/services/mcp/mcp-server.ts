/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserSession } from '../../../browser/core/session'
import type { ConnectorToolScope, KlavisService } from '../klavis'
import { MCP_INSTRUCTIONS } from './mcp-prompt'
import { registerTools } from './register-mcp'

export interface McpServiceDeps {
  version: string
  browserSession: BrowserSession
  klavis?: KlavisService
  connectorScope?: ConnectorToolScope
  defaultWindowId?: number
  // Optional agent identifier for the MCP connection.
  // Used in tab ownership tracking so the owning agent is visible.
  agentId?: string
  // When true, tool calls on tabs owned by another conversation are rejected.
  strictOwnership?: boolean
}

export function createMcpServer(deps: McpServiceDeps): McpServer {
  const server = new McpServer(
    {
      name: 'browseros_mcp',
      title: 'BrowserOS MCP server',
      version: deps.version,
    },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
  )

  server.server.setRequestHandler(SetLevelRequestSchema, () => {
    return {}
  })

  registerTools(server, {
    browserSession: deps.browserSession,
    defaultWindowId: deps.defaultWindowId,
    // MCP callers get sidepanel-level protections by default.
    // This ensures guards (last-visible-tab, origin-tab) work for MCP
    // callers instead of being silently bypassed (ctx.session was undefined).
    // conversationId is derived from agentId for stability across requests —
    // stateless POST clients from the same agent share the same identity.
    // Fallback to random UUID only when no agentId is available.
    // originPageId is intentionally undefined — MCP callers have no host tab.
    session: {
      origin: 'sidepanel',
      conversationId: deps.agentId ? `mcp-${deps.agentId}` : `mcp-default`,
      agentId: deps.agentId,
    },
    strictOwnership: deps.strictOwnership ?? false,
  })

  deps.klavis?.registerMcpTools(server, deps.connectorScope)

  return server
}
