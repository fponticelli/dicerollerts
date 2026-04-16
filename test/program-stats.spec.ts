import { ProgramParser } from '../src/program-parser'
import { ProgramStats } from '../src/program-stats'
import type { Program } from '../src/program'

function parseProgram(input: string): Program {
  const result = ProgramParser.parse(input)
  if (!result.success) throw new Error('Parse failed')
  return result.program
}

describe('program stats', () => {
  test('simple number distribution', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('number')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(3.5, 0)
      expect(result.stats.min).toBe(1)
      expect(result.stats.max).toBe(6)
    }
  })

  test('record distribution', () => {
    const prog = parseProgram(
      '$roll = `d20`\n{ attack: $roll, doubled: $roll * 2 }',
    )
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('record')
    if (result.stats.type === 'record') {
      expect(result.stats.fields.attack.type).toBe('number')
      expect(result.stats.fields.doubled.type).toBe('number')
      if (result.stats.fields.attack.type === 'number')
        expect(result.stats.fields.attack.mean).toBeCloseTo(10.5, 0)
    }
  })

  test('conditional probability', () => {
    const prog = parseProgram(
      `$roll = \`d20\`\n$hit = $roll >= 11\n$damage = if $hit then \`2d6\` else 0\n{ damage: $damage }`,
    )
    const result = ProgramStats.analyze(prog, { trials: 50000 })
    expect(result.stats.type).toBe('record')
    if (
      result.stats.type === 'record' &&
      result.stats.fields.damage.type === 'number'
    ) {
      expect(result.stats.fields.damage.mean).toBeCloseTo(3.5, 0)
      expect(result.stats.fields.damage.min).toBe(0)
    }
  })

  test('boolean distribution', () => {
    const prog = parseProgram('`d6` >= 4')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('boolean')
    if (result.stats.type === 'boolean')
      expect(result.stats.truePercent).toBeCloseTo(0.5, 1)
  })

  test('array distribution', () => {
    const prog = parseProgram('repeat 3 { `d6` }')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('array')
    if (result.stats.type === 'array')
      expect(result.stats.elements).toHaveLength(3)
  })

  test('string frequency', () => {
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('string')
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('hit')).toBeCloseTo(0.5, 1)
      expect(result.stats.frequencies.get('miss')).toBeCloseTo(0.5, 1)
    }
  })
})

describe('analysis tiers', () => {
  test('constant program detected', () => {
    const prog = parseProgram('5 + 3')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBe(8)
      expect(result.stats.stddev).toBe(0)
    }
  })

  test('constant with variables', () => {
    const prog = parseProgram('$x = 5\n$y = $x * 2\n$y')
    expect(ProgramStats.classify(prog)).toBe('constant')
  })

  test('exact for single dice expression', () => {
    const prog = parseProgram('`d6`')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(3.5)
      expect(result.stats.distribution.get(1)).toBeCloseTo(1 / 6)
    }
  })

  test('monte-carlo for record output', () => {
    const prog = parseProgram('$x = `d6`\n{ a: $x, b: $x }')
    expect(ProgramStats.classify(prog)).toBe('monte-carlo')
  })

  test('exact for 3d6 (single dice expression)', () => {
    const prog = parseProgram('`3d6`')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(10.5)
      expect(result.stats.min).toBe(3)
      expect(result.stats.max).toBe(18)
    }
  })

  test('monte-carlo with conditional', () => {
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    expect(ProgramStats.classify(prog)).toBe('monte-carlo')
    const result = ProgramStats.analyze(prog, {
      maxTrials: 5000,
      batchSize: 500,
    })
    expect(result.strategy.tier).toBe('monte-carlo')
    expect(result.strategy.trials).toBeDefined()
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('hit')).toBeCloseTo(0.5, 1)
    }
  })

  test('constant boolean program', () => {
    const prog = parseProgram('true')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'boolean') {
      expect(result.stats.truePercent).toBe(1)
    }
  })

  test('constant array program', () => {
    const prog = parseProgram('[1, 2, 3]')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'array') {
      expect(result.stats.elements).toHaveLength(3)
      if (result.stats.elements[0].type === 'number') {
        expect(result.stats.elements[0].mean).toBe(1)
        expect(result.stats.elements[0].stddev).toBe(0)
      }
    }
  })

  test('monte-carlo with adaptive convergence', () => {
    // A tame program: should converge before maxTrials.
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    const result = ProgramStats.analyze(prog, {
      maxTrials: 50000,
      minTrials: 1000,
      batchSize: 1000,
      targetRelativeError: 0.02,
    })
    expect(result.strategy.tier).toBe('monte-carlo')
    expect(result.strategy.trials).toBeGreaterThanOrEqual(1000)
    expect(result.strategy.trials).toBeLessThanOrEqual(50000)
  })
})
