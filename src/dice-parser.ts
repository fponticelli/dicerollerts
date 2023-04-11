import { type TextInput } from 'partsing/text'
import { DE } from './dice-expression-domain'
import {
  LowHigh,
  type DiceExpression,
  between,
  valueOrMore,
  valueOrLess,
  exact,
  type Range,
  type DiceFunctor,
  upTo,
  always,
  type UpTo,
  type Always,
  unaryOp,
  DiceUnOp,
  DiceBinOp,
  binaryOp,
  die as makeDie,
  diceReduce as makeDiceReduce,
  literal,
  type DiceReduceable,
  DiceReducer,
  diceExpressions as makeDiceExpressions,
  filterableDiceArray,
  diceListWithFilter,
  drop,
  keep,
  filterableDiceExpressions,
  diceListWithMap,
  explode,
  reroll,
  type DiceReduce
} from './dice-expression'
import { type DecodeError } from 'partsing/error'
import { type Decoder } from 'partsing/core/decoder'
import { type DecodeResult } from 'partsing/core/result'
import { matchChar, regexp, match, matchAnyCharOf } from 'partsing/text'
import { oneOf, lazy } from 'partsing/core/decoder'

const PLUS = matchChar('+')
const MINUS = matchChar('-')
const positive = regexp(/^[+]?([1-9][0-9]*)/, 1).map(Number)
const negative = regexp(/^(-[1-9][0-9]*)/).map(Number)
const whole = oneOf(positive, negative)
const D = oneOf(matchChar('d'), matchChar('D'))

const OPEN_SET_BRACKET = matchChar('(')
const CLOSE_SET_BRACKET = matchChar(')')
const COMMA = matchChar(',')
const PERCENT = matchChar('%')
const WS = regexp(/^[\s_]+/m)
const OWS = regexp(/^[\s_]*/m)
// const OWS = WS.or(match(""))

const MULTIPLICATION = matchAnyCharOf('*⋅×x') // .mapError(_ => '×')
const DIVISION = matchAnyCharOf('/÷:') // .mapError(_ => '÷')

const lowOrHigh =
  oneOf(
    oneOf(match('lowest'), match('low')).map(_ => LowHigh.Low),
    oneOf(match('highest'), match('high')).map(_ => LowHigh.High)
  )

const dirValue = (prefix: Decoder<TextInput, unknown, DecodeError>, alt: LowHigh): Decoder<TextInput, { dir: LowHigh, value: number }, DecodeError> =>
  prefix.skipNext(OWS).pickNext(oneOf(
    lowOrHigh.flatMap(dir => {
      return OWS.pickNext(positive.map(value => ({ dir, value })))
    }),
    positive.map(value => ({ dir: alt, value }))
  ))

enum MoreOrLess {
  More = 'more',
  Less = 'less'
}

const moreLess =
  oneOf(
    match('more').map(_ => MoreOrLess.More),
    match('less').map(_ => MoreOrLess.Less)
  )

const orMoreLess = match('or').skipNext(OWS).pickNext(moreLess) // .mapError(_ => 'or (more|less)')
const on = match('on').skipNext(WS).pickNext(positive)
const range = oneOf(
  on.flatMap(min => {
    return OWS.pickNext(positive.map(max => between(min, max)))
  }),
  on.flatMap(value => {
    return OWS.pickNext(orMoreLess.map(oml => {
      switch (oml) {
        case MoreOrLess.More: return valueOrMore(value)
        case MoreOrLess.Less: return valueOrLess(value)
        default: throw new Error('unreachable')
      }
    }))
  }),
  on.map(exact)
)

const times = oneOf(
  match('once').withResult(1),
  match('twice').withResult(2),
  match('thrice').withResult(3),
  positive.skipNext(OWS.skipNext(match('times')))
)

const functorTimes = oneOf(
  times.map(upTo),
  OWS.skipNext(match('always')).withResult(always()),
  match('').withResult(always()) // strange empty matching
)

const diceFunctorConst = (p: string, f: (times: UpTo | Always, range: Range) => DiceFunctor): Decoder<TextInput, DiceFunctor, DecodeError> =>
  match(p).skipNext(OWS).pickNext(functorTimes.flatMap(times => {
    return OWS.pickNext(range.map(range => f(times, range)))
  }))

const diceFunctor = lazy(() => oneOf(
  matchChar('e').skipNext(OWS).pickNext(positive.map(v => explode(always(), valueOrMore(v)))),
  matchChar('r').skipNext(OWS).pickNext(positive.map(v => reroll(always(), valueOrLess(v)))),
  diceFunctorConst('explode', explode),
  diceFunctorConst('reroll', reroll)
))

const SUM = match('sum')
const AVERAGE = oneOf(match('average'), match('avg'))
const MEDIAN = oneOf(match('median'), match('med'))
const MIN = oneOf(match('min'), match('minimum'), match('take least'))
const MAX = oneOf(match('max'), match('maximum'), match('take best'))

const DEFAULT_DIE_SIDES = 6
const die = oneOf(
  D.skipNext(PERCENT).withResult(100),
  D.pickNext(positive),
  D.withResult(DEFAULT_DIE_SIDES)
) // .mapError(_ => 'one die')

const negate = lazy(() => MINUS.pickNext(termExpression).map(expr => unaryOp(DiceUnOp.Negate, expr))) // .mapError(_ => 'negate')
const unary = negate

const binOpSymbol = oneOf(
  PLUS.withResult(DiceBinOp.Sum),
  MINUS.withResult(DiceBinOp.Difference),
  MULTIPLICATION.withResult(DiceBinOp.Multiplication),
  DIVISION.withResult(DiceBinOp.Division)
)

const opRight = OWS.pickNext(binOpSymbol.flatMap(op => {
  return OWS.pickNext(termExpression.map(right => ({ op, right })))
}))

const binop = lazy(() => {
  return termExpression.flatMap(left => {
    return opRight.atLeast(1).map(a => {
      return a.reduce((left: DiceExpression, item) => {
        switch (item.op) {
          case DiceBinOp.Sum:
          case DiceBinOp.Difference:
            return binaryOp(item.op, left, item.right)
          case DiceBinOp.Division:
          case DiceBinOp.Multiplication:
            switch (left.type) {
              case 'binary-op':
                return binaryOp(left.op, left.left, binaryOp(item.op, left.right, item.right))
              default:
                return binaryOp(item.op, left, item.right)
            }
          default:
            throw new Error('unreachable')
        }
      }, left)
    })
  })
})

const dieExpression = oneOf(
  matchChar('1').pickNext(die.map(makeDie)),
  die.map(makeDie)
) // mapError 'die'
const literalExpression = whole.map(literal) // mapError 'literal'
const diceReduce = (reduceable: Decoder<TextInput, DiceReduceable, DecodeError>): Decoder<TextInput, DiceReduce, DecodeError> => {
  return reduceable.flatMap(red => {
    return OWS.pickNext(oneOf(
      SUM.withResult(DiceReducer.Sum),
      AVERAGE.withResult(DiceReducer.Average),
      MEDIAN.withResult(DiceReducer.Median),
      MIN.withResult(DiceReducer.Min),
      MAX.withResult(DiceReducer.Max)
    )).map(reducer => makeDiceReduce(red, reducer))
  }).or(
    reduceable.map(v => makeDiceReduce(v, DiceReducer.Sum))
  )
}

const commaSeparated = <T>(element: Decoder<TextInput, T, DecodeError>): Decoder<TextInput, T[], DecodeError> => {
  return element
    .atLeastWithSeparator(1, OWS.skipNext(COMMA).skipNext(OWS))
    .surroundedBy(OPEN_SET_BRACKET.skipNext(OWS), OWS.skipNext(CLOSE_SET_BRACKET))

  // return OPEN_SET_BRACKET.skipNext(OWS).pickNext(element
  //   .atLeastWithSeparator(1, OWS.skipNext(COMMA).skipNext(OWS)))
  //   .skipNext(OWS.skipNext(CLOSE_SET_BRACKET))
}

const diceExpressions = lazy((): Decoder<TextInput, DiceReduceable, DecodeError> => {
  return oneOf(
    positive.flatMap(rolls => {
      return die.map(sides => {
        const dice = [...Array(rolls)].map(_ => makeDie(sides))
        return makeDiceExpressions(...dice)
      })
    }),
    commaSeparated(expression).map(v => makeDiceExpressions(...v))
  )
})

const diceFilterable = lazy((): Decoder<TextInput, DiceReduceable, DecodeError> => {
  return oneOf(
    positive.flatMap((rolls) => {
      return die.map(sides => {
        const dice = [...Array(rolls)].map(_ => sides)
        return filterableDiceArray(dice)
      })
    }),
    commaSeparated(die).map(dice => filterableDiceArray(dice)),
    commaSeparated(expression).map(v => filterableDiceExpressions(...v))
  ).flatMap(filterable => {
    return OWS.pickNext(oneOf(
      matchChar('d').skipNext(OWS).pickNext(positive.map(v => drop(LowHigh.Low, v))),
      dirValue(match('drop'), LowHigh.Low).map(v => drop(v.dir, v.value)),
      matchChar('k').skipNext(OWS).pickNext(positive.map(v => keep(LowHigh.High, v))),
      dirValue(match('keep'), LowHigh.High).map(v => keep(v.dir, v.value))
    )).map(dk => {
      return diceListWithFilter(filterable, dk)
    })
  })
})

const diceMapeable = lazy((): Decoder<TextInput, DiceReduceable, DecodeError> => {
  return oneOf(
    positive.flatMap(rolls => {
      return die.map(sides => {
        return [...Array(rolls)].map(_ => sides)
      })
    }),
    commaSeparated(die),
    matchChar('1').pickNext(die).map(v => [v]),
    die.map(v => [v])
  ).flatMap(arr => {
    return OWS.pickNext(diceFunctor.map(functor => {
      return diceListWithMap(arr, functor)
    }))
  })
})

const termExpression = lazy((): Decoder<TextInput, DiceExpression, DecodeError> => {
  return oneOf(
    diceReduce(diceMapeable),
    diceReduce(diceFilterable),
    diceReduce(diceExpressions),
    dieExpression,
    literalExpression,
    unary
  )
})

const expression = lazy((): Decoder<TextInput, DiceExpression, DecodeError> => {
  return oneOf(
    binop,
    termExpression
  )
}) // mapError 'expression'

const grammar: Decoder<TextInput, DiceExpression, DecodeError> =
  OWS.pickNext(expression).skipNext(OWS)

const decode = (input: string): DecodeResult<TextInput, DiceExpression, DecodeError> => {
  return grammar.run({ input, index: 0 })
}

export const DiceParser = {
  normalize: (input: string) => {
    const result = DiceParser.parseOrNull(input)
    return result !== null ? DE.toString(result) : null
  },
  parse: (input: string): DecodeResult<TextInput, DiceExpression, DecodeError> => {
    return decode(input)
  },
  parseOrNull: (input: string): null | DiceExpression => {
    const result = decode(input)
    if (result.isSuccess()) {
      return result.value
    } else {
      return null
    }
  }
}
