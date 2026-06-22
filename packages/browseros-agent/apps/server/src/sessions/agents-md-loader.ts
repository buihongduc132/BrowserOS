/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { logger } from '../lib/logger'

/**
 * Result of loading an AGENTS.md file from a workspace.
 */
export interface AgentsMdResult {
  /** Absolute path to the AGENTS.md file */
  path: string
  /** File contents (UTF-8) */
  content: string
  /** File mtime in epoch milliseconds */
  lastModified: number
}

const AGENTS_MD_FILENAME = 'AGENTS.md'
const MAX_AGENTS_MD_SIZE = 100_000 // 100KB

/**
 * Loads AGENTS.md files from workspace directories with:
 * - Path allowlist (only registered workspaces)
 * - Symlink escape detection
 * - Size limit (100KB)
 * - mtime-based cache
 */
export class AgentsMdLoader {
  private cache = new Map<string, { content: string; mtime: number }>()
  private workspaceAllowlist: Set<string>

  constructor(registeredPaths: string[]) {
    this.workspaceAllowlist = new Set(registeredPaths.map((p) => resolve(p)))
  }

  /**
   * Load AGENTS.md from a workspace path.
   * Returns null if: not in allowlist, file missing, file too large,
   * symlink escape detected, or any I/O error.
   */
  async load(workspacePath: string): Promise<AgentsMdResult | null> {
    const resolvedWorkspace = resolve(workspacePath)

    // Security check 1: workspace must be in allowlist
    if (!this.workspaceAllowlist.has(resolvedWorkspace)) {
      logger.debug('AgentsMdLoader: path not in allowlist', {
        path: resolvedWorkspace,
      })
      return null
    }

    const filePath = join(resolvedWorkspace, AGENTS_MD_FILENAME)

    try {
      // Resolve symlinks for security
      let realFilePath: string
      try {
        realFilePath = await realpath(filePath)
      } catch {
        // File doesn't exist
        return null
      }

      // Security check 2: resolved path must still be within the workspace
      const realWorkspace = await realpath(resolvedWorkspace)
      if (
        !realFilePath.startsWith(`${realWorkspace}/`) &&
        realFilePath !== join(realWorkspace, AGENTS_MD_FILENAME)
      ) {
        logger.warn('AgentsMdLoader: symlink escape detected', {
          workspace: resolvedWorkspace,
          resolvedPath: realFilePath,
          realWorkspace,
        })
        return null
      }

      const fileStat = await stat(realFilePath)

      // Security check 3: file size limit
      if (fileStat.size > MAX_AGENTS_MD_SIZE) {
        logger.debug('AgentsMdLoader: file too large', {
          path: realFilePath,
          size: fileStat.size,
          max: MAX_AGENTS_MD_SIZE,
        })
        return null
      }

      // Cache check: return cached content if mtime unchanged
      const cached = this.cache.get(resolvedWorkspace)
      if (cached && cached.mtime === fileStat.mtimeMs) {
        return {
          path: realFilePath,
          content: cached.content,
          lastModified: fileStat.mtimeMs,
        }
      }

      // Read file
      const content = await readFile(realFilePath, 'utf-8')

      // Update cache
      this.cache.set(resolvedWorkspace, {
        content,
        mtime: fileStat.mtimeMs,
      })

      return {
        path: realFilePath,
        content,
        lastModified: fileStat.mtimeMs,
      }
    } catch (error) {
      logger.debug('AgentsMdLoader: failed to load', {
        path: resolvedWorkspace,
        error: String(error),
      })
      return null
    }
  }

  /**
   * Load AGENTS.md from multiple workspaces. Filters out nulls.
   */
  async loadMultiple(workspaces: string[]): Promise<AgentsMdResult[]> {
    if (workspaces.length === 0) return []

    const results = await Promise.all(workspaces.map((w) => this.load(w)))
    return results.filter((r): r is AgentsMdResult => r !== null)
  }

  /**
   * Update the allowlist (e.g., when user adds/removes workspaces).
   */
  updateAllowlist(paths: string[]): void {
    this.workspaceAllowlist = new Set(paths.map((p) => resolve(p)))
  }

  /**
   * Check if a path is in the allowlist.
   */
  isAllowed(workspacePath: string): boolean {
    return this.workspaceAllowlist.has(resolve(workspacePath))
  }
}
