import { type TextInput } from 'partsing/text'
import { DE } from './dice-expression-domain'
import {
  type LowHigh,
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
  binaryOp,
  die as makeDie,
  diceReduce as makeDiceReduce,
  literal,
  type DiceReduceable,
  type DiceReducer,
  type CountReducer,
  diceExpressions as makeDiceExpressions,
  filterableDiceArray,
  diceListWithFilter,
  drop,
  keep,
  filterableDiceExpressions,
  diceListWithMap,
  explode,
  reroll,
  compound,
  type DiceReduce,
  emphasis,
  customDie as makeCustomDie,
} from './dice-expression'
import { CustomError, type DecodeError } from 'partsing/error'
import { buildParseErrors, type ParseWithErrorsResult } from './parse-error'
import { type Decoder } from 'partsing/core/decoder'
import { type DecodeResult } from 'partsing/core/result'
import { matchChar, regexp, match, matchAnyCharOf, eoi } from 'partsing/text'
import { oneOf, lazy } from 'partsing/core/decoder'

const PLUS = matchChar('+')
const MINUS = matchChar('-')
const positive = regexp(/^[+]?([1-9][0-9]*)/, 1)
  .map(Number)
  .withFailure(new CustomError('positive number') as DecodeError)
const negative = regexp(/^(-[1-9][0-9]*)/)
  .map(Number)
  .withFailure(new CustomError('negative number'))
const whole = oneOf(positive, negative).withFailure(new CustomError('number'))
const D = oneOf(matchChar('d'), matchChar('D'))

const OPEN_SET_BRACKET = matchChar('(')
const CLOSE_SET_BRACKET = matchChar(')')
const COMMA = matchChar(',')
const PERCENT = matchChar('%')
const WS = regexp(/^[\s_]+/m)
const OWS = regexp(/^[\s_]*/m)
// const OWS = WS.or(match(""))

const MULTIPLICATION = matchAnyCharOf('*⋅×x').withFailure(
  new CustomError('multiplication'),
)
const DIVISION = matchAnyCharOf('/÷:').withFailure(new CustomError('division'))

const lowOrHigh = oneOf(
  oneOf(match('lowest'), match('low')).map((_) => 'low' as const),
  oneOf(match('highest'), match('high')).map((_) => 'high' as const),
)

const dirValue = (
  prefix: Decoder<TextInput, unknown, DecodeError>,
  alt: LowHigh,
): Decoder<TextInput, { dir: LowHigh; value: number }, DecodeError> =>
  prefix.skipNext(OWS).pickNext(
    oneOf(
      lowOrHigh.flatMap((dir) => {
        return OWS.pickNext(positive.map((value) => ({ dir, value })))
      }),
      positive.map((value) => ({ dir: alt, value })),
    ),
  )

const moreLess = oneOf(
  match('more').map((_) => 'more' as const),
  match('less').map((_) => 'less' as const),
)

const orMoreLess = match('or')
  .skipNext(OWS)
  .pickNext(moreLess)
  .withFailure(new CustomError('or (more|less)'))
const on = match('on').skipNext(WS).pickNext(positive)
const range = oneOf(
  on.flatMap((min) => {
    return OWS.pickNext(positive.map((max) => between(min, max)))
  }),
  on.flatMap((value) => {
    return OWS.pickNext(
      orMoreLess.map((oml) => {
        switch (oml) {
          case 'more':
            return valueOrMore(value)
          case 'less':
            return valueOrLess(value)
          default:
            throw new Error('unreachable')
        }
      }),
    )
  }),
  on.map(exact),
)

const times = oneOf(
  match('once').withResult(1),
  match('twice').withResult(2),
  match('thrice').withResult(3),
  positive.skipNext(OWS.skipNext(match('times'))),
)

const functorTimes = oneOf(
  times.map(upTo),
  OWS.skipNext(match('always')).withResult(always()),
  match('').withResult(always()), // strange empty matching
)

const emphasisConst = lazy(() =>
  oneOf(
    match('emphasis')
      .skipNext(WS)
      .flatMap(() => {
        return oneOf(
          match('high').withResult(emphasis('high', 'average')),
          match('low').withResult(emphasis('low', 'average')),
          match('reroll').withResult(emphasis('reroll', 'average')),
        )
      }),
    match('emphasis').withResult(emphasis('reroll', 'average')),
    match('furthest from')
      .skipNext(WS)
      .pickNext(positive)
      .flatMap((value) => {
        return oneOf(
          WS.skipNext(match('high')).withResult(emphasis('high', value)),
          WS.skipNext(match('low')).withResult(emphasis('low', value)),
          WS.skipNext(match('reroll')).withResult(emphasis('reroll', value)),
        )
      }),
    match('furthest from')
      .skipNext(WS)
      .pickNext(positive)
      .map((value) => emphasis('reroll', value)),
  ),
)

const diceFunctorConst = (
  p: string,
  f: (times: UpTo | Always, range: Range) => DiceFunctor,
): Decoder<TextInput, DiceFunctor, DecodeError> =>
  match(p)
    .skipNext(OWS)
    .pickNext(
      functorTimes.flatMap((times) => {
        return OWS.pickNext(range.map((range) => f(times, range)))
      }),
    )

const diceFunctor = lazy(() =>
  oneOf(
    emphasisConst,
    diceFunctorConst('compound', compound),
    diceFunctorConst('explode', explode),
    diceFunctorConst('reroll', reroll),
    match('ce')
      .skipNext(OWS)
      .pickNext(positive.map((v) => compound(always(), valueOrMore(v)))),
    matchChar('e')
      .skipNext(OWS)
      .pickNext(positive.map((v) => explode(always(), valueOrMore(v)))),
    matchChar('r')
      .skipNext(OWS)
      .pickNext(positive.map((v) => reroll(always(), valueOrLess(v)))),
  ),
)

const COUNT = match('count')
const GTE = match('>=')
const LTE = match('<=')
const EQ = matchChar('=')

const countThreshold: Decoder<TextInput, CountReducer, DecodeError> =
  COUNT.skipNext(WS).pickNext(
    oneOf(
      GTE.skipNext(OWS).pickNext(
        positive.map(
          (v): CountReducer => ({ type: 'count', threshold: valueOrMore(v) }),
        ),
      ),
      LTE.skipNext(OWS).pickNext(
        positive.map(
          (v): CountReducer => ({ type: 'count', threshold: valueOrLess(v) }),
        ),
      ),
      EQ.skipNext(OWS).pickNext(
        positive.map(
          (v): CountReducer => ({ type: 'count', threshold: exact(v) }),
        ),
      ),
    ),
  )

const SUM = match('sum')
const AVERAGE = oneOf(match('average'), match('avg'))
const MEDIAN = oneOf(match('median'), match('med'))
const MIN = oneOf(match('minimum'), match('min'), match('take least'))
const MAX = oneOf(match('maximum'), match('max'), match('take best'))

const DEFAULT_DIE_SIDES = 6
const die = oneOf(
  D.skipNext(PERCENT).withResult(100),
  D.pickNext(positive),
  D.withResult(DEFAULT_DIE_SIDES),
).withFailure(new CustomError('one die'))

const negate = lazy(() =>
  MINUS.pickNext(termExpression).map((expr) => unaryOp('negate', expr)),
) // .mapError(_ => 'negate')
const unary = negate

const addSubSymbol: Decoder<TextInput, 'sum' | 'difference', DecodeError> =
  oneOf(
    PLUS.withResult('sum' as const),
    MINUS.withResult('difference' as const),
  )

const mulDivSymbol: Decoder<
  TextInput,
  'multiplication' | 'division',
  DecodeError
> = oneOf(
  MULTIPLICATION.withResult('multiplication' as const),
  DIVISION.withResult('division' as const),
)

const mulDivRight: Decoder<
  TextInput,
  { op: 'multiplication' | 'division'; right: DiceExpression },
  DecodeError
> = OWS.pickNext(
  mulDivSymbol.flatMap((op) => {
    return OWS.pickNext(termExpression.map((right) => ({ op, right })))
  }),
)

const mulDivExpr: Decoder<TextInput, DiceExpression, DecodeError> = lazy(() =>
  termExpression.flatMap((left) => {
    return mulDivRight.atLeast(1).map((a) => {
      return a.reduce(
        (acc: DiceExpression, item) => binaryOp(item.op, acc, item.right),
        left,
      )
    })
  }),
)

const addSubFactor: Decoder<TextInput, DiceExpression, DecodeError> = lazy(() =>
  oneOf(mulDivExpr, termExpression),
)

const addSubRight: Decoder<
  TextInput,
  { op: 'sum' | 'difference'; right: DiceExpression },
  DecodeError
> = OWS.pickNext(
  addSubSymbol.flatMap((op) => {
    return OWS.pickNext(addSubFactor.map((right) => ({ op, right })))
  }),
)

const binop = lazy(() => {
  return addSubFactor.flatMap((left) => {
    return addSubRight.atLeast(1).map((a) => {
      return a.reduce(
        (acc: DiceExpression, item) => binaryOp(item.op, acc, item.right),
        left,
      )
    })
  })
})

const dieExpression = oneOf(
  matchChar('1').pickNext(die.map(makeDie)),
  die.map(makeDie),
) // mapError 'die'
const literalExpression = whole.map(literal)
const diceReduce = (
  reduceable: Decoder<TextInput, DiceReduceable, DecodeError>,
): Decoder<TextInput, DiceReduce, DecodeError> => {
  return oneOf(
    reduceable.flatMap((red) => {
      return OWS.pickNext(countThreshold).map((reducer) =>
        makeDiceReduce(red, reducer),
      )
    }),
    reduceable.flatMap((red) => {
      return OWS.pickNext(
        oneOf(
          SUM.withResult('sum'),
          AVERAGE.withResult('average'),
          MEDIAN.withResult('median'),
          MIN.withResult('min'),
          MAX.withResult('max'),
        ),
      ).map((reducer) => makeDiceReduce(red, reducer as DiceReducer))
    }),
    reduceable.map((v) => makeDiceReduce(v, 'sum')),
  )
}

const commaSeparated = <T>(
  element: Decoder<TextInput, T, DecodeError>,
): Decoder<TextInput, T[], DecodeError> => {
  return element
    .atLeastWithSeparator(1, OWS.skipNext(COMMA).skipNext(OWS))
    .surroundedBy(
      OPEN_SET_BRACKET.skipNext(OWS),
      OWS.skipNext(CLOSE_SET_BRACKET),
    )

  // return OPEN_SET_BRACKET.skipNext(OWS).pickNext(element
  //   .atLeastWithSeparator(1, OWS.skipNext(COMMA).skipNext(OWS)))
  //   .skipNext(OWS.skipNext(CLOSE_SET_BRACKET))
}

const diceExpressions = lazy(
  (): Decoder<TextInput, DiceReduceable, DecodeError> => {
    return oneOf(
      positive.flatMap((rolls) => {
        return die.map((sides) => {
          const dice = [...Array(rolls)].map((_) => makeDie(sides))
          return makeDiceExpressions(...dice)
        })
      }),
      commaSeparated(expression).map((v) => makeDiceExpressions(...v)),
    )
  },
)

const diceFilterable = lazy(
  (): Decoder<TextInput, DiceReduceable, DecodeError> => {
    return oneOf(
      positive.flatMap((rolls) => {
        return die.map((sides) => {
          const dice = [...Array(rolls)].map((_) => sides)
          return filterableDiceArray(dice)
        })
      }),
      commaSeparated(die).map((dice) => filterableDiceArray(dice)),
      commaSeparated(expression).map((v) => filterableDiceExpressions(...v)),
    ).flatMap((filterable) => {
      return OWS.pickNext(
        oneOf(
          matchChar('d')
            .skipNext(OWS)
            .pickNext(positive.map((v) => drop('low', v))),
          dirValue(match('drop'), 'low').map((v) => drop(v.dir, v.value)),
          matchChar('k')
            .skipNext(OWS)
            .pickNext(positive.map((v) => keep('high', v))),
          dirValue(match('keep'), 'high').map((v) => keep(v.dir, v.value)),
        ),
      ).map((dk) => {
        return diceListWithFilter(filterable, dk)
      })
    })
  },
)

const diceMapeable = lazy(
  (): Decoder<TextInput, DiceReduceable, DecodeError> => {
    return oneOf(
      positive.flatMap((rolls) => {
        return die.map((sides) => {
          return [...Array(rolls)].map((_) => sides)
        })
      }),
      commaSeparated(die),
      matchChar('1')
        .pickNext(die)
        .map((v) => [v]),
      die.map((v) => [v]),
    ).flatMap((arr) => {
      return OWS.pickNext(
        diceFunctor.map((functor) => {
          return diceListWithMap(arr, functor)
        }),
      )
    })
  },
)

const customDieFaces = D.skipNext(matchChar('{'))
  .skipNext(OWS)
  .pickNext(
    whole.atLeastWithSeparator(
      1,
      OWS.skipNext(COMMA).skipNext(OWS).withFailure(new CustomError(',')),
    ),
  )
  .skipNext(OWS.skipNext(matchChar('}')))

const customDieExpression = customDieFaces.map(makeCustomDie)

const fateDieExpression = oneOf(
  positive.flatMap((count) => {
    return D.skipNext(matchChar('F')).withResult(
      count === 1
        ? makeCustomDie([-1, 0, 1])
        : makeDiceReduce(
            makeDiceExpressions(
              ...Array.from({ length: count }, () => makeCustomDie([-1, 0, 1])),
            ),
            'sum' as DiceReducer,
          ),
    )
  }),
  D.skipNext(matchChar('F')).withResult(makeCustomDie([-1, 0, 1])),
)

const diceCountShorthand = lazy(
  (): Decoder<TextInput, DiceReduce, DecodeError> => {
    return positive.flatMap((rolls) => {
      return (die as Decoder<TextInput, number, DecodeError>).flatMap(
        (sides) => {
          return matchChar('c')
            .skipNext(OWS)
            .pickNext(positive)
            .map((v) => {
              const dice = Array.from({ length: rolls }, () => makeDie(sides))
              return makeDiceReduce(makeDiceExpressions(...dice), {
                type: 'count' as const,
                threshold: valueOrMore(v),
              } as CountReducer)
            })
        },
      )
    })
  },
)

const termExpression = lazy(
  (): Decoder<TextInput, DiceExpression, DecodeError> => {
    return oneOf(
      diceReduce(diceMapeable),
      diceReduce(diceFilterable),
      fateDieExpression,
      diceCountShorthand,
      diceReduce(diceExpressions),
      customDieExpression,
      dieExpression,
      literalExpression,
      unary,
    )
  },
)

const expression = lazy((): Decoder<TextInput, DiceExpression, DecodeError> => {
  return oneOf(binop, addSubFactor)
}).withFailure(new CustomError('expression'))

const grammar: Decoder<TextInput, DiceExpression, DecodeError> = OWS.pickNext(
  expression,
)
  .skipNext(OWS)
  .skipNext(eoi)

const decode = (
  input: string,
): DecodeResult<TextInput, DiceExpression, DecodeError> => {
  return grammar.run({ input, index: 0 })
}

export const DiceParser = {
  normalize: (input: string) => {
    const result = DiceParser.parseOrNull(input)
    return result !== null ? DE.toString(result) : null
  },
  parse: (
    input: string,
  ): DecodeResult<TextInput, DiceExpression, DecodeError> => {
    return decode(input)
  },
  parseOrNull: (input: string): null | DiceExpression => {
    const result = decode(input)
    if (result.isSuccess()) {
      return result.value
    } else {
      return null
    }
  },
  parseWithErrors(input: string): ParseWithErrorsResult<DiceExpression> {
    const result = decode(input)
    if (result.isSuccess()) {
      return { success: true, value: result.value }
    }
    const failures = result.getUnsafeFailures()
    const messages = failures.map((f) => {
      if (f instanceof CustomError) {
        return f.message
      }
      return String(f)
    })
    // DecodeFailure.input is TextInput with { input: string, index: number }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failureInput = (result as any).input as {
      input: string
      index: number
    }
    const failureIndex = failureInput?.index ?? 0
    const errors = buildParseErrors(input, failureIndex, messages)
    return { success: false, errors }
  },
}
