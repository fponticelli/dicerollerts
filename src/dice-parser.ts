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
  type DiceFilterable,
  emphasis,
  customDie as makeCustomDie,
  type NDiceParam,
  nDice as makeNDice,
  nDiceLit,
  nDiceVar,
  diceVariableRef as makeDiceVariableRef,
  filterableHomogeneous,
  filterableHomogeneousCustom,
  diceListWithMapHomogeneous,
  homogeneousDiceExpressions,
  homogeneousCustomDice,
} from './dice-expression'
import { CustomError, type DecodeError } from 'partsing/error'
import { buildParseErrors, type ParseWithErrorsResult } from './parse-error'
import { Decoder } from 'partsing/core/decoder'
import {
  type DecodeResult,
  success as decodeSuccess,
  failure as decodeFailure,
} from 'partsing/core/result'
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
const GT = matchChar('>')
const LT = matchChar('<')
const EQ = matchChar('=')
const AND = match('and')
const EXACTLY = match('exactly')
const DOTDOT = match('..')

// Range body after an optional `on` keyword. Accepts:
//   - `N or more` -> valueOrMore(N)
//   - `N or less` -> valueOrLess(N)
//   - `N..M`      -> between(N, M)
//   - `N`         -> exact(N)
const rangeBody: Decoder<TextInput, Range, DecodeError> = positive.flatMap(
  (n) =>
    oneOf(
      OWS.skipNext(DOTDOT)
        .skipNext(OWS)
        .pickNext(positive.map((m) => between(n, m))),
      WS.pickNext(orMoreLess).map((oml) =>
        oml === 'more' ? valueOrMore(n) : valueOrLess(n),
      ),
      Decoder.of(
        (input: TextInput): DecodeResult<TextInput, Range, DecodeError> =>
          decodeSuccess<TextInput, Range, DecodeError>(input, exact(n)),
      ),
    ),
)

// One threshold inside a `count` reducer. Supports operator forms (>=, <=, >,
// <, =), trigger forms (`on N or more`, `on N or less`, `on N..M`, `on N`),
// the keyword form `exactly N`, and the bare form (`N or more`, `N..M`, `N`).
// Strict `>` / `<` translate to `value-or-more(v+1)` / `value-or-less(v-1)`.
const singleCountThreshold: Decoder<TextInput, Range, DecodeError> = oneOf(
  GTE.skipNext(OWS).pickNext(positive.map((v) => valueOrMore(v))),
  LTE.skipNext(OWS).pickNext(positive.map((v) => valueOrLess(v))),
  GT.skipNext(OWS).pickNext(positive.map((v) => valueOrMore(v + 1))),
  LT.skipNext(OWS).pickNext(positive.map((v) => valueOrLess(v - 1))),
  EQ.skipNext(OWS).pickNext(positive.map((v) => exact(v))),
  EXACTLY.skipNext(WS).pickNext(positive.map((v) => exact(v))),
  match('on').skipNext(WS).pickNext(rangeBody),
  rangeBody,
)

const countThreshold: Decoder<TextInput, CountReducer, DecodeError> =
  COUNT.skipNext(WS).pickNext(
    singleCountThreshold
      .atLeastWithSeparator(1, WS.skipNext(AND).skipNext(WS))
      .map((thresholds): CountReducer => ({ type: 'count', thresholds })),
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

// Match a `$name` variable reference. Names follow the same rules as the
// program parser: lowercase letter or underscore, followed by lowercase,
// digit, or underscore.
const VAR_NAME: Decoder<TextInput, string, DecodeError> = regexp(
  /^\$([a-z_][a-z0-9_]*)/,
  1,
).withFailure(new CustomError('variable reference')) as Decoder<
  TextInput,
  string,
  DecodeError
>

const variableRefExpr = VAR_NAME.map(makeDiceVariableRef)

// Match either a literal positive integer or a $variable as an n-dice param.
const nDiceCount: Decoder<TextInput, NDiceParam, DecodeError> = oneOf(
  positive.map(nDiceLit) as Decoder<TextInput, NDiceParam, DecodeError>,
  VAR_NAME.map(nDiceVar) as Decoder<TextInput, NDiceParam, DecodeError>,
)

// Sides position for parametric `$varD<sides>` chains used by reducer/
// filterable/mapeable paths. Accepts %, $variable, or literal positive int.
const sidesParam: Decoder<TextInput, NDiceParam, DecodeError> = oneOf(
  PERCENT.withResult(nDiceLit(100)) as Decoder<
    TextInput,
    NDiceParam,
    DecodeError
  >,
  VAR_NAME.map(nDiceVar) as Decoder<TextInput, NDiceParam, DecodeError>,
  positive.map(nDiceLit) as Decoder<TextInput, NDiceParam, DecodeError>,
)

// Reducer keywords that, when following an n-dice form, indicate the
// expression should be parsed via the dice-reduce path instead. We look for
// these to decide whether to commit to NDice or fall through.
const REDUCER_LOOKAHEAD =
  /^[\s_]*(sum|average|avg|median|med|minimum|min|maximum|max|take\s+least|take\s+best|count\s+|c\s*[1-9]|d\s*[1-9]|k\s*[1-9]|drop\s|keep\s|explode|reroll|compound|emphasis|furthest\s+from|ce\s*[1-9]|e\s*[1-9]|r\s*[1-9])/

const noReducerLookahead: Decoder<TextInput, void, DecodeError> = Decoder.of(
  (input: TextInput): DecodeResult<TextInput, void, DecodeError> => {
    const remaining = input.input.substring(input.index)
    if (REDUCER_LOOKAHEAD.test(remaining)) {
      return decodeFailure<TextInput, void, DecodeError>(
        input,
        new CustomError('not a reducer'),
      )
    }
    return decodeSuccess<TextInput, void, DecodeError>(input, undefined)
  },
)

const defaultNDiceSides: Decoder<TextInput, NDiceParam, DecodeError> =
  Decoder.of(
    (input: TextInput): DecodeResult<TextInput, NDiceParam, DecodeError> =>
      decodeSuccess<TextInput, NDiceParam, DecodeError>(
        input,
        nDiceLit(DEFAULT_DIE_SIDES),
      ),
  )

const nDiceSides: Decoder<TextInput, NDiceParam, DecodeError> = oneOf(
  PERCENT.withResult(nDiceLit(100)) as Decoder<
    TextInput,
    NDiceParam,
    DecodeError
  >,
  VAR_NAME.map(nDiceVar) as Decoder<TextInput, NDiceParam, DecodeError>,
  positive.map(nDiceLit) as Decoder<TextInput, NDiceParam, DecodeError>,
  defaultNDiceSides,
)

// Plain `Nd<sides>` form (no reducer/functor/filter). Always produces an
// NDice node — never expands at parse time. Supports parametric forms via
// $vars in count and/or sides positions.
//
// To preserve existing AST shape, we don't take the simplest case
// (count=1 literal AND sides literal) — that falls through to `dieExpression`
// which produces a `Die(sides)` node directly. NDice is used whenever
// count > 1, count is a variable, or sides is a variable.
const nDicePlain: Decoder<TextInput, DiceExpression, DecodeError> =
  nDiceCount.flatMap((count) => {
    return D.pickNext(
      nDiceSides.flatMap((sides) => {
        // Skip the trivial `1d<literal>` case (handled by dieExpression).
        if (
          count.kind === 'literal' &&
          count.value === 1 &&
          sides.kind === 'literal'
        ) {
          return Decoder.of(
            (
              input: TextInput,
            ): DecodeResult<TextInput, DiceExpression, DecodeError> =>
              decodeFailure<TextInput, DiceExpression, DecodeError>(
                input,
                new CustomError('not parametric'),
              ),
          )
        }
        return noReducerLookahead.map(
          (): DiceExpression => makeNDice(count, sides),
        )
      }),
    )
  })

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
    const literalHomogeneous: Decoder<TextInput, DiceReduceable, DecodeError> =
      positive.flatMap((rolls) => {
        return die.map(
          (sides): DiceReduceable =>
            homogeneousDiceExpressions(nDiceLit(rolls), nDiceLit(sides)),
        )
      })
    const variableHomogeneous: Decoder<TextInput, DiceReduceable, DecodeError> =
      VAR_NAME.flatMap((countVar) => {
        return D.pickNext(
          sidesParam.map(
            (sides): DiceReduceable =>
              homogeneousDiceExpressions(nDiceVar(countVar), sides),
          ),
        )
      })
    const heterogeneous: Decoder<TextInput, DiceReduceable, DecodeError> =
      commaSeparated(expression).map(
        (v): DiceReduceable => makeDiceExpressions(...v),
      )
    return oneOf(literalHomogeneous, variableHomogeneous, heterogeneous)
  },
)

const diceFilterable = lazy(
  (): Decoder<TextInput, DiceReduceable, DecodeError> => {
    const litFate: Decoder<TextInput, DiceFilterable, DecodeError> =
      positive.flatMap((rolls) => {
        return D.skipNext(matchChar('F')).withResult(
          filterableHomogeneousCustom(
            nDiceLit(rolls),
            [-1, 0, 1],
          ) as DiceFilterable,
        )
      })
    const varFate: Decoder<TextInput, DiceFilterable, DecodeError> =
      VAR_NAME.flatMap((countVar) => {
        return D.skipNext(matchChar('F')).withResult(
          filterableHomogeneousCustom(
            nDiceVar(countVar),
            [-1, 0, 1],
          ) as DiceFilterable,
        )
      })
    const litHomogeneous: Decoder<TextInput, DiceFilterable, DecodeError> =
      positive.flatMap((rolls) => {
        return die.map(
          (sides): DiceFilterable =>
            filterableHomogeneous(nDiceLit(rolls), nDiceLit(sides)),
        )
      })
    const varHomogeneous: Decoder<TextInput, DiceFilterable, DecodeError> =
      VAR_NAME.flatMap((countVar) => {
        return D.pickNext(
          sidesParam.map(
            (sides): DiceFilterable =>
              filterableHomogeneous(nDiceVar(countVar), sides),
          ),
        )
      })
    const heteroDice: Decoder<TextInput, DiceFilterable, DecodeError> =
      commaSeparated(die).map(
        (dice): DiceFilterable => filterableDiceArray(dice),
      )
    const heteroExprs: Decoder<TextInput, DiceFilterable, DecodeError> =
      commaSeparated(expression).map(
        (v): DiceFilterable => filterableDiceExpressions(...v),
      )
    return oneOf(
      litFate,
      varFate,
      litHomogeneous,
      varHomogeneous,
      heteroDice,
      heteroExprs,
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

// Helper: parses a homogeneous "N copies of d<sides>" token in mapeable
// position. Returns either a compact homogeneous form or a heterogeneous
// array (single die expressed as a 1-element array).
type MapeableHead =
  | { kind: 'homogeneous'; count: NDiceParam; sides: NDiceParam }
  | { kind: 'array'; dice: number[] }

const diceMapeable = lazy(
  (): Decoder<TextInput, DiceReduceable, DecodeError> => {
    const litHomogeneous: Decoder<TextInput, MapeableHead, DecodeError> =
      positive.flatMap((rolls) => {
        return die.map(
          (sides): MapeableHead => ({
            kind: 'homogeneous',
            count: nDiceLit(rolls),
            sides: nDiceLit(sides),
          }),
        )
      })
    const varHomogeneous: Decoder<TextInput, MapeableHead, DecodeError> =
      VAR_NAME.flatMap((countVar) => {
        return D.pickNext(
          sidesParam.map(
            (sides): MapeableHead => ({
              kind: 'homogeneous',
              count: nDiceVar(countVar),
              sides,
            }),
          ),
        )
      })
    const heteroDice: Decoder<TextInput, MapeableHead, DecodeError> =
      commaSeparated(die).map((dice): MapeableHead => ({ kind: 'array', dice }))
    const explicitOneDie: Decoder<TextInput, MapeableHead, DecodeError> =
      matchChar('1')
        .pickNext(die)
        .map((v): MapeableHead => ({ kind: 'array', dice: [v] }))
    const singleDie: Decoder<TextInput, MapeableHead, DecodeError> = die.map(
      (v): MapeableHead => ({ kind: 'array', dice: [v] }),
    )
    return oneOf(
      litHomogeneous,
      varHomogeneous,
      heteroDice,
      explicitOneDie,
      singleDie,
    ).flatMap((head) => {
      return OWS.pickNext(
        diceFunctor.map((functor): DiceReduceable => {
          if (head.kind === 'homogeneous') {
            return diceListWithMapHomogeneous(head.count, head.sides, functor)
          }
          return diceListWithMap(head.dice, functor)
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

const litFate: Decoder<TextInput, DiceExpression, DecodeError> =
  positive.flatMap((count) => {
    return D.skipNext(matchChar('F')).withResult(
      count === 1
        ? (makeCustomDie([-1, 0, 1]) as DiceExpression)
        : // Compact homogeneous-custom form: never expands at parse time.
          (makeDiceReduce(
            homogeneousCustomDice(nDiceLit(count), [-1, 0, 1]),
            'sum' as DiceReducer,
          ) as DiceExpression),
    )
  })
const varFate: Decoder<TextInput, DiceExpression, DecodeError> =
  VAR_NAME.flatMap((countVar) => {
    return D.skipNext(matchChar('F')).withResult(
      makeDiceReduce(
        homogeneousCustomDice(nDiceVar(countVar), [-1, 0, 1]),
        'sum' as DiceReducer,
      ) as DiceExpression,
    )
  })
const bareFate: Decoder<TextInput, DiceExpression, DecodeError> = D.skipNext(
  matchChar('F'),
).withResult(makeCustomDie([-1, 0, 1]) as DiceExpression)
const fateDieExpression = oneOf(litFate, varFate, bareFate)

const diceCountShorthand = lazy(
  (): Decoder<TextInput, DiceReduce, DecodeError> => {
    const literal: Decoder<TextInput, DiceReduce, DecodeError> =
      positive.flatMap((rolls) => {
        return (die as Decoder<TextInput, number, DecodeError>).flatMap(
          (sides) => {
            return matchChar('c')
              .skipNext(OWS)
              .pickNext(positive)
              .map(
                (v): DiceReduce =>
                  makeDiceReduce(
                    homogeneousDiceExpressions(
                      nDiceLit(rolls),
                      nDiceLit(sides),
                    ),
                    {
                      type: 'count' as const,
                      thresholds: [valueOrMore(v)],
                    } as CountReducer,
                  ),
              )
          },
        )
      })
    const variable: Decoder<TextInput, DiceReduce, DecodeError> =
      VAR_NAME.flatMap((countVar) => {
        return D.pickNext(sidesParam).flatMap((sides) => {
          return matchChar('c')
            .skipNext(OWS)
            .pickNext(positive)
            .map(
              (v): DiceReduce =>
                makeDiceReduce(
                  homogeneousDiceExpressions(nDiceVar(countVar), sides),
                  {
                    type: 'count' as const,
                    thresholds: [valueOrMore(v)],
                  } as CountReducer,
                ),
            )
        })
      })
    return oneOf(literal, variable)
  },
)

const termExpression = lazy(
  (): Decoder<TextInput, DiceExpression, DecodeError> => {
    return oneOf(
      diceReduce(diceMapeable),
      diceReduce(diceFilterable),
      fateDieExpression,
      diceCountShorthand,
      // Plain Nd<sides> form: parse as a single NDice node when no reducer
      // follows. This avoids parse-time expansion (so `100000d6` parses
      // without freezing) and supports parametric forms ($var in count
      // and/or sides positions).
      nDicePlain,
      diceReduce(diceExpressions),
      customDieExpression,
      dieExpression,
      literalExpression,
      // $var as a standalone term (e.g., `d20 + $mod`).
      variableRefExpr,
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

import { ProgramParser, type ParseProgramResult } from './program-parser'

export type { ParseProgramResult }

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
  parseProgram(input: string): ParseProgramResult {
    return ProgramParser.parse(input)
  },
}
