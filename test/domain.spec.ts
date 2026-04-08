import {
  die,
  literal,
  customDie,
  binaryOp,
  unaryOp,
  diceReduce,
  diceExpressions,
  diceListWithMap,
  diceListWithFilter,
  filterableDiceArray,
  filterableDiceExpressions,
  drop,
  keep,
  explode,
  reroll,
  compound,
  emphasis,
  upTo,
  always,
  exact,
  between,
  valueOrMore,
  valueOrLess,
  composite,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'

describe('DE.toString edge cases', () => {
  test('between range', () => {
    const expr = diceReduce(
      diceListWithMap([6], explode(upTo(1), between(3, 5))),
      'sum',
    )
    expect(DE.toString(expr)).toContain('3...5')
  })

  test('composite range', () => {
    const expr = diceReduce(
      diceListWithMap([6], explode(upTo(1), composite([exact(1), exact(6)]))),
      'sum',
    )
    expect(DE.toString(expr)).toContain('(on 1,on 6)')
  })

  test('value or less range', () => {
    const expr = diceReduce(
      diceListWithMap([6], reroll(upTo(1), valueOrLess(2))),
      'sum',
    )
    expect(DE.toString(expr)).toContain('on 2 or less')
  })

  test('keep lowest toString', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), keep('low', 1)),
      'sum',
    )
    expect(DE.toString(expr)).toBe('3d6 keep lowest 1')
  })

  test('drop highest toString', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6]), drop('high', 1)),
      'sum',
    )
    expect(DE.toString(expr)).toBe('3d6 drop highest 1')
  })

  test('filterable dice expressions toString', () => {
    const expr = diceReduce(
      diceListWithFilter(
        filterableDiceExpressions(die(6), die(8)),
        drop('low', 1),
      ),
      'sum',
    )
    expect(DE.toString(expr)).toBe('(d6,d8) drop 1')
  })

  test('emphasis high toString', () => {
    const expr = diceReduce(
      diceListWithMap([20], emphasis('high', 'average')),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d20 emphasis high')
  })

  test('emphasis low toString', () => {
    const expr = diceReduce(
      diceListWithMap([20], emphasis('low', 'average')),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d20 emphasis low')
  })

  test('furthest from N toString', () => {
    const expr = diceReduce(
      diceListWithMap([20], emphasis('reroll', 10)),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d20 furthest from 10')
  })

  test('compound toString', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(2), exact(6))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 compound twice on 6')
  })

  test('times 3 toString', () => {
    const expr = diceReduce(
      diceListWithMap([6], explode(upTo(3), exact(6))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 explode 3 times on 6')
  })

  test('mixed sides in sidesToString', () => {
    const expr = diceReduce(
      diceListWithMap([4, 6, 8], explode(upTo(1), exact(1))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('(d4,d6,d8) explode once on 1')
  })

  test('d% toString', () => {
    expect(DE.toString(die(100))).toBe('d%')
  })

  test('2d% toString', () => {
    const expr = diceReduce(diceExpressions(die(100), die(100)), 'sum')
    expect(DE.toString(expr)).toBe('2d%')
  })

  test('median reducer toString', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6)), 'median')
    expect(DE.toString(expr)).toBe('2d6 median')
  })
})

describe('DE.validate edge cases', () => {
  test('insufficient sides', () => {
    const result = DE.validate(die(0))
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('insufficient-sides')
  })

  test('too many drops', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6]), drop('low', 3)),
      'sum',
    )
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('too-many-drops')
  })

  test('too many keeps', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6]), keep('high', 5)),
      'sum',
    )
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('too-many-keeps')
  })

  test('drop or keep should be positive', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6]), drop('low', 0)),
      'sum',
    )
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('drop-or-keep-should-be-positive')
  })

  test('infinite reroll on compound', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(always(), valueOrMore(1))),
      'sum',
    )
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('infinite-reroll')
  })

  test('invalid sides in dice-list-with-map', () => {
    const expr = diceReduce(
      diceListWithMap([0], explode(upTo(1), exact(1))),
      'sum',
    )
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('insufficient-sides')
  })

  test('binary op validates both sides', () => {
    const result = DE.validate(binaryOp('sum', die(0), die(6)))
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('insufficient-sides')
  })

  test('unary op validates inner', () => {
    const result = DE.validate(unaryOp('negate', die(0)))
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('insufficient-sides')
  })

  test('valid expression returns null', () => {
    expect(DE.validate(die(6))).toBeNull()
  })

  test('empty dice expressions', () => {
    const expr = diceReduce(diceExpressions(), 'sum')
    const result = DE.validate(expr)
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('empty-set')
  })
})

describe('DE.calculateBasicRolls', () => {
  test('die is 1 roll', () => {
    expect(DE.calculateBasicRolls(die(6))).toBe(1)
  })

  test('literal is 1 roll', () => {
    expect(DE.calculateBasicRolls(literal(5))).toBe(1)
  })

  test('custom die is 1 roll', () => {
    expect(DE.calculateBasicRolls(customDie([1, 2, 3]))).toBe(1)
  })

  test('binary op sums both sides', () => {
    expect(DE.calculateBasicRolls(binaryOp('sum', die(6), die(8)))).toBe(2)
  })

  test('unary op counts inner', () => {
    expect(DE.calculateBasicRolls(unaryOp('negate', die(6)))).toBe(1)
  })

  test('dice expressions counts all', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'sum')
    expect(DE.calculateBasicRolls(expr)).toBe(3)
  })

  test('filterable dice array counts dice', () => {
    const expr = diceReduce(
      diceListWithFilter(filterableDiceArray([6, 6, 6, 6]), drop('low', 1)),
      'sum',
    )
    expect(DE.calculateBasicRolls(expr)).toBe(4)
  })

  test('filterable dice expressions counts expressions', () => {
    const expr = diceReduce(
      diceListWithFilter(
        filterableDiceExpressions(die(6), binaryOp('sum', die(4), die(8))),
        drop('low', 1),
      ),
      'sum',
    )
    expect(DE.calculateBasicRolls(expr)).toBe(3)
  })

  test('dice list with map counts dice', () => {
    const expr = diceReduce(
      diceListWithMap([6, 6, 6], explode(upTo(1), exact(6))),
      'sum',
    )
    expect(DE.calculateBasicRolls(expr)).toBe(3)
  })
})
