/** Stub memory routes — memory module not yet merged to this branch. */

import { Hono } from 'hono'
import type { Env } from '../server'

export function createMemoryRoutes(): Hono<Env> {
  return new Hono<Env>()
}
