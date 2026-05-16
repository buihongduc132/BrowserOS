import type { GraderResult } from '../types'
import { AgisdkStateDiffGrader } from './benchmark/agisdk-state-diff'
import { InfinityStateGrader } from './benchmark/infinity-state'
import { PerformanceGrader } from './performance/performance-grader'
import type { Grader, GraderInput } from './types'

interface GraderOptions {
  apiKey: string
  baseUrl?: string
  model?: string
}

export function createGrader(
  name: string,
  options: GraderOptions | null,
): Grader | null {
  switch (name) {
    // Deterministic benchmark graders (no LLM judge)
    case 'agisdk_state_diff':
      return new AgisdkStateDiffGrader()
    case 'infinity_state':
      return new InfinityStateGrader()

    // Multi-axis performance grader (Claude Agent SDK — uses its own Claude default model)
    case 'performance_grader':
      return new PerformanceGrader()

    default:
      console.warn(`Unknown grader: ${name}`)
      return null
  }
}

export async function runGraders(
  graderNames: string[],
  input: GraderInput,
  options: GraderOptions | null,
): Promise<Record<string, GraderResult>> {
  const results: Record<string, GraderResult> = {}

  for (const name of graderNames) {
    const grader = createGrader(name, options)
    if (grader) {
      try {
        console.log(`  Running grader: ${name}`)
        results[name] = await grader.grade(input)
      } catch (error) {
        results[name] = {
          score: 0,
          pass: false,
          reasoning: `Error running grader: ${error}`,
        }
      }
    }
  }

  return results
}

// Export grader classes for direct use
export {
  AgisdkStateDiffGrader,
  InfinityStateGrader,
  PerformanceGrader,
}
