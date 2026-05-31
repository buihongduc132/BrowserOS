/**
 * Stub skills routes — skills runtime was unshipped.
 * This module provides an empty router so the server can start.
 */

import { Hono } from 'hono'
import type { Env } from '../server'

export function createSkillsRoutes(): Hono<Env> {
  return new Hono<Env>()
}
