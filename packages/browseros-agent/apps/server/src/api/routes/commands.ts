/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * REST API routes for slash commands — mirrors skills routes.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  updateCommand,
} from '../../commands/service'

const CreateCommandSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  content: z.string().min(1).max(50_000),
})

const UpdateCommandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  content: z.string().max(50_000).optional(),
  enabled: z.boolean().optional(),
})

export function createCommandsRoutes() {
  return new Hono()
    .get('/', async (c) => {
      const commands = await listCommands()
      return c.json({ commands })
    })
    .get('/:id', async (c) => {
      const command = await getCommand(c.req.param('id'))
      if (!command) return c.json({ error: 'Command not found' }, 404)
      return c.json({ command })
    })
    .post('/', zValidator('json', CreateCommandSchema), async (c) => {
      try {
        const command = await createCommand(c.req.valid('json'))
        return c.json({ command }, 201)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create'
        return c.json({ error: msg }, 400)
      }
    })
    .put('/:id', zValidator('json', UpdateCommandSchema), async (c) => {
      try {
        const command = await updateCommand(
          c.req.param('id'),
          c.req.valid('json'),
        )
        return c.json({ command })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update'
        const status = msg.includes('not found')
          ? 404
          : msg.includes('built-in')
            ? 403
            : 500
        return c.json({ error: msg }, status)
      }
    })
    .delete('/:id', async (c) => {
      try {
        await deleteCommand(c.req.param('id'))
        return c.json({ ok: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to delete'
        const status = msg.includes('not found')
          ? 404
          : msg.includes('built-in')
            ? 403
            : 500
        return c.json({ error: msg }, status)
      }
    })
}
