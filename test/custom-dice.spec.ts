import {
  customDie,
  diceReduce,
  diceExpressions,
  literal,
  binaryOp,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

describe('custom die types', () => {
  test('custom die with explicit faces', () => {
    const expr = customDie([1, 1, 2, 2, 3, 4])
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(1)
    expect(max).toBe(4)
  })

  test('fate die (-1, 0, 1)', () => {
    const expr = customDie([-1, 0, 1])
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(-1)
    expect(max).toBe(1)
  })

  test('custom die in expression', () => {
    const expr = binaryOp('sum', customDie([2, 4, 6]), literal(3))
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(5)
    expect(max).toBe(9)
  })

  test('multiple custom dice reduced', () => {
    const expr = diceReduce(
      diceExpressions(customDie([1, 2, 3]), customDie([1, 2, 3])),
      'sum',
    )
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(2)
    expect(max).toBe(6)
  })
})

describe('custom die toString', () => {
  test('renders fate die as dF', () => {
    expect(DE.toString(customDie([-1, 0, 1]))).toBe('dF')
  })

  test('renders custom faces as d{...}', () => {
    expect(DE.toString(customDie([1, 1, 2, 2, 3, 4]))).toBe('d{1,1,2,2,3,4}')
  })
})

describe('custom die validation', () => {
  test('empty faces is invalid', () => {
    const result = DE.validate(customDie([]))
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('empty-faces')
  })

  test('non-empty faces is valid', () => {
    expect(DE.validate(customDie([1, 2, 3]))).toBeNull()
  })
})
