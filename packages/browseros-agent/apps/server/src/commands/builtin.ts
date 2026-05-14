/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Built-in slash command definitions.
 */

import type { BuiltinCommandDef } from './types'

const BUILTIN_COMMANDS: BuiltinCommandDef[] = [
  {
    id: 'clear',
    name: '/clear',
    description: 'Clear conversation history',
    action: 'clear',
  },
  {
    id: 'compact',
    name: '/compact',
    description: 'Trigger compaction using current config',
    action: 'compact',
  },
  {
    id: 'mode',
    name: '/mode',
    description: 'Switch chat mode (chat / agent)',
    action: 'mode',
  },
  {
    id: 'model',
    name: '/model',
    description: 'Switch model',
    action: 'model',
  },
  {
    id: 'help',
    name: '/help',
    description: 'Show available commands',
    action: 'help',
  },
  {
    id: 'reset',
    name: '/reset',
    description: 'Reset conversation and context',
    action: 'reset',
  },
]

export function getBuiltinCommands(): BuiltinCommandDef[] {
  return BUILTIN_COMMANDS
}
