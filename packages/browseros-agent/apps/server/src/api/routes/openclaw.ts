/**
 * Stub OpenClaw routes — OpenClaw runtime was unshipped.
 * This module provides an empty router so the server can start.
 */

import { Hono } from 'hono'
import type { Env } from '../server'

export function createOpenClawRoutes(): Hono<Env> {
  return new Hono<Env>()
}
