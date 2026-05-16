import { describe, expect, it } from 'bun:test'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

async function exists(path: string): Promise<boolean> {
  return !!(await stat(path).catch(() => null))
}

describe('grader python script layout', () => {
  it('keeps runtime evaluator scripts next to the grader implementation', async () => {
    const pythonDir = resolve(import.meta.dir, '../../src/graders/python')
    const scriptsDir = resolve(import.meta.dir, '../../scripts')

    // Both locations have the scripts — scripts/ is the runtime path used by graders,
    // src/graders/python/ is the source of truth that gets copied during builds.
    expect(await exists(resolve(pythonDir, 'agisdk-evaluate.py'))).toBe(true)
    expect(await exists(resolve(pythonDir, 'infinity-evaluate.py'))).toBe(true)
    expect(await exists(resolve(scriptsDir, 'agisdk-evaluate.py'))).toBe(true)
    expect(await exists(resolve(scriptsDir, 'infinity-evaluate.py'))).toBe(
      true,
    )
  })
})
