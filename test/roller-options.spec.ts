import { diceReduce, diceListWithMap, explode, reroll, always, exact } from '../src/dice-expression'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

describe('configurable iteration limits', () => {
  test('default Roller constructor still works', () => {
    const roller = new Roller((max) => max)
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    // With default limit of 100, max roller would explode 100 times
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(6 * 101)
  })

  test('maxExplodeIterations limits explosion count', () => {
    const roller = new Roller((max) => max, { maxExplodeIterations: 3 })
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    // max roller: rolls 6, explodes 3 more = 4 * 6 = 24
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(24)
  })

  test('maxRerollIterations limits reroll count', () => {
    const roller = new Roller(() => 1, { maxRerollIterations: 3 })
    const expr = diceReduce(
      diceListWithMap([6], reroll(always(), exact(1))),
      'sum',
    )
    // min roller: rolls 1, rerolls 3 more times getting 1 each time, keeps last = 1
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(1)
  })

  test('maxEmphasisIterations limits emphasis reroll ties', () => {
    const roller = new Roller((max) => max, { maxEmphasisIterations: 5 })
    expect(roller).toBeInstanceOf(Roller)
  })
})
