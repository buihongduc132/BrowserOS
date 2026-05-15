/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'

/**
 * Tests for sessionId parameterization in agents.ts routes.
 *
 * These test the resolveSessionId helper which is extracted from
 * the route handlers for testability. The actual HTTP route integration
 * would require spinning up Hono — tested via service-level tests instead.
 */
describe('resolveSessionId', () => {
  // Import the helper under test
  const { resolveSessionId } = require('./agents')

  it('returns "main" when no header provided', () => {
    expect(resolveSessionId(undefined)).toBe('main')
  })

  it('returns "main" when empty string header', () => {
    expect(resolveSessionId('')).toBe('main')
  })

  it('returns custom session ID from header', () => {
    expect(resolveSessionId('my-custom-session')).toBe('my-custom-session')
  })

  it('returns "main" for whitespace-only header', () => {
    expect(resolveSessionId('   ')).toBe('main')
  })

  it('preserves UUID session ID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(resolveSessionId(uuid)).toBe(uuid)
  })
})
