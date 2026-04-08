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
import { DiceParser } from '../src/dice-parser'

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

describe('custom die parsing', () => {
  const cases: { input: string; rendered: string; min: number; max: number }[] =
    [
      { input: 'd{1,2,3}', rendered: 'd{1,2,3}', min: 1, max: 3 },
      { input: 'd{1,1,2,2,3,4}', rendered: 'd{1,1,2,2,3,4}', min: 1, max: 4 },
      { input: 'd{ 1 , 2 , 3 }', rendered: 'd{1,2,3}', min: 1, max: 3 },
      { input: 'dF', rendered: 'dF', min: -1, max: 1 },
      { input: '4dF', rendered: '4dF', min: -4, max: 4 },
      { input: 'dF + 3', rendered: 'dF + 3', min: 2, max: 4 },
      { input: 'd{2,4,6} + 1', rendered: 'd{2,4,6} + 1', min: 3, max: 7 },
      { input: '4dF keep 2', rendered: '4dF keep 2', min: -2, max: 2 },
      { input: '4dF drop 1', rendered: '4dF drop 1', min: -3, max: 3 },
      {
        input: '4dF keep lowest 1',
        rendered: '4dF keep lowest 1',
        min: -1,
        max: 1,
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

  test('rejects empty faces d{}', () => {
    const parsed = DiceParser.parse('d{}')
    expect(parsed.isSuccess()).toBe(false)
  })
})
