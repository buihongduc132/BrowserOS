/**
 * Ownership enforcement helper for tool handlers.
 *
 * Before a tool executes on a page, call `enforceOwnership(ctx, pageId)`:
 *   - If the page is unowned → auto-claim for this conversation
 *   - If owned by the same conversation → refresh activity
 *   - If owned by another conversation → warn (non-strict) or reject (strict)
 *
 * The calling tool handler should check `result.allowed` before proceeding.
 */

import type { ToolContext } from './framework'

export interface OwnershipResult {
  allowed: boolean
  warning?: string
  error?: string
}

/**
 * Check or claim tab ownership for a tool operation.
 *
 * @param ctx - The tool context (must have browser + optional session)
 * @param pageId - The page being operated on
 * @returns OwnershipResult indicating whether the operation is allowed
 */
export function enforceOwnership(
  ctx: ToolContext,
  pageId: number,
): OwnershipResult {
  const registry = ctx.browser.tabOwnership
  if (!registry) {
    // No registry — no enforcement
    return { allowed: true }
  }

  const conversationId = ctx.session?.conversationId
  if (!conversationId) {
    // No conversation context (legacy MCP without session) — allow but don't claim
    return { allowed: true }
  }

  // If page is not locked, auto-claim it
  if (!registry.isLocked(pageId)) {
    const claimed = registry.claim(conversationId, pageId)
    if (!claimed) {
      // Race condition: someone else claimed between our check and claim
      // Fall through to conflict handling
    } else {
      return { allowed: true }
    }
  }

  const owner = registry.getOwner(pageId)

  // Page is owned by us — refresh and proceed
  if (owner && owner.ownerConversationId === conversationId) {
    registry.refreshActivity(pageId)
    return { allowed: true }
  }

  // Page is owned by someone else
  const isStrict = (ctx as Record<string, unknown>).strictOwnership === true

  if (isStrict) {
    return {
      allowed: false,
      error: `Page ${pageId} is locked by conversation ${owner?.ownerConversationId}. Use list_pages to find unlocked tabs.`,
    }
  }

  return {
    allowed: true,
    warning: `Page ${pageId} is already controlled by conversation ${owner?.ownerConversationId}. Proceeding in non-strict mode.`,
  }
}
