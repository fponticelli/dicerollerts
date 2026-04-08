import {
  DiceExpression,
  binaryOp,
  diceExpressions,
  diceListWithFilter,
  diceListWithMap,
  diceReduce,
  die,
  drop,
  keep,
  explode,
  literal,
  reroll,
  emphasis,
  unaryOp,
  upTo,
  valueOrMore,
  filterableDiceArray,
  filterableDiceExpressions,
} from '../src/dice-expression'
import {
  RollResult,
  binaryOpResult,
  diceExpressionsResult,
  diceFilterableResult,
  diceMapeableResult,
  diceReduceResult,
  dieResult,
  discardResult,
  exploded,
  keepResult,
  literalResult,
  normal,
  oneResult,
  rerolled,
  unaryOpResult,
} from '../src/roll-result'
import { Roller } from '../src/roller'

export function maxRoller() {
  return new Roller((max) => max)
}

export function minRoller() {
  return new Roller(() => 1)
}

const tests: {
  test: DiceExpression
  min: RollResult
  max: RollResult
}[] = [
  {
    test: die(6),
    min: oneResult(dieResult(1, 6)),
    max: oneResult(dieResult(6, 6)),
  },
  {
    test: literal(6),
    min: literalResult(6, 6),
    max: literalResult(6, 6),
  },
  {
    test: diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      'sum',
    ),
    min: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'sum',
      6,
    ),
    max: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'sum',
      6,
    ),
  },
  {
    test: diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      'average',
    ),
    min: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'average',
      2,
    ),
    max: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'average',
      2,
    ),
  },
  {
    test: diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      'min',
    ),
    min: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'min',
      1,
    ),
    max: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'min',
      1,
    ),
  },
  {
    test: diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      'max',
    ),
    min: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'max',
      3,
    ),
    max: diceReduceResult(
      diceExpressionsResult([
        literalResult(1, 1),
        literalResult(2, 2),
        literalResult(3, 3),
      ]),
      'max',
      3,
    ),
  },
  {
    test: diceReduce(
      diceListWithFilter(
        filterableDiceExpressions(literal(1), literal(2), literal(3)),
        drop('low', 1),
      ),
      'sum',
    ),
    min: diceReduceResult(
      diceFilterableResult(
        [
          discardResult(literalResult(1, 1)),
          keepResult(literalResult(2, 2)),
          keepResult(literalResult(3, 3)),
        ],
        drop('low', 1),
      ),
      'sum',
      5,
    ),
    max: diceReduceResult(
      diceFilterableResult(
        [
          discardResult(literalResult(1, 1)),
          keepResult(literalResult(2, 2)),
          keepResult(literalResult(3, 3)),
        ],
        drop('low', 1),
      ),
      'sum',
      5,
    ),
  },
  {
    test: diceReduce(
      diceListWithMap([2, 3, 4], explode(upTo(1), valueOrMore(3))),
      'sum',
    ),
    min: diceReduceResult(
      diceMapeableResult(
        [
          normal(dieResult(1, 2)),
          normal(dieResult(1, 3)),
          normal(dieResult(1, 4)),
        ],
        explode(upTo(1), valueOrMore(3)),
      ),
      'sum',
      3,
    ),
    max: diceReduceResult(
      diceMapeableResult(
        [
          normal(dieResult(2, 2)),
          exploded([dieResult(3, 3), dieResult(3, 3)]),
          exploded([dieResult(4, 4), dieResult(4, 4)]),
        ],
        explode(upTo(1), valueOrMore(3)),
      ),
      'sum',
      16,
    ),
  },
  {
    test: diceReduce(
      diceListWithMap([2, 3, 4], reroll(upTo(1), valueOrMore(3))),
      'sum',
    ),
    min: diceReduceResult(
      diceMapeableResult(
        [
          normal(dieResult(1, 2)),
          normal(dieResult(1, 3)),
          normal(dieResult(1, 4)),
        ],
        reroll(upTo(1), valueOrMore(3)),
      ),
      'sum',
      3,
    ),
    max: diceReduceResult(
      diceMapeableResult(
        [
          normal(dieResult(2, 2)),
          rerolled([dieResult(3, 3), dieResult(3, 3)]),
          rerolled([dieResult(4, 4), dieResult(4, 4)]),
        ],
        reroll(upTo(1), valueOrMore(3)),
      ),
      'sum',
      9,
    ),
  },
  {
    test: binaryOp('sum', literal(3), die(2)),
    min: binaryOpResult(
      'sum',
      literalResult(3, 3),
      oneResult(dieResult(1, 2)),
      4,
    ),
    max: binaryOpResult(
      'sum',
      literalResult(3, 3),
      oneResult(dieResult(2, 2)),
      5,
    ),
  },
  {
    test: unaryOp('negate', literal(3)),
    min: unaryOpResult('negate', literalResult(3, 3), -3),
    max: unaryOpResult('negate', literalResult(3, 3), -3),
  },
]

describe('dice roller', () => {
  test('min/max', () => {
    for (const { test, min, max } of tests) {
      expect(minRoller().roll(test)).toEqual(min)
      expect(maxRoller().roll(test)).toEqual(max)
    }
  })
})

import { RR } from '../src/roll-result-domain'

describe('emphasis roller', () => {
  test('emphasis high tie breaker picks higher value on tie distance', () => {
    // With a d6, average = floor(6/2) = 3. Rolls 1 and 5 are equidistant (distance 2).
    // 'high' tiebreaker should pick 5.
    const rolls = [1, 5]
    let callIdx = 0
    const roller = new Roller(() => {
      return rolls[callIdx++] ?? 1
    })
    const expr = diceReduce(
      diceListWithMap([6], emphasis('high', 'average')),
      'sum',
    )
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(5)
  })

  test('emphasis low tie breaker picks lower value on tie distance', () => {
    // With a d6, average = floor(6/2) = 3. Rolls 1 and 5 are equidistant (distance 2).
    // 'low' tiebreaker should pick 1.
    const rolls = [1, 5]
    let callIdx = 0
    const roller = new Roller(() => {
      return rolls[callIdx++] ?? 1
    })
    const expr = diceReduce(
      diceListWithMap([6], emphasis('low', 'average')),
      'sum',
    )
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(1)
  })
})

describe('filter roller - drop high and keep low', () => {
  test('3d6 drop highest 1', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), drop('high', 1)),
      'sum',
    )
    const result = RR.getResult(maxRoller().roll(expr))
    // All roll 6, drop one 6, keep two 6s = 12
    expect(result).toBe(12)
    const minResult = RR.getResult(minRoller().roll(expr))
    // All roll 1, drop one 1, keep two 1s = 2
    expect(minResult).toBe(2)
  })

  test('3d6 keep lowest 1', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), keep('low', 1)),
      'sum',
    )
    const result = RR.getResult(minRoller().roll(expr))
    expect(result).toBe(1)
    const maxResult = RR.getResult(maxRoller().roll(expr))
    expect(maxResult).toBe(6)
  })
})
