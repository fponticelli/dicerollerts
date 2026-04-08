import {
  die,
  literal,
  binaryOp,
  diceReduce,
  diceExpressions,
  customDie,
  unaryOp,
  diceListWithMap,
  diceListWithFilter,
  filterableDiceArray,
  explode,
  always,
  exact,
  drop,
  keep,
  valueOrMore,
} from '../src/dice-expression'
import { DiceStats } from '../src/dice-stats'

describe('exact probability analysis', () => {
  test('d6 distribution', () => {
    const dist = DiceStats.distribution(die(6))
    expect(dist.size).toBe(6)
    for (let i = 1; i <= 6; i++) {
      expect(dist.get(i)).toBeCloseTo(1 / 6)
    }
  })

  test('literal distribution', () => {
    const dist = DiceStats.distribution(literal(5))
    expect(dist.size).toBe(1)
    expect(dist.get(5)).toBe(1)
  })

  test('d6 + d6 distribution', () => {
    const dist = DiceStats.distribution(binaryOp('sum', die(6), die(6)))
    expect(dist.size).toBe(11)
    expect(dist.get(7)).toBeCloseTo(6 / 36)
    expect(dist.get(2)).toBeCloseTo(1 / 36)
    expect(dist.get(12)).toBeCloseTo(1 / 36)
  })

  test('d6 mean', () => {
    expect(DiceStats.mean(die(6))).toBeCloseTo(3.5)
  })

  test('2d6 mean', () => {
    expect(DiceStats.mean(binaryOp('sum', die(6), die(6)))).toBeCloseTo(7)
  })

  test('d6 stddev', () => {
    expect(DiceStats.stddev(die(6))).toBeCloseTo(1.7078, 3)
  })

  test('d6 min/max', () => {
    expect(DiceStats.min(die(6))).toBe(1)
    expect(DiceStats.max(die(6))).toBe(6)
  })

  test('literal min/max', () => {
    expect(DiceStats.min(literal(5))).toBe(5)
    expect(DiceStats.max(literal(5))).toBe(5)
  })

  test('d6 + 3 distribution', () => {
    const dist = DiceStats.distribution(binaryOp('sum', die(6), literal(3)))
    expect(dist.size).toBe(6)
    expect(dist.get(4)).toBeCloseTo(1 / 6)
    expect(dist.get(9)).toBeCloseTo(1 / 6)
  })

  test('negate distribution', () => {
    const dist = DiceStats.distribution(unaryOp('negate', die(6)))
    expect(dist.size).toBe(6)
    expect(dist.get(-1)).toBeCloseTo(1 / 6)
    expect(dist.get(-6)).toBeCloseTo(1 / 6)
  })

  test('d6 * 2 distribution', () => {
    const dist = DiceStats.distribution(
      binaryOp('multiplication', die(6), literal(2)),
    )
    expect(dist.size).toBe(6)
    expect(dist.get(2)).toBeCloseTo(1 / 6)
  })

  test('custom die distribution', () => {
    const dist = DiceStats.distribution(customDie([-1, 0, 1]))
    expect(dist.size).toBe(3)
    expect(dist.get(-1)).toBeCloseTo(1 / 3)
    expect(dist.get(0)).toBeCloseTo(1 / 3)
    expect(dist.get(1)).toBeCloseTo(1 / 3)
  })

  test('3d6 sum distribution has correct mean', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'sum')
    expect(DiceStats.mean(expr)).toBeCloseTo(10.5)
  })

  test('percentile', () => {
    const p50 = DiceStats.percentile(die(6), 50)
    expect(p50).toBeGreaterThanOrEqual(3)
    expect(p50).toBeLessThanOrEqual(4)
  })
})

describe('filtered distribution - drop/keep', () => {
  test('4d6 drop lowest 1 exact distribution', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6, 6]), drop('low', 1)),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBe(3)
    expect(result.max).toBe(18)
    expect(result.mean).toBeCloseTo(12.24, 1)
  })

  test('4d6 keep highest 3 distribution', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6, 6]), keep('high', 3)),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBe(3)
    expect(result.max).toBe(18)
  })

  test('3d6 drop highest 1 distribution', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), drop('high', 1)),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBe(2)
    expect(result.max).toBe(12)
  })

  test('3d6 keep lowest 1 distribution', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), keep('low', 1)),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBe(1)
    expect(result.max).toBe(6)
  })
})

describe('non-sum reducers in exact analysis', () => {
  test('3d6 min distribution', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'min')
    expect(DiceStats.mean(expr)).toBeCloseTo(2.042, 2)
    expect(DiceStats.min(expr)).toBe(1)
    expect(DiceStats.max(expr)).toBe(6)
  })

  test('3d6 max distribution', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'max')
    expect(DiceStats.mean(expr)).toBeCloseTo(4.958, 2)
  })

  test('3d6 average distribution', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'average')
    const dist = DiceStats.distribution(expr)
    expect(dist.size).toBeGreaterThan(0)
  })

  test('3d6 median distribution', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'median')
    const dist = DiceStats.distribution(expr)
    expect(dist.size).toBeGreaterThan(0)
  })

  test('4d6 count >= 4 distribution', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6), die(6)), {
      type: 'count',
      threshold: valueOrMore(4),
    })
    const dist = DiceStats.distribution(expr)
    expect(dist.size).toBe(5) // 0, 1, 2, 3, 4
    expect(DiceStats.min(expr)).toBe(0)
    expect(DiceStats.max(expr)).toBe(4)
  })
})

describe('binary op distributions', () => {
  test('d6 / d6 distribution', () => {
    const dist = DiceStats.distribution(binaryOp('division', die(6), die(6)))
    expect(dist.size).toBeGreaterThan(0)
  })

  test('d6 - d6 distribution', () => {
    expect(DiceStats.mean(binaryOp('difference', die(6), die(6)))).toBeCloseTo(
      0,
    )
  })

  test('d6 * d6 distribution', () => {
    const dist = DiceStats.distribution(
      binaryOp('multiplication', die(6), die(6)),
    )
    expect(dist.size).toBeGreaterThan(0)
    expect(
      DiceStats.mean(binaryOp('multiplication', die(6), die(6))),
    ).toBeCloseTo(12.25, 1)
  })
})

describe('complexity threshold', () => {
  test('summary uses Monte Carlo for complex expressions', () => {
    // 25 dice exceeds the 20-dice threshold
    const dice = Array.from({ length: 25 }, () => die(6))
    const expr = diceReduce(diceExpressions(...dice), 'sum')
    const result = DiceStats.summary(expr)
    expect(result.mean).toBeCloseTo(87.5, 0)
  })
})

describe('Monte Carlo analysis', () => {
  test('d6 Monte Carlo approximates uniform distribution', () => {
    const result = DiceStats.monteCarlo(die(6), { trials: 50000 })
    expect(result.mean).toBeCloseTo(3.5, 0)
    expect(result.min).toBe(1)
    expect(result.max).toBe(6)
    expect(result.distribution.size).toBe(6)
  })

  test('2d6 Monte Carlo approximates correct mean', () => {
    const expr = binaryOp('sum', die(6), die(6))
    const result = DiceStats.monteCarlo(expr, { trials: 50000 })
    expect(result.mean).toBeCloseTo(7, 0)
  })

  test('Monte Carlo default trials', () => {
    const result = DiceStats.monteCarlo(die(6))
    expect(result.mean).toBeCloseTo(3.5, 0)
  })

  test('Monte Carlo percentile function', () => {
    const result = DiceStats.monteCarlo(die(6), { trials: 50000 })
    const p50 = result.percentile(50)
    expect(p50).toBeGreaterThanOrEqual(3)
    expect(p50).toBeLessThanOrEqual(4)
  })
})

describe('summary', () => {
  test('d6 summary uses exact analysis', () => {
    const result = DiceStats.summary(die(6))
    expect(result.min).toBe(1)
    expect(result.max).toBe(6)
    expect(result.mean).toBeCloseTo(3.5)
    expect(result.distribution.size).toBe(6)
    expect(result.percentiles[50]).toBeGreaterThanOrEqual(3)
  })

  test('summary falls back to Monte Carlo for complex expressions', () => {
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBeGreaterThanOrEqual(1)
    expect(result.mean).toBeGreaterThan(0)
  })
})
