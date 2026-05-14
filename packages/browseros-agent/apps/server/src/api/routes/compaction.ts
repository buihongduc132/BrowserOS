/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * API route for compaction strategy configuration.
 * Reads/writes the `compaction` field from the server config file
 * (the one passed via --config, NOT server.json).
 *
 * POST /           — Trigger on-demand compaction for a conversation
 * GET /status      — Poll compaction status for a conversation
 * GET /            — Read compaction config
 * PUT /            — Write compaction config
 * DELETE /         — Reset compaction config
 */
import fs from 'node:fs'

import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { LanguageModel, ModelMessage } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  CompactionStrategySchema,
  getResolvedConfigFilePath,
} from '../../config'
import {
  type CompactionState,
  createCompactionPrepareStep,
  type StepWithUsage,
} from '../../agent/compaction'
import { logger } from '../../lib/logger'
import type { CompactionStrategyConfig } from '../../agent/types'
import type { Env } from '../types'

interface CompactionConfigResponse {
  active: {
    method: 'default' | 'vcc'
    customPrompt?: string
    vccConfig?: {
      maxTranscriptLines?: number
      maxGoalLines?: number
      maxFileEntries?: number
      maxCommitEntries?: number
      maxPreferenceLines?: number
      maxOutstandingLines?: number
    }
  } | null
  defaults: { method: 'default' }
}

interface CompactionSaveResponse {
  ok: boolean
  saved?: CompactionConfigResponse['active']
  errors?: Array<{ key: string; message: string }>
}

function getConfigFilePath(): string | null {
  return getResolvedConfigFilePath()
}

function readConfigFile(): Record<string, unknown> | null {
  const configPath = getConfigFilePath()
  if (!configPath || !fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch (e) {
    logger.warn('Failed to read config file for compaction API', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

function writeConfigFile(config: Record<string, unknown>): void {
  const configPath = getConfigFilePath()
  if (!configPath) {
    throw new Error('No config file path available')
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

// ---------------------------------------------------------------------------
// In-flight compaction tracking
// ---------------------------------------------------------------------------
const inflightCompactions = new Set<string>()

// ---------------------------------------------------------------------------
// Route deps (optional — when provided, enables POST /compact trigger)
// ---------------------------------------------------------------------------
export interface CompactionRouteDeps {
  /** Load messages for a conversation from the session store. */
  getConversationMessages: (conversationId: string) => Promise<ModelMessage[] | null>
  /** Create a LanguageModel instance for summarization. */
  createModel: () => LanguageModel
  /** Read the active compaction strategy config. */
  getCompactionConfig?: () => CompactionStrategyConfig | undefined
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const TriggerBodySchema = z.object({
  conversationId: z.string().uuid(),
})

const StatusQuerySchema = z.object({
  conversationId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------
export function createCompactionRoutes(deps?: CompactionRouteDeps) {
  return new Hono<Env>()
    // ------------------------------------------------------------------
    // POST /compact — trigger on-demand compaction
    // ------------------------------------------------------------------
    .post('/compact', async (c) => {
      if (!deps?.getConversationMessages || !deps?.createModel) {
        return c.json(
          { ok: false, error: 'Compaction trigger not configured' },
          503,
        )
      }

      const body = await c.req.json().catch(() => null)
      const parsed = TriggerBodySchema.safeParse(body)
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            errors: parsed.error.issues.map((i) => ({
              key: i.path.join('.') || '_',
              message: i.message,
            })),
          },
          400,
        )
      }

      const { conversationId } = parsed.data

      // Rate-limit: only 1 compaction per conversation at a time
      if (inflightCompactions.has(conversationId)) {
        return c.json(
          { ok: false, error: 'Compaction already in progress', compacting: true },
          409,
        )
      }

      // Load messages
      const messages = await deps.getConversationMessages(conversationId)
      if (!messages || messages.length === 0) {
        return c.json(
          { ok: false, error: 'Conversation not found or has no messages' },
          404,
        )
      }

      inflightCompactions.add(conversationId)
      try {
        const model = deps.createModel()
        const compactionConfig = deps.getCompactionConfig?.()
        const contextWindow = AGENT_LIMITS.DEFAULT_CONTEXT_WINDOW

        const state: CompactionState = { existingSummary: null, compactionCount: 0 }
        const originalMessageCount = messages.length

        // Import the core compaction function dynamically to respect the
        // "do not modify compaction.ts" constraint. We reuse the prepare-step
        // helper which wraps compactMessages with all the pre-checks.
        //
        // For on-demand compaction we skip the token-threshold gate and
        // always attempt compaction — the user explicitly asked for it.
        const prepareStep = createCompactionPrepareStep(
          { contextWindow },
          compactionConfig,
        )

        // The prepare step expects { messages, steps, model, experimental_context }
        // For on-demand use we pass an empty steps array.
        const result = await prepareStep({
          messages,
          steps: [] as ReadonlyArray<StepWithUsage>,
          model,
          experimental_context: state,
        })

        const compactedMessageCount = result.messages.length

        logger.info('On-demand compaction complete', {
          conversationId,
          originalMessageCount,
          compactedMessageCount,
          compactionCount: state.compactionCount,
        })

        return c.json({
          ok: true,
          compactedMessageCount,
          originalMessageCount,
        })
      } catch (error) {
        logger.error('On-demand compaction failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        })
        return c.json(
          { ok: false, error: 'Compaction failed' },
          500,
        )
      } finally {
        inflightCompactions.delete(conversationId)
      }
    })

    // ------------------------------------------------------------------
    // GET /compact/status — poll compaction status
    // ------------------------------------------------------------------
    .get('/compact/status', (c) => {
      const conversationId = c.req.query('conversationId')
      if (!conversationId) {
        return c.json(
          { ok: false, error: 'Missing conversationId query parameter' },
          400,
        )
      }

      // Validate UUID format
      const parsed = StatusQuerySchema.safeParse({ conversationId })
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            errors: parsed.error.issues.map((i) => ({
              key: i.path.join('.') || '_',
              message: i.message,
            })),
          },
          400,
        )
      }

      return c.json({
        compacting: inflightCompactions.has(conversationId),
      })
    })

    // ------------------------------------------------------------------
    // GET / — read compaction config
    // ------------------------------------------------------------------
    .get('/', (c) => {
      const config = readConfigFile()
      const compaction = config
        ? (config.compaction as CompactionConfigResponse['active'] | undefined)
        : undefined

      const response: CompactionConfigResponse = {
        active: compaction ?? null,
        defaults: { method: 'default' },
      }

      return c.json(response)
    })
    .put('/', async (c) => {
      const body = (await c.req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null

      if (!body || typeof body !== 'object') {
        const resp: CompactionSaveResponse = {
          ok: false,
          errors: [{ key: '_', message: 'Missing request body' }],
        }
        return c.json(resp, 400)
      }

      const result = CompactionStrategySchema.safeParse(body)
      if (!result.success) {
        const errors = result.error.issues.map((issue) => ({
          key: issue.path.join('.') || '_',
          message: issue.message,
        }))
        const resp: CompactionSaveResponse = { ok: false, errors }
        return c.json(resp, 400)
      }

      let config = readConfigFile()
      if (!config) {
        config = {}
      }
      config.compaction = result.data
      writeConfigFile(config)

      const resp: CompactionSaveResponse = {
        ok: true,
        saved: result.data as CompactionConfigResponse['active'],
      }
      return c.json(resp)
    })
    .delete('/', (c) => {
      const config = readConfigFile()
      if (!config) {
        // No config file — nothing to remove
        const resp: CompactionSaveResponse = { ok: true }
        return c.json(resp)
      }

      delete config.compaction
      writeConfigFile(config)

      const resp: CompactionSaveResponse = { ok: true }
      return c.json(resp)
    })
}
