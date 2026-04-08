import {
  binaryOp,
  die,
  literal,
  unaryOp,
  diceReduce,
  diceExpressions,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'

describe('constant folding / simplify', () => {
  test('folds literal + literal', () => {
    const expr = binaryOp('sum', literal(2), literal(3))
    expect(DE.simplify(expr)).toEqual(literal(5))
  })

  test('folds literal - literal', () => {
    const expr = binaryOp('difference', literal(10), literal(3))
    expect(DE.simplify(expr)).toEqual(literal(7))
  })

  test('folds literal * literal', () => {
    const expr = binaryOp('multiplication', literal(4), literal(5))
    expect(DE.simplify(expr)).toEqual(literal(20))
  })

  test('folds literal / literal', () => {
    const expr = binaryOp('division', literal(10), literal(3))
    expect(DE.simplify(expr)).toEqual(literal(3))
  })

  test('folds negate literal', () => {
    const expr = unaryOp('negate', literal(5))
    expect(DE.simplify(expr)).toEqual(literal(-5))
  })

  test('folds double negate', () => {
    const expr = unaryOp('negate', unaryOp('negate', literal(5)))
    expect(DE.simplify(expr)).toEqual(literal(5))
  })

  test('eliminates add zero', () => {
    const expr = binaryOp('sum', die(6), literal(0))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates zero + expr', () => {
    const expr = binaryOp('sum', literal(0), die(6))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates multiply by 1', () => {
    const expr = binaryOp('multiplication', die(6), literal(1))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates 1 * expr', () => {
    const expr = binaryOp('multiplication', literal(1), die(6))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('multiply by 0 becomes 0', () => {
    const expr = binaryOp('multiplication', die(6), literal(0))
    expect(DE.simplify(expr)).toEqual(literal(0))
  })

  test('0 * expr becomes 0', () => {
    const expr = binaryOp('multiplication', literal(0), die(6))
    expect(DE.simplify(expr)).toEqual(literal(0))
  })

  test('does not fold expressions with dice', () => {
    const expr = binaryOp('sum', die(6), die(8))
    expect(DE.simplify(expr)).toEqual(binaryOp('sum', die(6), die(8)))
  })

  test('recursively simplifies nested expressions', () => {
    const expr = binaryOp('sum', binaryOp('sum', literal(2), literal(3)), die(6))
    expect(DE.simplify(expr)).toEqual(binaryOp('sum', literal(5), die(6)))
  })

  test('does not modify dice-reduce', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6)), 'sum')
    expect(DE.simplify(expr)).toEqual(expr)
  })
})
