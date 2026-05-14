/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Consolidated HTTP Server
 *
 * This server combines:
 * - Agent HTTP routes (chat, klavis, provider)
 * - MCP HTTP routes (using @hono/mcp transport)
 */

import { configStore } from '@browseros/shared/constants/config-store'
import { OPENCLAW_GATEWAY_CONTAINER_NAME } from '@browseros/shared/constants/openclaw'
import { Hono } from 'hono'
import { websocket } from 'hono/bun'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HttpAgentError } from '../agent/errors'
import { INLINED_ENV } from '../env'
import { getAdvancedConfigPath } from '../lib/browseros-dir'
import { KlavisClient } from '../lib/clients/klavis/klavis-client'
import { initializeOAuth, shutdownOAuth } from '../lib/clients/oauth'
import { getDb } from '../lib/db'
import { logger } from '../lib/logger'
import { Sentry } from '../lib/sentry'
import { requireTrustedOrigin } from './middleware/require-trusted-origin'
import { requireTrustedAppOrigin } from './utils/request-auth'
import { AgentSessionStore } from '../agent/agent-session-store'
import { SessionStore } from '../agent/session-store'
import { createAgentRoutes } from './routes/agents'
import { createAgentSessionRoutes } from './routes/agent-sessions'
import { createAssistantSessionRoutes } from './routes/assistant-sessions'
import { createChatRoutes } from './routes/chat'
import { createCompactionRoutes, type CompactionRouteDeps } from './routes/compaction'
import { resolveCompactionConfig } from '../agent/compaction-config'
import { createConfigRoutes } from './routes/config'
import { createCreditsRoutes } from './routes/credits'
import { createHealthRoute } from './routes/health'
import { createKlavisRoutes } from './routes/klavis'
import { createMcpRoutes } from './routes/mcp'
import { createMonitoringRoutes } from './routes/monitoring'
import { createOAuthRoutes } from './routes/oauth'
import { createProviderRoutes } from './routes/provider'
import { createRefinePromptRoutes } from './routes/refine-prompt'
import { createShutdownRoute } from './routes/shutdown'
import { createSkillSourcesRoutes } from './routes/skill-sources'
import { createSkillsRoutes } from './routes/skills'
import { createSoulRoutes } from './routes/soul'
import { createStatusRoute } from './routes/status'
import {
  connectKlavisInBackground,
  type KlavisProxyRef,
} from './services/klavis/strata-proxy'
import type { Env, HttpServerConfig } from './types'
import { defaultCorsConfig } from './utils/cors'
import { requireTrustedAppOrigin } from './utils/request-auth'

async function assertPortAvailable(port: number): Promise<void> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const probe = net.createServer()

    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          Object.assign(new Error(`Port ${port} is already in use`), {
            code: 'EADDRINUSE',
          }),
        )
      } else {
        reject(err)
      }
    })

    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      probe.close(() => resolve())
    })
  })
}

export async function createHttpServer(config: HttpServerConfig) {
  const {
    port,
    host = '0.0.0.0',
    browserosId,
    executionDir,
    resourcesDir,
    version,
    browser,
    registry,
  } = config

  const { onShutdown } = config
  configStore.init(getAdvancedConfigPath())
  const tokenManager = browserosId
    ? initializeOAuth(getDb(), browserosId)
    : null
  if (!browserosId) shutdownOAuth()

  // Connect Klavis proxy in background with retry — browser tools available immediately
  const klavisRef: KlavisProxyRef = { handle: null }
  const stopKlavisBackground = browserosId
    ? connectKlavisInBackground(klavisRef, {
        klavisClient: new KlavisClient(),
        browserosId,
      })
    : () => {}

  const monitoringRoutes = new Hono<Env>()
    .use('/*', requireTrustedAppOrigin())
    .route('/', createMonitoringRoutes())

  const agentRoutes = new Hono<Env>()
    .use('/*', requireTrustedAppOrigin())
    .route(
      '/',
      createAgentRoutes({
        browserosServerPort: port,
        resourcesDir,
        browser,
        ensureVmRuntimeReady: async (adapter) => {
          switch (adapter) {
            case 'hermes':
              await ensureHermesRuntimeReady({ resourcesDir })
          }
        },
      }),
    )

  const app = new Hono<Env>()
    .use('/*', cors(defaultCorsConfig))
    .use('/*', requireTrustedOrigin())
    .route('/health', createHealthRoute({ browser }))
    .route(
      '/shutdown',
      createShutdownRoute({
        onShutdown: () => {
          shutdownOAuth()
          stopKlavisBackground()
          klavisRef.handle?.close().catch((err) =>
            logger.warn('Failed to close Klavis proxy transport', {
              error: err instanceof Error ? err.message : String(err),
            }),
          )
          onShutdown?.()
        },
      }),
    )
    .route('/status', createStatusRoute({ browser }))
    // Single shared AgentSessionStore — harness and routes see the same instance
    const sharedSessionStore = new AgentSessionStore()
    // Shared chat SessionStore — lifts from createChatRoutes so compaction can access messages
    const sharedChatSessionStore = new SessionStore()
    .route(
      '/agents',
      createAgentRoutes({ browser, browserosServerPort: port, sessionMetaStore: sharedSessionStore }),
    )
    .route(
      '/agents',
      createAgentSessionRoutes({ sessionStore: sharedSessionStore }),
    )
    // ------------------------------------------------------------------
    // Compaction routes — config CRUD + on-demand trigger
    // ------------------------------------------------------------------
    // The trigger endpoint (POST /compact) requires runtime deps:
    //   - getConversationMessages: loads messages from the in-memory session store
    //   - createModel: creates a LanguageModel for summarization
    //
    // Currently the chat SessionStore is scoped inside createChatRoutes().
    // To fully wire the trigger, either:
    //   (a) lift the SessionStore to this level and inject into both
    //       createChatRoutes and createCompactionRoutes, or
    //   (b) expose a getMessages() method on ChatService.
    //
    // For now the trigger is registered but returns 503 until wired.
    .route(
      '/compaction',
      new Hono<Env>()
        .use('/*', requireTrustedAppOrigin())
        .route(
          '/',
          createCompactionRoutes({
            getConversationMessages: async (conversationId: string) => {
              const session = sharedChatSessionStore.get(conversationId)
              if (!session) return null
              // Convert UIMessage[] to ModelMessage[] — strip UI-specific parts
              return session.agent.messages.map((m) => ({
                role: m.role,
                content: typeof m.content === 'string'
                  ? m.content
n                  : m.parts
                    ?.filter((p: any) => p.type === 'text')
                    ?.map((p: any) => p.text)
                    ?.join('\n') ?? '',
              })) as any[]
            },
            createModel: () => {
              // Reuse first active session's model config, or throw
              // This is a best-effort — the model is tied to the session's provider
              throw new Error('Model creation requires an active session context')
            },
            getCompactionConfig: () => {
              const raw = config.compaction
              if (!raw) return undefined
              try { return resolveCompactionConfig(raw) } catch { return undefined }
            },
          } as unknown as CompactionRouteDeps),
        ),
    )
    .route('/soul', createSoulRoutes())
    .route('/memory', createMemoryRoutes())
    .route('/skills/sources', createSkillSourcesRoutes())
    .route('/skills', createSkillsRoutes())
    .route('/test-provider', createProviderRoutes({ browserosId }))
    .route('/refine-prompt', createRefinePromptRoutes({ browserosId }))
    .route(
      '/oauth',
      tokenManager
        ? createOAuthRoutes({ tokenManager })
        : new Hono().all('/*', (c) =>
            c.json({ error: 'OAuth not available' }, 503),
          ),
    )
    .route('/klavis', createKlavisRoutes({ browserosId: browserosId || '' }))
    .route(
      '/credits',
      createCreditsRoutes({
        browserosId,
        gatewayBaseUrl: INLINED_ENV.BROWSEROS_CONFIG_URL
          ? new URL(INLINED_ENV.BROWSEROS_CONFIG_URL).origin
          : undefined,
      }),
    )
    .route(
      '/mcp',
      createMcpRoutes({
        version,
        registry,
        browser,
        executionDir,
        resourcesDir,
        klavisRef,
      }),
    )
    .route(
      '/chat',
      createChatRoutes({
        browser,
        registry,
        browserosId,
        klavisRef,
        aiSdkDevtoolsEnabled: config.aiSdkDevtoolsEnabled,
        compaction: config.compaction,
        sessionStore: sharedChatSessionStore,
      }),
    )
  // Error handler
  app.onError((err, c) => {
    const error = err as Error

    if (error instanceof HttpAgentError) {
      logger.warn('HTTP Agent Error', {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
      })
      return c.json(error.toJSON(), error.statusCode as ContentfulStatusCode)
    }

    Sentry.withScope((scope) => {
      scope.setTag('route', c.req.path)
      scope.setTag('method', c.req.method)
      Sentry.captureException(error)
    })

    logger.error('Unhandled Error', {
      message: error.message,
      stack: error.stack,
    })

    return c.json(
      {
        error: {
          name: 'InternalServerError',
          message: error.message || 'An unexpected error occurred',
          code: 'INTERNAL_SERVER_ERROR',
          statusCode: 500,
        },
      },
      500,
    )
  })

  await assertPortAvailable(port)

  const server = Bun.serve({
    fetch: (request, server) => app.fetch(request, { server }),
    port,
    hostname: host,
    idleTimeout: 0,
    websocket,
  })

  logger.info('Consolidated HTTP Server started', { port, host })

  if (config.aiSdkDevtoolsEnabled) {
    logger.info(
      'AI SDK DevTools enabled — run `npx @ai-sdk/devtools` to open the viewer',
    )
  }

  return {
    app,
    server,
    config,
  }
}
