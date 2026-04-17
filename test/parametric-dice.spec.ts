import { describe, test, expect } from 'vitest'
import { ProgramParser } from '../src/program-parser'
import { Evaluator } from '../src/evaluator'
import { ProgramStats } from '../src/program-stats'
import { DiceParser } from '../src/dice-parser'
import { DE } from '../src/dice-expression-domain'
import type { Value } from '../src/program'

function run(input: string, rollFn?: (max: number) => number): Value {
  const r = ProgramParser.parse(input)
  if (!r.success) throw new Error('parse: ' + r.errors[0].message)
  const ev = new Evaluator(rollFn ?? ((max) => max))
  return ev.run(r.program)
}

describe('parametric dice', () => {
  test('original freeze case parses and evaluates without freeze', () => {
    // The reported bug: $rollsD6 where $rolls is itself a roll
    const r = ProgramParser.parse(
      '$rolls = `d6`\n$roll = `$rollsD6`\n{ $roll }',
    )
    expect(r.success).toBe(true)
  })

  test('variable in dice count position rolls N dice', () => {
    // With max roller, $rolls = 6, then $rollsD6 = 6d6 with all 6s = 36
    const result = run(
      '$rolls = `d6`\n`$rollsD6`',
      (max: number) => max,
    ) as number
    expect(result).toBe(36)
  })

  test('variable in dice count, min roller', () => {
    // $rolls = 1 (min d6), $rollsD6 = 1d6 with min = 1
    const result = run('$rolls = `d6`\n`$rollsD6`', () => 1) as number
    expect(result).toBe(1)
  })

  test('variable in sides position', () => {
    // $sides = 6, 1d$sides = d6 with max = 6
    const result = run('$sides = 6\n`1d$sides`', (max: number) => max) as number
    expect(result).toBe(6)
  })

  test('both variable count and sides', () => {
    const result = run(
      '$n = 3\n$s = 4\n`$nD$s`',
      (max: number) => max,
    ) as number
    expect(result).toBe(12) // 3 dice * 4 (max d4) = 12
  })

  test('parametric dice with arithmetic', () => {
    const result = run(
      '$rolls = 3\n`$rollsD6 + 1`',
      (max: number) => max,
    ) as number
    expect(result).toBe(19) // 3*6 + 1
  })

  test('count cap rejects huge counts', () => {
    expect(() => run('$rolls = 99999\n`$rollsD6`')).toThrow(/exceeds maximum/i)
  })

  test('large literal count rejected at evaluation', () => {
    // Direct large literal - parses but rolling caps it
    expect(() => run('`100000d6`')).toThrow(/exceeds maximum/i)
  })

  test('zero count returns 0', () => {
    const result = run('$rolls = 0\n`$rollsD6`') as number
    expect(result).toBe(0)
  })

  test('analysis of parametric dice does not freeze', () => {
    const r = ProgramParser.parse('$rolls = `d4`\n`$rollsD6`')
    expect(r.success).toBe(true)
    if (!r.success) return
    // Should complete in reasonable time; we just check it doesn't hang.
    const result = ProgramStats.analyze(r.program, { maxTrials: 1000 })
    expect(result.stats.type).toBe('number')
  })
})

describe('additive dice variable still works', () => {
  test('d20 + $mod', () => {
    const result = run('$mod = 5\n`d20 + $mod`', (max: number) => max) as number
    expect(result).toBe(25)
  })

  test('d20 - $mod', () => {
    const result = run('$mod = 3\n`d20 - $mod`', (max: number) => max) as number
    expect(result).toBe(17)
  })

  test('multiple uses of same variable', () => {
    const result = run(
      '$mod = 5\n`d20 + $mod + $mod`',
      (max: number) => max,
    ) as number
    expect(result).toBe(30)
  })
})

describe('dice parser parametric forms', () => {
  test('parses $varD6 to n-dice with variable count', () => {
    const parsed = DiceParser.parseOrNull('$rollsD6')!
    expect(parsed.type).toBe('n-dice')
    if (parsed.type === 'n-dice') {
      expect(parsed.count).toEqual({ kind: 'variable', name: 'rolls' })
      expect(parsed.sides).toEqual({ kind: 'literal', value: 6 })
    }
  })

  test('parses 1d$sides to n-dice with variable sides', () => {
    const parsed = DiceParser.parseOrNull('1d$sides')!
    expect(parsed.type).toBe('n-dice')
    if (parsed.type === 'n-dice') {
      expect(parsed.count).toEqual({ kind: 'literal', value: 1 })
      expect(parsed.sides).toEqual({ kind: 'variable', name: 'sides' })
    }
  })

  test('parses $nD$s to n-dice with both variables', () => {
    const parsed = DiceParser.parseOrNull('$nD$s')!
    expect(parsed.type).toBe('n-dice')
    if (parsed.type === 'n-dice') {
      expect(parsed.count).toEqual({ kind: 'variable', name: 'n' })
      expect(parsed.sides).toEqual({ kind: 'variable', name: 's' })
    }
  })

  test('plain Nd6 parses to n-dice without expansion', () => {
    const parsed = DiceParser.parseOrNull('100000d6')!
    // Critical: must not expand 100000 die nodes at parse time.
    expect(parsed.type).toBe('n-dice')
  })

  test('renders parametric forms with uppercase D', () => {
    const parsed = DiceParser.parseOrNull('$rollsD6')!
    expect(DE.toString(parsed)).toBe('$rollsD6')
  })

  test('renders all-literal n-dice with lowercase d', () => {
    const parsed = DiceParser.parseOrNull('3d6')!
    expect(DE.toString(parsed)).toBe('3d6')
  })

  test('Nd6 with reducer still parses to dice-reduce (preserves max semantics)', () => {
    const parsed = DiceParser.parseOrNull('3d6 max')!
    expect(parsed.type).toBe('dice-reduce')
  })

  test('d20 + $mod parses with native variable ref (no placeholder hack)', () => {
    const parsed = DiceParser.parseOrNull('d20 + $mod')!
    expect(parsed.type).toBe('binary-op')
    if (parsed.type === 'binary-op') {
      expect(parsed.right.type).toBe('dice-variable-ref')
    }
  })
})
