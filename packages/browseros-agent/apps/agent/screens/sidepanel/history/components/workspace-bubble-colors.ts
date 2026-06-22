/**
 * Color palette for workspace bubbles.
 * 8 distinct colors chosen for accessibility (distinct from each other).
 */
export const WORKSPACE_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
] as const

export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number]

/**
 * Deterministic color from a path string.
 * Uses a simple hash to pick from the palette.
 */
export function colorFromPath(path: string): WorkspaceColor {
  let hash = 0
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0 // Convert to 32bit integer
  }
  // Use absolute value to avoid negative indices
  const index = Math.abs(hash) % WORKSPACE_COLORS.length
  return WORKSPACE_COLORS[index]
}
