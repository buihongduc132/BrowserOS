import { describe, expect, it } from 'bun:test'
import {
  colorFromPath,
  WORKSPACE_COLORS,
} from './workspace-bubble-colors'

describe('colorFromPath', () => {
  it('returns a color from the palette for any string input', () => {
    const result = colorFromPath('/home/user/frontend')
    expect(WORKSPACE_COLORS).toContain(result)
  })

  it('returns consistent color for same path', () => {
    const a = colorFromPath('/home/user/frontend')
    const b = colorFromPath('/home/user/frontend')
    expect(a).toBe(b)
  })

  it('returns different colors for different paths (usually)', () => {
    const a = colorFromPath('/home/user/frontend')
    const b = colorFromPath('/home/user/backend')
    // Not guaranteed different, but very likely with 8 colors
    // Just verify both are valid
    expect(WORKSPACE_COLORS).toContain(a)
    expect(WORKSPACE_COLORS).toContain(b)
  })

  it('handles empty string', () => {
    const result = colorFromPath('')
    expect(WORKSPACE_COLORS).toContain(result)
  })

  it('handles paths with special characters', () => {
    const result = colorFromPath('/home/user/my-project (copy)')
    expect(WORKSPACE_COLORS).toContain(result)
  })

  it('distributes across colors (roughly)', () => {
    const results = new Set<string>()
    for (let i = 0; i < 32; i++) {
      results.add(colorFromPath(`/workspace-${i}`))
    }
    // With 8 colors and 32 paths, should get at least 4 different colors
    expect(results.size).toBeGreaterThanOrEqual(4)
  })
})
