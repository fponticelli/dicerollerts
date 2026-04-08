import {
  diceReduce,
  diceExpressions,
  die,
  literal,
  exact,
  valueOrMore,
  valueOrLess,
} from '../src/dice-expression'
import type { CountReducer, Range } from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'
import { DiceParser } from '../src/dice-parser'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

function countReducer(range: Range): CountReducer {
  return { type: 'count', threshold: range }
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
