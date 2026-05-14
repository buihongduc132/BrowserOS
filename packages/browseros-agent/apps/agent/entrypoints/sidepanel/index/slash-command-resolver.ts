/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Slash command parsing and template resolution utilities.
 * Used by Chat.tsx to resolve /command inputs before sending.
 */

export interface ParsedCommand {
  /** The command name without leading slash */
  name: string
  /** Everything after the command name */
  args: string
  /** Positional arguments (split by whitespace) */
  positional: string[]
}

export interface CommandResolution {
  /** The resolved text to send to the LLM */
  text: string
  /** Model override (if specified and available) */
  modelOverride?: string
  /** Built-in action type (null for custom/message commands) */
  actionType: 'clear' | 'compact' | 'reset' | 'message' | null
}

/**
 * Parse a raw input string to detect a slash command.
 * Returns null if the input is not a slash command.
 */
export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  // Match: /commandName [args]
  const match = trimmed.match(/^\/([a-z0-9-]+)(?:\s+(.*))?$/is)
  if (!match) return null

  const name = match[1]
  const args = match[2] ?? ''
  const positional = args.trim() ? args.trim().split(/\s+/) : []

  return { name: name.toLowerCase(), args, positional }
}

/**
 * Resolve a template with arguments.
 * Supports: $ARGUMENTS, $1, $2, etc.
 */
export function resolveTemplate(
  template: string,
  parsed: ParsedCommand,
): string {
  // Single-pass replacement to avoid sequential corruption
  return template.replace(/\$(ARGUMENTS|\d+)/g, (match) => {
    if (match === '$ARGUMENTS') return parsed.args
    const idx = Number.parseInt(match.slice(1), 10) - 1
    return idx >= 0 && idx < parsed.positional.length
      ? parsed.positional[idx]
      : match
  })
}

/**
 * Check if a model ID is available in the current providers list.
 */
export function isModelAvailable(
  modelId: string | undefined,
  availableModels: string[],
): boolean {
  if (!modelId) return false
  return availableModels.some((m) => m.toLowerCase() === modelId.toLowerCase())
}

/**
 * Built-in command action types.
 */
export const BUILTIN_ACTION_TYPES = {
  clear: 'clear' as const,
  compact: 'compact' as const,
  reset: 'reset' as const,
  message: 'message' as const,
}

/**
 * Known built-in command names.
 */
export const BUILTIN_COMMAND_NAMES = new Set([
  'clear',
  'compact',
  'reset',
  'help',
])
