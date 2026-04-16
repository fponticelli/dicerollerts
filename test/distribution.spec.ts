import { Distribution } from '../src/distribution'

describe('Distribution constructors', () => {
  test('singleton', () => {
    const d = Distribution.singleton(5)
    expect(d.values.get(5)).toBe(1)
    expect(d.values.size).toBe(1)
  })

  test('uniform', () => {
    const d = Distribution.uniform([1, 2, 3, 4, 5, 6])
    expect(d.values.get(1)).toBeCloseTo(1 / 6)
    expect(d.values.size).toBe(6)
  })

  test('uniform with duplicates merges', () => {
    const d = Distribution.uniform([1, 1, 2])
    expect(d.values.get(1)).toBeCloseTo(2 / 3)
    expect(d.values.get(2)).toBeCloseTo(1 / 3)
  })

  test('uniform on empty array throws', () => {
    expect(() => Distribution.uniform([])).toThrow()
  })

  test('fromWeights normalizes', () => {
    const d = Distribution.fromWeights([
      ['a', 1],
      ['b', 2],
      ['c', 1],
    ])
    expect(d.values.get('a')).toBeCloseTo(0.25)
    expect(d.values.get('b')).toBeCloseTo(0.5)
    expect(d.values.get('c')).toBeCloseTo(0.25)
  })

  test('from a Map normalizes', () => {
    const d = Distribution.from(
      new Map<string, number>([
        ['a', 2],
        ['b', 2],
      ]),
    )
    expect(d.values.get('a')).toBeCloseTo(0.5)
    expect(d.values.get('b')).toBeCloseTo(0.5)
  })

  test('fromWeights rejects negative weights', () => {
    expect(() =>
      Distribution.fromWeights([
        ['a', 1],
        ['b', -1],
      ]),
    ).toThrow()
  })
})

describe('Distribution operations', () => {
  test('map', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const doubled = Distribution.map(d6, (v) => v * 2)
    expect(doubled.values.get(2)).toBeCloseTo(1 / 6)
    expect(doubled.values.get(12)).toBeCloseTo(1 / 6)
  })

  test('combine - sum of two d6', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum = Distribution.combine(d6, d6, (a, b) => a + b)
    expect(sum.values.get(7)).toBeCloseTo(6 / 36)
    expect(sum.values.get(2)).toBeCloseTo(1 / 36)
    expect(sum.values.get(12)).toBeCloseTo(1 / 36)
  })

  test('add (numeric shortcut)', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum = Distribution.add(d6, d6)
    expect(sum.values.get(7)).toBeCloseTo(6 / 36)
  })

  test('subtract', () => {
    const d4 = Distribution.uniform([1, 2, 3, 4])
    const diff = Distribution.subtract(d4, d4)
    // diff = 0 has probability 4/16
    expect(diff.values.get(0)).toBeCloseTo(4 / 16)
    expect(diff.values.get(3)).toBeCloseTo(1 / 16)
    expect(diff.values.get(-3)).toBeCloseTo(1 / 16)
  })

  test('multiply', () => {
    const a = Distribution.uniform([1, 2])
    const b = Distribution.uniform([3, 4])
    const prod = Distribution.multiply(a, b)
    // outcomes: 3,4,6,8 each with prob 1/4
    expect(prod.values.get(3)).toBeCloseTo(0.25)
    expect(prod.values.get(4)).toBeCloseTo(0.25)
    expect(prod.values.get(6)).toBeCloseTo(0.25)
    expect(prod.values.get(8)).toBeCloseTo(0.25)
  })

  test('negate', () => {
    const d = Distribution.uniform([1, 2, 3])
    const neg = Distribution.negate(d)
    expect(neg.values.get(-1)).toBeCloseTo(1 / 3)
    expect(neg.values.get(-2)).toBeCloseTo(1 / 3)
    expect(neg.values.get(-3)).toBeCloseTo(1 / 3)
  })

  test('conditional', () => {
    const fair = Distribution.fromWeights([
      [true, 1],
      [false, 1],
    ])
    const onTrue = Distribution.singleton(10)
    const onFalse = Distribution.singleton(0)
    const result = Distribution.conditional(fair, onTrue, onFalse)
    expect(result.values.get(10)).toBeCloseTo(0.5)
    expect(result.values.get(0)).toBeCloseTo(0.5)
  })

  test('greaterOrEqualConst', () => {
    const d20 = Distribution.uniform([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ])
    const hit = Distribution.greaterOrEqualConst(d20, 11)
    expect(hit.values.get(true)).toBeCloseTo(0.5)
    expect(hit.values.get(false)).toBeCloseTo(0.5)
  })

  test('greaterThanConst', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const hit = Distribution.greaterThanConst(d6, 4)
    expect(hit.values.get(true)).toBeCloseTo(2 / 6)
  })

  test('lessThanConst', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const hit = Distribution.lessThanConst(d6, 3)
    expect(hit.values.get(true)).toBeCloseTo(2 / 6)
  })

  test('lessOrEqualConst', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const hit = Distribution.lessOrEqualConst(d6, 3)
    expect(hit.values.get(true)).toBeCloseTo(3 / 6)
  })

  test('equalConst', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const hit = Distribution.equalConst(d6, 4)
    expect(hit.values.get(true)).toBeCloseTo(1 / 6)
    expect(hit.values.get(false)).toBeCloseTo(5 / 6)
  })

  test('greaterThan / lessThan / equal between two distributions', () => {
    const d3 = Distribution.uniform([1, 2, 3])
    const gt = Distribution.greaterThan(d3, d3)
    const lt = Distribution.lessThan(d3, d3)
    const eq = Distribution.equal(d3, d3)
    // 3 ties out of 9
    expect(eq.values.get(true)).toBeCloseTo(3 / 9)
    // gt + lt + eq must sum to 1
    const pTrueGt = gt.values.get(true) ?? 0
    const pTrueLt = lt.values.get(true) ?? 0
    const pTrueEq = eq.values.get(true) ?? 0
    expect(pTrueGt + pTrueLt + pTrueEq).toBeCloseTo(1)
    // by symmetry gt == lt
    expect(pTrueGt).toBeCloseTo(pTrueLt)
  })

  test('greaterOrEqual / lessOrEqual', () => {
    const d3 = Distribution.uniform([1, 2, 3])
    const ge = Distribution.greaterOrEqual(d3, d3)
    const le = Distribution.lessOrEqual(d3, d3)
    // both should equal (gt + eq) by symmetry
    expect(ge.values.get(true)).toBeCloseTo(le.values.get(true) ?? 0)
    // and gt + eq = 3/9 + 3/9 = 6/9
    expect(ge.values.get(true)).toBeCloseTo(6 / 9)
  })

  test('and of independent halves', () => {
    const halfTrue = Distribution.fromWeights([
      [true, 1],
      [false, 1],
    ])
    const result = Distribution.and(halfTrue, halfTrue)
    expect(result.values.get(true)).toBeCloseTo(0.25)
    expect(result.values.get(false)).toBeCloseTo(0.75)
  })

  test('or of independent halves', () => {
    const halfTrue = Distribution.fromWeights([
      [true, 1],
      [false, 1],
    ])
    const result = Distribution.or(halfTrue, halfTrue)
    expect(result.values.get(true)).toBeCloseTo(0.75)
    expect(result.values.get(false)).toBeCloseTo(0.25)
  })

  test('not', () => {
    const d = Distribution.fromWeights([
      [true, 3],
      [false, 1],
    ])
    const result = Distribution.not(d)
    expect(result.values.get(false)).toBeCloseTo(0.75)
    expect(result.values.get(true)).toBeCloseTo(0.25)
  })

  test('repeat for sum of N copies', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum3 = Distribution.repeat(d6, 3)
    // mean of 3d6 = 10.5
    expect(Distribution.mean(sum3)).toBeCloseTo(10.5)
  })

  test('repeat with n=0 returns singleton 0', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum0 = Distribution.repeat(d6, 0)
    expect(sum0.values.get(0)).toBe(1)
  })

  test('repeat with n=1 returns the same distribution', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum1 = Distribution.repeat(d6, 1)
    expect(sum1.values.get(3)).toBeCloseTo(1 / 6)
  })

  test('repeat rejects negative n', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    expect(() => Distribution.repeat(d6, -1)).toThrow()
  })
})

describe('Distribution aggregations', () => {
  test('mean', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    expect(Distribution.mean(d6)).toBeCloseTo(3.5)
  })

  test('variance', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    expect(Distribution.variance(d6)).toBeCloseTo(35 / 12, 5)
  })

  test('probabilityOf', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    expect(Distribution.probabilityOf(d6, (v) => v >= 4)).toBeCloseTo(0.5)
  })

  test('min and max', () => {
    const d = Distribution.fromWeights([
      [-3, 1],
      [0, 1],
      [7, 1],
    ])
    expect(Distribution.min(d)).toBe(-3)
    expect(Distribution.max(d)).toBe(7)
  })
})

describe('Distribution probabilities sum to 1', () => {
  test('after combine', () => {
    const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
    const sum = Distribution.add(d6, d6)
    let total = 0
    for (const p of sum.values.values()) total += p
    expect(total).toBeCloseTo(1)
  })

  test('after conditional', () => {
    const cond = Distribution.fromWeights([
      [true, 3],
      [false, 1],
    ])
    const a = Distribution.uniform([1, 2, 3])
    const b = Distribution.uniform([10, 20])
    const out = Distribution.conditional(cond, a, b)
    let total = 0
    for (const p of out.values.values()) total += p
    expect(total).toBeCloseTo(1)
  })
})

describe('Distribution from DiceExpression', () => {
  test('fromDiceExpression for d6', async () => {
    const { DiceParser } = await import('../src/dice-parser')
    const parsed = DiceParser.parseOrNull('d6')!
    const d = Distribution.fromDiceExpression(parsed)
    expect(d.values.size).toBe(6)
    expect(d.values.get(1)).toBeCloseTo(1 / 6)
  })

  test('fromDiceExpression for 2d6 sum', async () => {
    const { DiceParser } = await import('../src/dice-parser')
    const parsed = DiceParser.parseOrNull('2d6')!
    const d = Distribution.fromDiceExpression(parsed)
    // 2d6 sums range 2..12 with 7 most likely
    expect(d.values.get(7)).toBeCloseTo(6 / 36)
    expect(d.values.get(2)).toBeCloseTo(1 / 36)
    expect(d.values.get(12)).toBeCloseTo(1 / 36)
  })
})
