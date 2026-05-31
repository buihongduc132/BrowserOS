/**
 * Stub ACL routes — governance ACL runtime was unshipped (PR #1045).
 * This module provides an empty router so the server can start.
 * Re-enable when governance ACL is re-introduced.
 */

import { Hono } from 'hono'
import type { Env } from '../server'

interface AclRouteDeps {
  policyService: unknown
}

export function createAclRoutes(_deps: AclRouteDeps): Hono<Env> {
  return new Hono<Env>()
}
