/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Command loader — scans disk for custom command .md files.
 * Mirrors skills/loader.ts pattern. Also loads from external directories
 * configured via commands.externalDirs in server.json.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'
import { getCommandsDir } from '../lib/browseros-dir'
import { logger } from '../lib/logger'
import { getBuiltinCommands } from './builtin'
import type { CommandFrontmatter, CommandMeta } from './types'

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath)
    return s.isDirectory()
  } catch {
    return false
  }
}

export function isValidCommandFrontmatter(
  data: unknown,
): data is CommandFrontmatter {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.description === 'string' && d.description.length > 0
}

async function parseCommandFile(
  mdPath: string,
  id: string,
  builtIn: boolean,
): Promise<CommandMeta | null> {
  try {
    const content = await readFile(mdPath, 'utf-8')
    const { data } = matter(content)

    if (!isValidCommandFrontmatter(data)) {
      logger.warn('Command missing required frontmatter (description)', {
        path: mdPath,
        id,
      })
      return null
    }

    return {
      id,
      name: `/${id}`,
      description: data.description,
      location: mdPath,
      enabled: data.enabled !== false,
      builtIn,
      model: typeof data.model === 'string' ? data.model : undefined,
    }
  } catch (err) {
    logger.warn('Failed to parse command', {
      path: mdPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Scan a flat directory of .md files (one file = one command) */
async function scanCommandDir(
  dir: string,
  builtIn: boolean,
): Promise<CommandMeta[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const commands: CommandMeta[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const mdPath = join(dir, entry)
    const id = entry.replace(/\.md$/, '')
    const cmd = await parseCommandFile(mdPath, id, builtIn)
    if (cmd) commands.push(cmd)
  }

  return commands
}

/** Read externalDirs from server.json config */
async function readExternalDirs(): Promise<string[]> {
  try {
    const { getServerConfigPath } = await import('../lib/browseros-dir')
    const configPath = getServerConfigPath()
    const raw = await readFile(configPath, 'utf-8')
    const { parse: parseJson } = JSON
    // try-catch above handles parse errors
    const config = parseJson(raw) as Record<string, unknown>
    const dirs = config?.commands?.externalDirs
    if (Array.isArray(dirs))
      return dirs.filter((d: unknown) => typeof d === 'string')
  } catch {
    // Config file may not exist or lack the field
  }
  return []
}

/** Load commands from external directories configured in server.json */
async function loadExternalCommands(): Promise<CommandMeta[]> {
  const dirs = await readExternalDirs()
  const commands: CommandMeta[] = []

  for (const dir of dirs) {
    if (!(await isDirectory(dir))) {
      logger.debug('External commands dir does not exist, skipping', { dir })
      continue
    }
    const cmds = await scanCommandDir(dir, false)
    commands.push(...cmds)
  }

  return commands
}

/** Built-in commands as CommandMeta (hardcoded, no file on disk) */
function loadBuiltinCommandMetas(): CommandMeta[] {
  return getBuiltinCommands().map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    location: 'builtin',
    enabled: true,
    builtIn: true,
  }))
}

/**
 * Load all commands with priority: user dir > external dirs > built-in.
 * Later sources override earlier ones by id (Map-based dedup).
 */
export async function loadAllCommands(): Promise<CommandMeta[]> {
  const byId = new Map<string, CommandMeta>()

  // Lowest priority: built-in
  for (const cmd of loadBuiltinCommandMetas()) {
    byId.set(cmd.id, cmd)
  }

  // External dirs (override built-in)
  for (const cmd of await loadExternalCommands()) {
    byId.set(cmd.id, cmd)
  }

  // Highest priority: user commands dir (~/.browseros/commands/)
  for (const cmd of await scanCommandDir(getCommandsDir(), false)) {
    byId.set(cmd.id, cmd)
  }

  return Array.from(byId.values())
}
