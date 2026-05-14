/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Slash command autocomplete popover for ChatInput.
 * Uses cmdk Command component for rendering.
 * Groups commands into "Built-in" and "Custom" sections.
 * Filters by plain includes() on name + description.
 */

import { useEffect, useRef } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export interface SlashCommandItem {
  id: string
  name: string
  description: string
  builtIn: boolean
}

interface SlashCommandMenuProps {
  commands: SlashCommandItem[]
  filterText: string
  onSelect: (command: SlashCommandItem) => void
  onClose: () => void
  isOpen: boolean
  /** DOM rect for anchor positioning */
  anchorRect: DOMRect | null
}

export function SlashCommandMenu({
  commands,
  filterText,
  onSelect,
  onClose,
  isOpen,
  anchorRect,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!menuRef.current?.contains(target) && !target.closest('textarea')) {
        onClose()
      }
    }

    // Use mousedown so we catch it before the textarea's own handlers
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onClose])

  if (!isOpen || !anchorRect) return null

  const lowerFilter = filterText.toLowerCase()

  const filtered = lowerFilter
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerFilter) ||
          cmd.description.toLowerCase().includes(lowerFilter),
      )
    : commands

  const builtInCommands = filtered.filter((c) => c.builtIn)
  const customCommands = filtered.filter((c) => !c.builtIn)

  // Position below the anchor
  const top = anchorRect.bottom + 4
  const left = Math.min(anchorRect.left, window.innerWidth - 280)

  return (
    <div
      ref={menuRef}
      data-slot="slash-command-menu"
      role="listbox"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 50,
      }}
      className="fade-in-0 zoom-in-95 slide-in-from-top-2 w-72 animate-in rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
    >
      <Command
        className="rounded-md"
        onKeyDown={(e) => {
          // Stop propagation so ChatInput doesn't also handle these
          if (
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'Enter' ||
            e.key === 'Tab'
          ) {
            e.stopPropagation()
          }
        }}
      >
        <CommandList className="max-h-[200px]">
          <CommandEmpty>No commands found</CommandEmpty>
          {builtInCommands.length > 0 ? (
            <CommandGroup heading="Built-in">
              {builtInCommands.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.name}
                  onSelect={() => onSelect(cmd)}
                  className="cursor-pointer"
                >
                  <span className="font-mono text-xs">{cmd.name}</span>
                  <span className="ml-2 truncate text-muted-foreground text-xs">
                    {cmd.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {customCommands.length > 0 ? (
            <CommandGroup heading="Custom">
              {customCommands.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.name}
                  onSelect={() => onSelect(cmd)}
                  className="cursor-pointer"
                >
                  <span className="font-mono text-xs">{cmd.name}</span>
                  <span className="ml-2 truncate text-muted-foreground text-xs">
                    {cmd.description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </div>
  )
}
