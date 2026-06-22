import { describe, expect, it, vi } from 'bun:test'

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) =>
    args.filter((a) => typeof a === 'string' && a.length > 0).join(' '),
}))

const _mod = await import('react')

describe('test', () => {
  it('works', () => {
    expect(1 + 1).toBe(2)
  })
})
