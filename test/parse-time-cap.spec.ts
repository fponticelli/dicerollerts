import { describe, test, expect } from 'vitest'
import { ProgramParser } from '../src/program-parser'
import { Evaluator } from '../src/evaluator'
import { DiceParser } from '../src/dice-parser'
import { DE } from '../src/dice-expression-domain'
import type {
  DiceExpression,
  DiceReduce,
  DiceFilterable,
} from '../src/dice-expression'

function topReduceable(expr: DiceExpression) {
  if (expr.type !== 'dice-reduce') {
    throw new Error(`expected dice-reduce, got ${expr.type}`)
  }
  return (expr as DiceReduce).reduceable
}

describe('compact parsing of large counts', () => {
  test('100000d6 max parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000d6 max')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('homogeneous-dice-expressions')
    if (red.type === 'homogeneous-dice-expressions') {
      expect(red.count).toEqual({ kind: 'literal', value: 100000 })
      expect(red.sides).toEqual({ kind: 'literal', value: 6 })
    }
  })

  test('100000d6 sum (default reducer) parses compactly', () => {
    const r = DiceParser.parseWithErrors('100000d6 sum')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('homogeneous-dice-expressions')
  })

  test('100000d6 keep 1 parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000d6 keep 1')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('dice-list-with-filter')
    if (red.type === 'dice-list-with-filter') {
      const list: DiceFilterable = red.list
      expect(list.type).toBe('filterable-homogeneous')
      if (list.type === 'filterable-homogeneous') {
        expect(list.count).toEqual({ kind: 'literal', value: 100000 })
        expect(list.sides).toEqual({ kind: 'literal', value: 6 })
      }
    }
  })

  test('100000d6 explode on 6 parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000d6 explode on 6')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('dice-list-with-map-homogeneous')
    if (red.type === 'dice-list-with-map-homogeneous') {
      expect(red.count).toEqual({ kind: 'literal', value: 100000 })
      expect(red.sides).toEqual({ kind: 'literal', value: 6 })
      expect(red.functor.type).toBe('explode')
    }
  })

  test('100000d10c6 (count shorthand) parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000d10c6')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('homogeneous-dice-expressions')
    if (red.type === 'homogeneous-dice-expressions') {
      expect(red.count).toEqual({ kind: 'literal', value: 100000 })
      expect(red.sides).toEqual({ kind: 'literal', value: 10 })
    }
  })

  test('100000dF parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000dF')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('homogeneous-custom-dice')
    if (red.type === 'homogeneous-custom-dice') {
      expect(red.count).toEqual({ kind: 'literal', value: 100000 })
      expect(red.faces).toEqual([-1, 0, 1])
    }
  })

  test('100000dF keep 5 parses without expansion', () => {
    const r = DiceParser.parseWithErrors('100000dF keep 5')
    expect(r.success).toBe(true)
    if (!r.success) return
    const red = topReduceable(r.value)
    expect(red.type).toBe('dice-list-with-filter')
    if (red.type === 'dice-list-with-filter') {
      expect(red.list.type).toBe('filterable-homogeneous-custom')
    }
  })

  test('huge count rejected at evaluation, not parse', () => {
    const r = ProgramParser.parse('`100000d6 keep 1`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 1)
    expect(() => ev.run(r.program)).toThrow(/exceeds maximum/i)
  })

  test('huge count for explode rejected at evaluation, not parse', () => {
    const r = ProgramParser.parse('`100000d6 explode on 6`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 1)
    expect(() => ev.run(r.program)).toThrow(/exceeds maximum/i)
  })

  test('reasonable counts work end to end with keep', () => {
    const r = ProgramParser.parse('`4d6 drop 1`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 1)
    expect(ev.run(r.program)).toBe(3) // min: 1+1+1+1 -> drop one -> 3
  })

  test('Nd6 max with reasonable N works', () => {
    const r = ProgramParser.parse('`100d6 max`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator((max) => max)
    expect(ev.run(r.program)).toBe(6)
  })

  test('Nd6 min with reasonable N works', () => {
    const r = ProgramParser.parse('`100d6 min`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator((max) => max)
    expect(ev.run(r.program)).toBe(6)
  })

  test('NdF reasonable count works end to end', () => {
    const r = ProgramParser.parse('`5dF`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 3) // last face = 1
    // 5 dice all rolling face index 3 -> face value 1, summed = 5
    expect(ev.run(r.program)).toBe(5)
  })

  test('rendering preserves compact homogeneous form', () => {
    expect(DE.toString(DiceParser.parseOrNull('100000d6 max')!)).toBe(
      '100000d6 max',
    )
    expect(DE.toString(DiceParser.parseOrNull('100000d6 keep 1')!)).toBe(
      '100000d6 keep 1',
    )
    expect(DE.toString(DiceParser.parseOrNull('100000d6 explode on 6')!)).toBe(
      '100000d6 explode on 6',
    )
    expect(DE.toString(DiceParser.parseOrNull('100000dF')!)).toBe('100000dF')
  })
})

describe('parametric count with modifiers', () => {
  test('$nD6 keep 1 parses with parametric count', () => {
    const parsed = DiceParser.parseOrNull('$nD6 keep 1')!
    expect(parsed.type).toBe('dice-reduce')
    if (parsed.type !== 'dice-reduce') return
    const red = parsed.reduceable
    expect(red.type).toBe('dice-list-with-filter')
    if (red.type === 'dice-list-with-filter') {
      expect(red.list.type).toBe('filterable-homogeneous')
      if (red.list.type === 'filterable-homogeneous') {
        expect(red.list.count).toEqual({ kind: 'variable', name: 'n' })
        expect(red.list.sides).toEqual({ kind: 'literal', value: 6 })
      }
    }
  })

  test('$nD6 max parses with parametric count', () => {
    const parsed = DiceParser.parseOrNull('$nD6 max')!
    expect(parsed.type).toBe('dice-reduce')
    if (parsed.type !== 'dice-reduce') return
    const red = parsed.reduceable
    expect(red.type).toBe('homogeneous-dice-expressions')
    if (red.type === 'homogeneous-dice-expressions') {
      expect(red.count).toEqual({ kind: 'variable', name: 'n' })
      expect(red.sides).toEqual({ kind: 'literal', value: 6 })
    }
  })

  test('$nD6 explode on 6 parses with parametric count', () => {
    const parsed = DiceParser.parseOrNull('$nD6 explode on 6')!
    expect(parsed.type).toBe('dice-reduce')
    if (parsed.type !== 'dice-reduce') return
    const red = parsed.reduceable
    expect(red.type).toBe('dice-list-with-map-homogeneous')
    if (red.type === 'dice-list-with-map-homogeneous') {
      expect(red.count).toEqual({ kind: 'variable', name: 'n' })
      expect(red.sides).toEqual({ kind: 'literal', value: 6 })
    }
  })

  test('$nDF parses with parametric count', () => {
    const parsed = DiceParser.parseOrNull('$nDF')!
    // Bare `$nDF` is wrapped in dice-reduce sum to roll a homogeneous custom.
    expect(parsed.type).toBe('dice-reduce')
    if (parsed.type !== 'dice-reduce') return
    const red = parsed.reduceable
    expect(red.type).toBe('homogeneous-custom-dice')
    if (red.type === 'homogeneous-custom-dice') {
      expect(red.count).toEqual({ kind: 'variable', name: 'n' })
      expect(red.faces).toEqual([-1, 0, 1])
    }
  })

  test('$nD6c4 parses parametric count shorthand', () => {
    const parsed = DiceParser.parseOrNull('$nD6c4')!
    expect(parsed.type).toBe('dice-reduce')
    if (parsed.type !== 'dice-reduce') return
    const red = parsed.reduceable
    expect(red.type).toBe('homogeneous-dice-expressions')
  })

  test('$nD6 keep 1 evaluates end to end', () => {
    const r = ProgramParser.parse('$n = `d6`\n`$nD6 keep 1`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator((max) => max)
    const result = ev.run(r.program) as number
    // $n = 6 (max d6), then 6d6 keep 1 (highest of 6 = 6)
    expect(result).toBe(6)
  })

  test('$nD6 max evaluates end to end', () => {
    const r = ProgramParser.parse('$n = `d6`\n`$nD6 max`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator((max) => max)
    const result = ev.run(r.program) as number
    expect(result).toBe(6)
  })

  test('$nD6 explode on 6 evaluates end to end with min roller', () => {
    const r = ProgramParser.parse('$n = 3\n`$nD6 explode once on 6`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 1)
    const result = ev.run(r.program) as number
    // 3d6 each = 1, no explode -> 3
    expect(result).toBe(3)
  })

  test('parametric count is rejected at eval if too large', () => {
    const r = ProgramParser.parse('$n = 99999\n`$nD6 keep 1`')
    expect(r.success).toBe(true)
    if (!r.success) return
    const ev = new Evaluator(() => 1)
    expect(() => ev.run(r.program)).toThrow(/exceeds maximum/i)
  })
})
