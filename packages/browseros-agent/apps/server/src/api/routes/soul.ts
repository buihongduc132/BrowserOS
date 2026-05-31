/** Stub soul routes — soul module not yet merged to this branch. */

import { Hono } from 'hono'
import type { Env } from '../server'

export function createSoulRoutes(): Hono<Env> {
  return new Hono<Env>()
}
