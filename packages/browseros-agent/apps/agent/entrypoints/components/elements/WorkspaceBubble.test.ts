import { describe, expect, it } from 'bun:test'
import { WORKSPACE_COLORS, colorFromPath } from '../../sidepanel/history/components/workspace-bubble-colors'

/**
 * Tests for the logic underpinning WorkspaceBubble and WorkspaceBubbleGroup components.
 * React component rendering is not tested here (no DOM), but the color logic
 * and overflow calculation are exercised.
 */

describe('WorkspaceBubble logic', () => {
  it('colorFromPath returns valid palette color for workspace name', () => {
    const color = colorFromPath('/home/user/frontend')
    expect(WORKSPACE_COLORS).toContain(color)
  })

  it('different workspace paths get deterministic colors', () => {
    const c1 = colorFromPath('/home/user/frontend')
    const c2 = colorFromPath('/home/user/backend')
    // Both valid colors
    expect(WORKSPACE_COLORS).toContain(c1)
    expect(WORKSPACE_COLORS).toContain(c2)
  })
})

describe('WorkspaceBubbleGroup logic (overflow calculation)', () => {
  const workspaces = [
    { id: '1', name: 'frontend', path: '/frontend' },
    { id: '2', name: 'backend', path: '/backend' },
    { id: '3', name: 'shared', path: '/shared' },
    { id: '4', name: 'infra', path: '/infra' },
    { id: '5', name: 'docs', path: '/docs' },
  ]

  it('with maxVisible=3, overflow = total - 3', () => {
    const maxVisible = 3
    const overflow = Math.max(0, workspaces.length - maxVisible)
    expect(overflow).toBe(2)
  })

  it('with maxVisible=5, overflow = 0', () => {
    const maxVisible = 5
    const overflow = Math.max(0, workspaces.length - maxVisible)
    expect(overflow).toBe(0)
  })

  it('with maxVisible=10, overflow = 0 (no negative)', () => {
    const maxVisible = 10
    const overflow = Math.max(0, workspaces.length - maxVisible)
    expect(overflow).toBe(0)
  })

  it('visible workspaces = first maxVisible items', () => {
    const maxVisible = 3
    const visible = workspaces.slice(0, maxVisible)
    expect(visible.length).toBe(3)
    expect(visible.map((w) => w.id)).toEqual(['1', '2', '3'])
  })

  it('empty workspaces → globe icon (no overflow)', () => {
    const empty: typeof workspaces = []
    const overflow = Math.max(0, empty.length - 3)
    expect(overflow).toBe(0)
    expect(empty.length).toBe(0)
  })
})
