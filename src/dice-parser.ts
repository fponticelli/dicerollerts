import { type TextInput, decodeText, eoi } from 'partsing/text'
import { DE } from './dice-expression-domain'
import { LowHigh, type DiceExpression, between, valueOrMore, valueOrLess, exact, type Range, type DiceFunctor, upTo, always, type UpTo, type Always, unaryOp, DiceUnOp, DiceBinOp, binaryOp } from './dice-expression'
import { type DecodeError } from 'partsing/error'
import { type Decoder } from 'partsing/core/decoder'
import { type DecodeResult } from 'partsing/core/result'
import { matchChar, regexp, match } from 'partsing/text'
import { oneOf, lazy } from 'partsing/core/decoder'

const PLUS = matchChar('+')
const MINUS = matchChar('-')
const positive = regexp(/[+]?([1-9][0-9]*)/, 1).map(Number)
const negative = regexp(/[-]([1-9][0-9]*)/).map(Number)
const whole = oneOf(positive, negative)
const D = oneOf(matchChar('d'), matchChar('D'))

const OPEN_SET_BRACKET = matchChar('(')
const CLOSE_SET_BRACKET = matchChar(')')
const COMMA = matchChar(',')
const PERCENT = matchChar('%')
const WS = regexp(/[\s_]+/m)
const OWS = regexp(/[\s_]*$/m)

const MULTIPLICATION = regexp(/[*⋅×x]/) // .mapError(_ => '×')
const DIVISION = regexp(/[\\/÷:]/) // .mapError(_ => '÷')

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
  return OWS.pickNext(termExpression.map(right => { op, right }))
}))

/// TODO

const grammar: Decoder<TextInput, DiceExpression, DecodeError> = eoi
const decode = decodeText(grammar)

export const DiceParser = {
  normalize: (input: string) => {
    const result = DiceParser.parseOrNull(input)
    return result !== null ? DE.toString(result) : null
  },
  parse: (input: string): DecodeResult<string, DiceExpression, string> => {
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
