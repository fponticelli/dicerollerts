import { ProgramParser } from '../src/program-parser'
import { ProgramStats } from '../src/program-stats'
import type { AsyncProgress } from '../src/program-stats'
import type { Program } from '../src/program'

function parse(input: string): Program {
  const r = ProgramParser.parse(input)
  if (!r.success) throw new Error('parse failed')
  return r.program
}

describe('ProgramStats.analyzeAsync', () => {
  test('constant tier yields once', async () => {
    const prog = parse('1 + 2')
    const yields: AsyncProgress[] = []
    for await (const p of ProgramStats.analyzeAsync(prog)) {
      yields.push(p)
    }
    expect(yields.length).toBe(1)
    expect(yields[0].trials).toBe(0)
    expect(yields[0].converged).toBe(true)
  })

  test('exact tier yields once', async () => {
    const prog = parse('`d6`')
    const yields: AsyncProgress[] = []
    for await (const p of ProgramStats.analyzeAsync(prog)) {
      yields.push(p)
    }
    expect(yields.length).toBe(1)
    expect(yields[0].trials).toBe(0)
    expect(yields[0].converged).toBe(true)
    expect(yields[0].stats.type).toBe('number')
  })

  test('monte-carlo yields multiple progress updates', async () => {
    const prog = parse('if `d20` >= 11 then `2d6 explode on 6` else 0')
    const yields: number[] = []
    for await (const p of ProgramStats.analyzeAsync(prog, {
      batchSize: 500,
      yieldEvery: 500,
      minTrials: 5000,
      maxTrials: 5000,
    })) {
      yields.push(p.trials)
    }
    expect(yields.length).toBeGreaterThan(1)
    // Trials should be strictly increasing
    for (let i = 1; i < yields.length; i++) {
      expect(yields[i]).toBeGreaterThan(yields[i - 1])
    }
    // Final yield should reach the requested maximum
    expect(yields[yields.length - 1]).toBe(5000)
  })

  test('final yield has converged=true if it converged', async () => {
    const prog = parse('if `d6` >= 4 then 1 else 0')
    let last: AsyncProgress | undefined
    for await (const p of ProgramStats.analyzeAsync(prog)) {
      last = p
    }
    expect(last).toBeDefined()
    if (last) expect(last.converged).toBe(true)
  })

  test('progress snapshot stats are valid FieldStats', async () => {
    // Use explode (always) to force MC tier so we get periodic snapshots.
    const prog = parse('if `d20` >= 11 then `2d6 explode on 6` else 0')
    const yields: AsyncProgress[] = []
    for await (const p of ProgramStats.analyzeAsync(prog, {
      batchSize: 500,
      yieldEvery: 500,
      minTrials: 1000,
      maxTrials: 2000,
    })) {
      yields.push(p)
    }
    expect(yields.length).toBeGreaterThan(0)
    for (const y of yields) {
      expect(y.stats.type).toBe('number')
      if (y.stats.type === 'number') {
        expect(y.stats.mean).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('AbortSignal cancels analysis', async () => {
    const prog = parse('if `d20` >= 11 then `2d6 explode on 6` else 0')
    const controller = new AbortController()

    const yields: number[] = []
    let aborted = false
    let abortName: string | undefined
    try {
      for await (const p of ProgramStats.analyzeAsync(prog, {
        signal: controller.signal,
        batchSize: 100,
        yieldEvery: 100,
        minTrials: 1_000_000,
        maxTrials: 1_000_000,
      })) {
        yields.push(p.trials)
        if (yields.length === 2) controller.abort()
      }
    } catch (e) {
      aborted = true
      abortName = (e as Error).name
    }
    expect(aborted).toBe(true)
    expect(abortName).toBe('AbortError')
    // We should have at least the two yields before abort fired
    expect(yields.length).toBeGreaterThanOrEqual(2)
  })

  test('AbortSignal already aborted before start throws', async () => {
    const prog = parse('`d6`')
    const controller = new AbortController()
    controller.abort()
    let thrown: Error | null = null
    try {
      for await (const _ of ProgramStats.analyzeAsync(prog, {
        signal: controller.signal,
      })) {
        // no-op
      }
    } catch (e) {
      thrown = e as Error
    }
    expect(thrown).not.toBeNull()
    expect(thrown?.name).toBe('AbortError')
  })

  test('fixed trials mode yields progress and completes', async () => {
    // Use explode (always) to defeat exact analysis and force MC tier.
    const prog = parse('if `d20` >= 11 then `2d6 explode on 6` else 0')
    const yields: number[] = []
    for await (const p of ProgramStats.analyzeAsync(prog, {
      trials: 2000,
      batchSize: 500,
      yieldEvery: 500,
    })) {
      yields.push(p.trials)
    }
    expect(yields.length).toBeGreaterThan(1)
    expect(yields[yields.length - 1]).toBe(2000)
  })
})

describe('ProgramStats.analyze with AbortSignal', () => {
  test('aborted signal throws on entry to MC', () => {
    const prog = parse('if `d20` >= 11 then `2d6 explode on 6` else 0')
    const controller = new AbortController()
    controller.abort()
    let thrown: Error | null = null
    try {
      ProgramStats.analyze(prog, {
        signal: controller.signal,
        maxTrials: 100,
      })
    } catch (e) {
      thrown = e as Error
    }
    expect(thrown).not.toBeNull()
    expect(thrown?.name).toBe('AbortError')
  })
})
