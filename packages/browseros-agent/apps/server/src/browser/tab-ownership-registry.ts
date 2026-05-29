/**
 * TabOwnershipRegistry — tracks which conversation/agent owns which page.
 *
 * Lives on the Browser class (singleton) so all MCP request-servers
 * share the same ownership state. This prevents double-claiming and
 * allows concurrent conversations to coordinate tab usage.
 *
 * Usage:
 *   const registry = new TabOwnershipRegistry()
 *   registry.claim('conv-1', pageId, 'agent-A')  // claim ownership
 *   registry.isLocked(pageId)                      // true
 *   registry.release('conv-1', pageId)             // release
 */

export interface OwnershipEntry {
  ownerConversationId: string
  ownerAgentId?: string
  lockedAt: number
  lastActivityAt: number
}

/** Callback fired when the idle sweep releases a lock. */
export type LockReleasedCallback = (
  pageId: number,
  entry: OwnershipEntry,
) => void

export class TabOwnershipRegistry {
  /** Map<pageId, OwnershipEntry> */
  _entries = new Map<number, OwnershipEntry>()

  /** Callback invoked when the idle sweep releases a lock. */
  onLockReleased?: LockReleasedCallback

  /** Handle for the periodic idle sweep timer. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  /** Default idle timeout: 1 hour (3600000ms). */
  static readonly DEFAULT_IDLE_TIMEOUT_MS = 3_600_000

  /** Default sweep interval: 60 seconds (60000ms). */
  static readonly DEFAULT_SWEEP_INTERVAL_MS = 60_000

  /**
   * Claim ownership of a page for a conversation.
   * Returns true if the claim succeeded, false if already owned by another conversation.
   * Re-claiming by the same conversation succeeds (idempotent).
   */
  claim(conversationId: string, pageId: number, agentId?: string): boolean {
    const existing = this._entries.get(pageId)

    // Idempotent: same conversation can re-claim
    if (existing && existing.ownerConversationId === conversationId) {
      // Update agentId if provided
      if (agentId !== undefined) {
        existing.ownerAgentId = agentId
      }
      existing.lastActivityAt = Date.now()
      return true
    }

    // Already owned by someone else
    if (existing) {
      return false
    }

    // Fresh claim
    const now = Date.now()
    this._entries.set(pageId, {
      ownerConversationId: conversationId,
      ownerAgentId: agentId,
      lockedAt: now,
      lastActivityAt: now,
    })
    return true
  }

  /**
   * Release ownership of a page.
   * Only the owning conversation can release. Returns true if released.
   */
  release(conversationId: string, pageId: number): boolean {
    const existing = this._entries.get(pageId)
    if (!existing) return false
    if (existing.ownerConversationId !== conversationId) return false

    this._entries.delete(pageId)
    return true
  }

  /**
   * Check if a page is currently locked (owned by any conversation).
   */
  isLocked(pageId: number): boolean {
    return this._entries.has(pageId)
  }

  /**
   * Get the ownership info for a page, or null if unowned.
   */
  getOwner(pageId: number): OwnershipEntry | null {
    return this._entries.get(pageId) ?? null
  }

  /**
   * Release all locks that have been idle beyond the given threshold.
   * Returns the number of locks released.
   */
  releaseIdle(maxIdleMs: number): number {
    const now = Date.now()
    let released = 0

    for (const [pageId, entry] of this._entries) {
      if (now - entry.lastActivityAt > maxIdleMs) {
        this._entries.delete(pageId)
        released++
      }
    }

    return released
  }

  /**
   * Refresh the lastActivityAt timestamp for a page.
   * No-op if the page is not locked.
   */
  refreshActivity(pageId: number): void {
    const entry = this._entries.get(pageId)
    if (entry) {
      entry.lastActivityAt = Date.now()
    }
  }

  /**
   * Release all locks held by a specific conversation.
   * Returns the number of locks released.
   */
  releaseAllForConversation(conversationId: string): number {
    let released = 0
    for (const [pageId, entry] of this._entries) {
      if (entry.ownerConversationId === conversationId) {
        this._entries.delete(pageId)
        released++
      }
    }
    return released
  }

  // ── Idle Sweep ──

  /**
   * Start a periodic sweep that auto-releases idle locks.
   *
   * @param idleTimeoutMs - Locks idle beyond this are released (default: 1 hour)
   * @param sweepIntervalMs - How often to check (default: 60 seconds)
   */
  startIdleSweep(
    idleTimeoutMs: number = TabOwnershipRegistry.DEFAULT_IDLE_TIMEOUT_MS,
    sweepIntervalMs: number = TabOwnershipRegistry.DEFAULT_SWEEP_INTERVAL_MS,
  ): void {
    // Stop any existing sweep first (idempotent restart)
    this.stopIdleSweep()

    this.sweepTimer = setInterval(() => {
      // Collect entries before deletion so callback gets valid data
      const toRelease: Array<{ pageId: number; entry: OwnershipEntry }> = []
      const now = Date.now()

      for (const [pageId, entry] of this._entries) {
        if (now - entry.lastActivityAt > idleTimeoutMs) {
          toRelease.push({ pageId, entry })
        }
      }

      for (const { pageId, entry } of toRelease) {
        this._entries.delete(pageId)
        this.onLockReleased?.(pageId, entry)
      }
    }, sweepIntervalMs)

    // Prevent the timer from keeping the process alive
    if (
      this.sweepTimer &&
      typeof this.sweepTimer === 'object' &&
      'unref' in this.sweepTimer
    ) {
      this.sweepTimer.unref()
    }
  }

  /**
   * Stop the idle sweep timer.
   */
  stopIdleSweep(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  /**
   * Check if the idle sweep timer is currently active.
   */
  isSweepActive(): boolean {
    return this.sweepTimer !== null
  }
}
