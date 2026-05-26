/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Command CRUD service — mirrors skills/service.ts exactly.
 * Custom commands are stored as flat .md files in ~/.browseros/commands/.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import matter from 'gray-matter'
import { getCommandsDir } from '../lib/browseros-dir'
import { logger } from '../lib/logger'
import { getBuiltinCommands } from './builtin'
import { isValidCommandFrontmatter, loadAllCommands } from './loader'
import type {
  CommandDetail,
  CommandFrontmatter,
  CommandMeta,
  CreateCommandInput,
  ParsedCommand,
  ResolvedCommand,
  UpdateCommandInput,
} from './types'

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^[/]+/, '') // strip leading slashes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function safeCommandPath(id: string): string {
  const commandsDir = getCommandsDir()
  const resolved = resolve(commandsDir, `${id}.md`)
  if (!resolved.startsWith(`${commandsDir}${sep}`)) {
    throw new Error('Invalid command id')
  }
  return resolved
}

function buildCommandMd(
  frontmatter: CommandFrontmatter,
  content: string,
): string {
  return matter.stringify(content, frontmatter)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a command id refers to a built-in command.
 */
function isBuiltinId(id: string): boolean {
  return getBuiltinCommands().some((c) => c.id === id)
}

/**
 * Resolve command file location: user dir first, then built-in.
 */
async function resolveCommandLocation(
  id: string,
): Promise<{ path: string; builtIn: boolean } | null> {
  const userPath = safeCommandPath(id)
  if (await fileExists(userPath)) {
    return { path: userPath, builtIn: false }
  }
  // Built-in commands don't have files on disk
  if (isBuiltinId(id)) {
    return { path: 'builtin', builtIn: true }
  }
  return null
}

export async function listCommands(): Promise<CommandMeta[]> {
  return loadAllCommands()
}

export async function getCommand(id: string): Promise<CommandDetail | null> {
  const resolved = await resolveCommandLocation(id)
  if (!resolved) return null

  // Built-in commands have no file content
  if (resolved.builtIn) {
    const builtin = getBuiltinCommands().find((c) => c.id === id)
    if (!builtin) return null
    return {
      id: builtin.id,
      name: builtin.name,
      description: builtin.description,
      location: 'builtin',
      enabled: true,
      builtIn: true,
      content: '',
    }
  }

  try {
    const raw = await readFile(resolved.path, 'utf-8')
    const parsed = matter(raw)

    if (!isValidCommandFrontmatter(parsed.data)) {
      logger.warn('Command has invalid frontmatter', { id })
      return null
    }

    return {
      id,
      name: `/${id}`,
      description: parsed.data.description,
      location: resolved.path,
      enabled: parsed.data.enabled !== false,
      builtIn: false,
      model:
        typeof parsed.data.model === 'string' ? parsed.data.model : undefined,
      content: parsed.content.trim(),
    }
  } catch (err) {
    logger.warn('Failed to read command', {
      id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function createCommand(
  input: CreateCommandInput,
): Promise<CommandMeta> {
  const id = slugify(input.name)
  if (!id) throw new Error('Invalid command name')

  if (await fileExists(safeCommandPath(id))) {
    throw new Error(`Command "${id}" already exists`)
  }

  const dirPath = getCommandsDir()
  await mkdir(dirPath, { recursive: true })

  const frontmatter: CommandFrontmatter = {
    description: input.description,
  }
  if (input.model) {
    frontmatter.model = input.model
  }

  const filePath = safeCommandPath(id)
  await writeFile(filePath, buildCommandMd(frontmatter, input.content))

  return {
    id,
    name: `/${id}`,
    description: input.description,
    location: filePath,
    enabled: true,
    builtIn: false,
    model: input.model,
  }
}

export async function updateCommand(
  id: string,
  input: UpdateCommandInput,
): Promise<CommandMeta> {
  const resolved = await resolveCommandLocation(id)
  if (!resolved) throw new Error(`Command "${id}" not found`)
  if (resolved.builtIn) throw new Error('Cannot update built-in command')

  const raw = await readFile(resolved.path, 'utf-8')
  const parsed = matter(raw)
  if (!isValidCommandFrontmatter(parsed.data)) {
    throw new Error(`Command "${id}" has invalid frontmatter`)
  }

  const existing = parsed.data
  const description = input.description ?? existing.description
  const content = input.content ?? parsed.content.trim()
  const model = input.model ?? existing.model
  const enabled = input.enabled ?? (existing.enabled !== false)

  const frontmatter: CommandFrontmatter = {
    description,
    enabled,
  }
  if (model) {
    frontmatter.model = model
  }

  await writeFile(resolved.path, buildCommandMd(frontmatter, content))

  return {
    id,
    name: `/${id}`,
    description,
    location: resolved.path,
    enabled,
    builtIn: false,
    model,
  }
}

export async function deleteCommand(id: string): Promise<void> {
  if (isBuiltinId(id)) throw new Error('Cannot delete built-in command')

  const resolved = await resolveCommandLocation(id)
  if (!resolved) throw new Error(`Command "${id}" not found`)
  if (resolved.builtIn) throw new Error('Cannot delete built-in command')

  await rm(resolved.path)
}

// ─── Command Resolution (Chat Submit) ──────────────────────

/**
 * Parse a chat input to see if it's a /command invocation.
 * Returns null if the input is not a command.
 */
export function parseCommandInput(input: string): ParsedCommand {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return null

  // Avoid treating URLs as commands (e.g., https://example.com)
  const beforeSlash = input.slice(0, input.indexOf(trimmed))
  if (beforeSlash.length > 0 && !/^\s*$/.test(beforeSlash)) return null

  const match = /^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s.exec(trimmed)
  if (!match) return null

  return {
    commandName: match[1],
    args: match[2] ?? '',
  }
}

/**
 * Resolve a command template, replacing placeholders.
 * $ARGUMENTS → all args as single string
 * $1, $2, ... → positional args (split by whitespace)
 * !`cmd` → literal text, NO shell execution
 */
export function resolveTemplate(template: string, args: string): string {
  // Single-pass replacement to avoid sequential corruption
  // e.g., if $ARGUMENTS value contains "$2", sequential would corrupt it
  const parts = args ? args.split(/\s+/) : []
  return template.replace(/\$(ARGUMENTS|\d+)/g, (match) => {
    if (match === '$ARGUMENTS') return args
    const idx = Number.parseInt(match.slice(1), 10) - 1
    return idx >= 0 && idx < parts.length ? parts[idx] : match
  })
}

/**
 * Fully resolve a command: parse input, look up command, resolve template,
 * determine model override.
 */
export async function resolveCommand(
  commandId: string,
  args: string,
  availableModels?: string[],
): Promise<ResolvedCommand> {
  // Try to load custom command from disk
  const detail = await getCommand(commandId)

  let template: string
  let modelOverride: string | null = null

  if (detail?.content) {
    // Custom command with template
    template = resolveTemplate(detail.content, args)
    if (detail.model) {
      if (!availableModels || availableModels.includes(detail.model)) {
        modelOverride = detail.model
      }
      // else: model not available → fallback to current (null override)
    }
  } else {
    // Built-in or no template — pass args through
    template = args
  }

  return { resolvedTemplate: template, modelOverride }
}
