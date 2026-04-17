import {
  diceReduce,
  diceExpressions,
  die,
  literal,
  exact,
  between,
  valueOrMore,
  valueOrLess,
} from '../src/dice-expression'
import type { CountReducer, Range } from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'
import { DiceParser } from '../src/dice-parser'
import { DiceStats } from '../src/dice-stats'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

function countReducer(range: Range): CountReducer {
  return { type: 'count', thresholds: [range] }
}

describe('dice pool / success counting', () => {
  test('count successes >= 6 on 4d10, all max', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    expect(RR.getResult(maxRoller().roll(expr))).toBe(4)
  })

  test('count successes >= 6 on 4d10, all min', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    expect(RR.getResult(minRoller().roll(expr))).toBe(0)
  })

  test('count exact matches', () => {
    const expr = diceReduce(
      diceExpressions(literal(5), literal(3), literal(5)),
      countReducer(exact(5)),
    )
    expect(RR.getResult(minRoller().roll(expr))).toBe(2)
  })

  test('count with value or less', () => {
    const expr = diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      countReducer(valueOrLess(2)),
    )
    expect(RR.getResult(minRoller().roll(expr))).toBe(2)
  })

  test('toString renders count >= N', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    expect(DE.toString(expr)).toBe('4d10 count >= 6')
  })

  test('toString renders count = N', () => {
    const expr = diceReduce(
      diceExpressions(literal(5), literal(3)),
      countReducer(exact(5)),
    )
    expect(DE.toString(expr)).toBe('(5,3) count = 5')
  })

  test('toString renders count <= N', () => {
    const expr = diceReduce(
      diceExpressions(die(6), die(6), die(6)),
      countReducer(valueOrLess(2)),
    )
    expect(DE.toString(expr)).toBe('3d6 count <= 2')
  })
})

describe('dice pool parsing', () => {
  const cases: { input: string; rendered: string; min: number; max: number }[] =
    [
      { input: '4d10 count >= 6', rendered: '4d10 count >= 6', min: 0, max: 4 },
      { input: '8d10 count >= 6', rendered: '8d10 count >= 6', min: 0, max: 8 },
      { input: '3d6 count = 6', rendered: '3d6 count = 6', min: 0, max: 3 },
      { input: '3d6 count <= 2', rendered: '3d6 count <= 2', min: 3, max: 0 },
      { input: '4d10c6', rendered: '4d10 count >= 6', min: 0, max: 4 },
      {
        input: '(1,2,3) count >= 2',
        rendered: '(1,2,3) count >= 2',
        min: 2,
        max: 2,
      },
      { input: '3d6 count > 4', rendered: '3d6 count >= 5', min: 0, max: 3 },
      { input: '3d6 count < 3', rendered: '3d6 count <= 2', min: 3, max: 0 },
    ]

  test.each(cases)('parses $input', ({ input, rendered, min, max }) => {
    const parsed = DiceParser.parse(input)
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe(rendered)
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(min)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(max)
    }
  })
})

describe('count threshold english syntax (unified)', () => {
  const pairs: { a: string; b: string }[] = [
    { a: '4d10 count on 6 or more', b: '4d10 count >= 6' },
    { a: '4d10 count 6 or more', b: '4d10 count >= 6' },
    { a: '3d6 count on 2 or less', b: '3d6 count <= 2' },
    { a: '3d6 count on 5', b: '3d6 count = 5' },
    { a: '3d6 count exactly 5', b: '3d6 count = 5' },
    { a: '3d6 count 5', b: '3d6 count = 5' },
  ]
  test.each(pairs)(
    'equivalent: "$a" == "$b"',
    ({ a, b }: { a: string; b: string }) => {
      const pa = DiceParser.parseOrNull(a)
      const pb = DiceParser.parseOrNull(b)
      expect(pa).not.toBeNull()
      expect(pb).not.toBeNull()
      if (pa && pb) {
        expect(DE.toString(pa)).toBe(DE.toString(pb))
      }
    },
  )

  test('count on 3..5 parses to between and counts inclusively', () => {
    const parsed = DiceParser.parseOrNull('5d6 count on 3..5')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(DE.toString(parsed)).toBe('5d6 count 3..5')
    // Distribution: for each of 5 d6 dice, probability of being in [3,5] is 3/6=1/2.
    // Number of successes follows Binomial(5, 1/2).
    const dist = DiceStats.distribution(parsed)
    expect(dist.get(0)).toBeCloseTo(1 / 32, 10)
    expect(dist.get(5)).toBeCloseTo(1 / 32, 10)
    expect(dist.get(2)).toBeCloseTo(10 / 32, 10)
  })

  test('count on 3..5 min/max rollers', () => {
    const parsed = DiceParser.parseOrNull('5d6 count on 3..5')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    // Min roll (all 1s): none in [3..5] -> 0
    expect(RR.getResult(minRoller().roll(parsed))).toBe(0)
    // Max roll (all 6s): none in [3..5] -> 0
    expect(RR.getResult(maxRoller().roll(parsed))).toBe(0)
  })
})

describe('multi-step count', () => {
  test('5d10 count 6 or more and 10: a 10 counts as 2 successes', () => {
    const parsed = DiceParser.parseOrNull('5d10 count 6 or more and 10')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    // Max roller: all 10s -> each die contributes 2 (matches >=6 AND ==10).
    expect(RR.getResult(maxRoller().roll(parsed))).toBe(10)
    // Min roller: all 1s -> each die contributes 0.
    expect(RR.getResult(minRoller().roll(parsed))).toBe(0)
  })

  test('toString renders multi-step with "and"', () => {
    const parsed = DiceParser.parseOrNull('5d10 count 6 or more and 10')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(DE.toString(parsed)).toBe('5d10 count >= 6 and = 10')
  })

  test('1d12 count 6 or more and 8 or more and 10 or more and 12 (progressive)', () => {
    const parsed = DiceParser.parseOrNull(
      '1d12 count 6 or more and 8 or more and 10 or more and 12',
    )
    expect(parsed).not.toBeNull()
    if (!parsed) return
    // Single d12; expected counts:
    //  1..5: 0 matches, 6..7: 1, 8..9: 2, 10..11: 3, 12: 4
    // Distribution of successes per face:
    const dist = DiceStats.distribution(parsed)
    // P(0) = 5/12, P(1) = 2/12, P(2) = 2/12, P(3) = 2/12, P(4) = 1/12
    expect(dist.get(0)).toBeCloseTo(5 / 12, 10)
    expect(dist.get(1)).toBeCloseTo(2 / 12, 10)
    expect(dist.get(2)).toBeCloseTo(2 / 12, 10)
    expect(dist.get(3)).toBeCloseTo(2 / 12, 10)
    expect(dist.get(4)).toBeCloseTo(1 / 12, 10)
  })

  test('operator + english mixable: 8d10 count >= 6 and 10', () => {
    const parsed = DiceParser.parseOrNull('8d10 count >= 6 and 10')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    // Each d10 showing 10 matches both thresholds.
    expect(RR.getResult(maxRoller().roll(parsed))).toBe(16)
    expect(RR.getResult(minRoller().roll(parsed))).toBe(0)
  })

  test('shorthand c6 stays single threshold', () => {
    const parsed = DiceParser.parseOrNull('3d6c6')
    expect(parsed).not.toBeNull()
    if (!parsed) return
    if (
      parsed.type === 'dice-reduce' &&
      typeof parsed.reducer === 'object' &&
      parsed.reducer.type === 'count'
    ) {
      expect(parsed.reducer.thresholds.length).toBe(1)
    } else {
      throw new Error('Expected dice-reduce with count')
    }
  })

  test('toString round-trip for multi-step via AST', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10), die(10)),
      { type: 'count', thresholds: [valueOrMore(6), exact(10)] },
    )
    expect(DE.toString(expr)).toBe('5d10 count >= 6 and = 10')
    // Re-parse the canonical rendering and compare.
    const reparsed = DiceParser.parseOrNull(DE.toString(expr))
    expect(reparsed).not.toBeNull()
    if (reparsed) {
      expect(DE.toString(reparsed)).toBe(DE.toString(expr))
    }
  })

  test('distribution analysis for multi-step 2d6 count >= 5 and = 6', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6)), {
      type: 'count',
      thresholds: [valueOrMore(5), exact(6)],
    })
    const dist = DiceStats.distribution(expr)
    // Per d6: 1-4 contributes 0, 5 contributes 1, 6 contributes 2.
    // Per-die distribution: P(0)=4/6, P(1)=1/6, P(2)=1/6.
    // Sum of two dice:
    //  0: (4/6)^2 = 16/36
    //  1: 2*(4/6)*(1/6) = 8/36
    //  2: 2*(4/6)*(1/6) + (1/6)^2 = 9/36
    //  3: 2*(1/6)*(1/6) = 2/36
    //  4: (1/6)^2 = 1/36
    expect(dist.get(0)).toBeCloseTo(16 / 36, 10)
    expect(dist.get(1)).toBeCloseTo(8 / 36, 10)
    expect(dist.get(2)).toBeCloseTo(9 / 36, 10)
    expect(dist.get(3)).toBeCloseTo(2 / 36, 10)
    expect(dist.get(4)).toBeCloseTo(1 / 36, 10)
  })

  test('between threshold is honored in count', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), {
      type: 'count',
      thresholds: [between(3, 5)],
    })
    expect(DE.toString(expr)).toBe('3d6 count 3..5')
  })
})
