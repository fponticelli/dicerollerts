import {
  diceReduce,
  diceListWithMap,
  compound,
  upTo,
  always,
  valueOrMore,
  exact,
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

describe('compound exploding', () => {
  test('compound once on max value sums into single die', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    const max = RR.getResult(maxRoller().roll(expr))
    expect(max).toBe(12)
    const min = RR.getResult(minRoller().roll(expr))
    expect(min).toBe(1)
  })

  test('compound always on 6 with limited iterations', () => {
    const roller = new Roller((max) => max, { maxExplodeIterations: 5 })
    const expr = diceReduce(
      diceListWithMap([6], compound(always(), exact(6))),
      'sum',
    )
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(36)
  })

  test('compound result type is compounded', () => {
    const roller = maxRoller()
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    const result = roller.roll(expr)
    expect(result.type).toBe('dice-reduce-result')
    if (result.type === 'dice-reduce-result') {
      expect(result.reduceables.type).toBe('dice-mapeable-result')
      if (result.reduceables.type === 'dice-mapeable-result') {
        expect(result.reduceables.rolls[0].type).toBe('compounded')
      }
    }
  })

  test('toString renders compound', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 compound once on 6')
  })

  test('toString renders compound always', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(always(), valueOrMore(5))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 compound on 5 or more')
  })
})

import { DiceParser } from '../src/dice-parser'

describe('compound parsing', () => {
  test('parses compound once', () => {
    const parsed = DiceParser.parse('d6 compound once on 6')
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe('d6 compound once on 6')
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(1)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(12)
    }
  })

  test('parses 3d6 compound once', () => {
    const parsed = DiceParser.parse('3d6 compound once on 6')
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe('3d6 compound once on 6')
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(3)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(36)
    }
  })

  test('parses compound on impossible value', () => {
    const parsed = DiceParser.parse('d6 compound on 7')
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(1)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(6)
    }
  })

  test('parses ce shorthand', () => {
    const parsed = DiceParser.parse('3d6ce6')
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe('3d6 compound on 6 or more')
    }
  })
})
