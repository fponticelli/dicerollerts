import { die, literal, binaryOp, diceReduce, diceExpressions, customDie, unaryOp } from '../src/dice-expression'
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
    const dist = DiceStats.distribution(binaryOp('multiplication', die(6), literal(2)))
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
