import { DiceParser } from '../src/dice-parser'
import { RR } from '../src/roll-result-domain'
import { minRoller } from './roller.spec'

describe('operator precedence', () => {
  const cases: { expr: string; expected: number }[] = [
    { expr: '150 / 25 * 3', expected: 18 },
    { expr: '12 / 3 / 2', expected: 2 },
    { expr: '10 - 3 - 2', expected: 5 },
    { expr: '2 * 3 + 4', expected: 10 },
    { expr: '4 + 2 * 3', expected: 10 },
    { expr: '10 / 2 + 3', expected: 8 },
    { expr: '3 + 10 / 2', expected: 8 },
    { expr: '2 * 3 * 4', expected: 24 },
    { expr: '100 / 5 / 4', expected: 5 },
    { expr: '2 + 3 + 4', expected: 9 },
    { expr: '10 - 3 + 2', expected: 9 },
  ]

  test.each(cases)('$expr = $expected', ({ expr, expected }) => {
    const parsed = DiceParser.parse(expr)
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      const result = RR.getResult(minRoller().roll(parsed.value))
      expect(result).toBe(expected)
    }
  })
})
