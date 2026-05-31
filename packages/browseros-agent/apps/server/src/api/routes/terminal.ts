/**
 * Stub terminal routes — terminal/OpenClaw runtime was unshipped.
 * This module provides an empty router so the server can start.
 */

import { Hono } from 'hono'
import type { Env } from '../server'

interface TerminalRouteDeps {
  containerName: string
  limaHome: string
}

export function createTerminalRoutes(_deps: TerminalRouteDeps): Hono<Env> {
  return new Hono<Env>()
}
