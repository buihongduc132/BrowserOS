/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Slash command types — mirrors skills/types.ts pattern.
 */

/** Frontmatter for custom command .md files (OpenCode-whitelisted fields, v1) */
export type CommandFrontmatter = {
  description: string
  model?: string
  /** Whether the command is active; defaults to true when absent */
  enabled?: boolean
  /** Deferred fields — accepted but not processed at runtime in v1 */
  agent?: string
  subtask?: boolean
}

export type CommandMeta = {
  id: string
  name: string
  description: string
  location: string
  enabled: boolean
  builtIn: boolean
  model?: string
}

export type CommandDetail = CommandMeta & {
  content: string
}

export type CreateCommandInput = {
  name: string
  description: string
  content: string
  model?: string
}

export type UpdateCommandInput = Partial<CreateCommandInput> & {
  enabled?: boolean
}

/** Result of parsing a /command from chat input */
export type ParsedCommand = {
  commandName: string
  args: string
} | null

/** Result of resolving a command template */
export type ResolvedCommand = {
  resolvedTemplate: string
  modelOverride: string | null
}

/** Built-in command definition */
export type BuiltinCommandDef = {
  id: string
  name: string
  description: string
  /** Action type for client-side handling */
  action: 'clear' | 'compact' | 'mode' | 'model' | 'help' | 'reset'
}
