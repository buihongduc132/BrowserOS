/**
 * @public
 */
export interface GlowMessage {
  conversationId: string
  isActive: boolean
  showConfetti?: boolean
  /** Name of the agent controlling this tab */
  agentName?: string
  /** Whether this tab is locked by a conversation */
  lockHeld?: boolean
  /** Owner conversation info */
  controlledBy?: {
    conversationId: string
    agentId?: string
  }
}
