import { DiceBinOp, DiceExpression, DiceReducer, DiceUnOp, LowHigh, binaryOp, diceExpressions, diceListWithFilter, diceListWithMap, diceReduce, die, drop, explode, keep, literal, reroll, unaryOp, upTo, valueOrMore, filterableDiceExpressions } from '../src/dice-expression'
import { RollResult, binaryOpResult, diceExpressionsResult, diceFilterableResult, diceMapeableResult, diceReduceResult, dieResult, discardResult, exploded, keepResult, literalResult, normal, oneResult, rerolled, unaryOpResult } from '../src/roll-result'
import { Roller } from '../src/roller'

function maxRoller() {
  return new Roller(max => max)
}

function minRoller() {
  return new Roller(() => 1)
}

const tests: {
  test: DiceExpression
  min: RollResult
  max: RollResult
}[] = [
  {
    test: die(6),
    min: oneResult(dieResult(1, 6)),
    max: oneResult(dieResult(6, 6)),
  }, {
    test: literal(6),
    min: literalResult(6, 6),
    max: literalResult(6, 6),
  }, {
    test: diceReduce(diceExpressions(literal(1), literal(2), literal(3)), DiceReducer.Sum),
    min: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Sum, 6),
    max: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Sum, 6),
  }, {
    test: diceReduce(diceExpressions(literal(1), literal(2), literal(3)), DiceReducer.Average),
    min: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Average, 2),
    max: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Average, 2),
  }, {
    test: diceReduce(diceExpressions(literal(1), literal(2), literal(3)), DiceReducer.Min),
    min: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Min, 1),
    max: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Min, 1),
  }, {
    test: diceReduce(diceExpressions(literal(1), literal(2), literal(3)), DiceReducer.Max),
    min: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Max, 3),
    max: diceReduceResult(diceExpressionsResult([literalResult(1,1), literalResult(2,2), literalResult(3,3)]), DiceReducer.Max, 3),
  }, {
    test: diceReduce(diceListWithFilter(filterableDiceExpressions(literal(1), literal(2), literal(3)), drop(LowHigh.Low, 1)), DiceReducer.Sum),
    min: diceReduceResult(diceFilterableResult([discardResult(literalResult(1, 1)), keepResult(literalResult(2, 2)), keepResult(literalResult(3, 3))], drop(LowHigh.Low, 1)), DiceReducer.Sum, 5),
    max: diceReduceResult(diceFilterableResult([discardResult(literalResult(1, 1)), keepResult(literalResult(2, 2)), keepResult(literalResult(3, 3))], drop(LowHigh.Low, 1)), DiceReducer.Sum, 5),
  }, {
    test: diceReduce(diceListWithMap([2,3,4], explode(upTo(1), valueOrMore(3))), DiceReducer.Sum),
    min: diceReduceResult(diceMapeableResult([
      normal(dieResult(1, 2)),
      normal(dieResult(1, 3)),
      normal(dieResult(1, 4))
    ], explode(upTo(1), valueOrMore(3))), DiceReducer.Sum, 3),
    max: diceReduceResult(diceMapeableResult([
      normal(dieResult(2, 2)),
      exploded([dieResult(3, 3), dieResult(3, 3)]),
      exploded([dieResult(4, 4), dieResult(4, 4)])
    ], explode(upTo(1), valueOrMore(3))), DiceReducer.Sum, 16),
  }, {
    test: diceReduce(diceListWithMap([2,3,4], reroll(upTo(1), valueOrMore(3))), DiceReducer.Sum),
    min: diceReduceResult(diceMapeableResult([
      normal(dieResult(1, 2)),
      normal(dieResult(1, 3)),
      normal(dieResult(1, 4))
    ], reroll(upTo(1), valueOrMore(3))), DiceReducer.Sum, 3),
    max: diceReduceResult(diceMapeableResult([
      normal(dieResult(2, 2)),
      rerolled([dieResult(3, 3), dieResult(3, 3)]),
      rerolled([dieResult(4, 4), dieResult(4, 4)])
    ], reroll(upTo(1), valueOrMore(3))), DiceReducer.Sum, 9),
  }, {
    test: binaryOp(DiceBinOp.Sum, literal(3), die(2)),
    min: binaryOpResult(
      DiceBinOp.Sum,
      literalResult(3, 3),
      oneResult(dieResult(1, 2)),
      4
    ),
    max: binaryOpResult(
      DiceBinOp.Sum,
      literalResult(3, 3),
      oneResult(dieResult(2, 2)),
      5
    ),
  }, {
    test: unaryOp(DiceUnOp.Negate, literal(3)),
    min: unaryOpResult(
      DiceUnOp.Negate,
      literalResult(3, 3),
      -3
    ),
    max: unaryOpResult(
      DiceUnOp.Negate,
      literalResult(3, 3),
      -3
    ),
  }
]

describe('dice roller', () => {
  test('min/max', () => {
    for (const { test, min, max } of tests) {
      expect(minRoller().roll(test)).toEqual(min)
      expect(maxRoller().roll(test)).toEqual(max)
    }
  })
})
