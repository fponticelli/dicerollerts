import { type DiceBinOp, type DiceFilter, type DiceFunctor, type DiceReducer, type DiceUnOp, type Sides } from './dice-expression'

export interface OneResult {
  type: 'one-result'
  die: DieResult
}

export function oneResult (die: DieResult): OneResult {
  return {
    type: 'one-result',
    die
  }
}

export interface LiteralResult {
  type: 'literal-result'
  value: number
  result: number
}

export function literalResult (value: number, result: number): LiteralResult {
  return {
    type: 'literal-result',
    value,
    result
  }
}

export interface DiceReduceResult {
  type: 'dice-reduce-result'
  reduceables: DiceReduceableResult
  reducer: DiceReducer
  result: number
}

export function diceReduceResult (
  reduceables: DiceReduceableResult,
  reducer: DiceReducer,
  result: number
): DiceReduceResult {
  return {
    type: 'dice-reduce-result',
    reduceables,
    reducer,
    result
  }
}

export interface BinaryOpResult {
  type: 'binary-op-result'
  op: DiceBinOp
  left: RollResult
  right: RollResult
  result: number
}

export function binaryOpResult (
  op: DiceBinOp,
  left: RollResult,
  right: RollResult,
  result: number
): BinaryOpResult {
  return {
    type: 'binary-op-result',
    op,
    left,
    right,
    result
  }
}

export interface UnaryOpResult {
  type: 'unary-op-result'
  op: DiceUnOp
  expr: RollResult
  result: number
}

export function unaryOpResult (
  op: DiceUnOp,
  expr: RollResult,
  result: number
): UnaryOpResult {
  return {
    type: 'unary-op-result',
    op,
    expr,
    result
  }
}

export type RollResult =
  | OneResult
  | LiteralResult
  | DiceReduceResult
  | BinaryOpResult
  | UnaryOpResult

export interface DiceExpressionsResult {
  type: 'dice-expressions-result'
  rolls: RollResult[]
}

export function diceExpressionsResult (rolls: RollResult[]): DiceExpressionsResult {
  return {
    type: 'dice-expressions-result',
    rolls
  }
}

export interface DiceFilterableResult {
  type: 'dice-filterable-result'
  rolls: DieResultFilter[]
  filter: DiceFilter
}

export function diceFilterableResult (
  rolls: DieResultFilter[],
  filter: DiceFilter
): DiceFilterableResult {
  return {
    type: 'dice-filterable-result',
    rolls,
    filter
  }
}

export interface DiceMapeableResult {
  type: 'dice-mapeable-result'
  rolls: DiceResultMapped[]
  functor: DiceFunctor
}

export function diceMapeableResult (
  rolls: DiceResultMapped[],
  functor: DiceFunctor
): DiceMapeableResult {
  return {
    type: 'dice-mapeable-result',
    rolls,
    functor
  }
}

export type DiceReduceableResult =
  | DiceExpressionsResult
  | DiceFilterableResult
  | DiceMapeableResult

export interface Rerolled {
  type: 'rerolled'
  rerolls: DieResult[]
}

export function rerolled (rerolls: DieResult[]): Rerolled {
  return {
    type: 'rerolled',
    rerolls
  }
}

export interface Exploded {
  type: 'exploded'
  explosions: DieResult[]
}

export function exploded (explosions: DieResult[]): Exploded {
  return {
    type: 'exploded',
    explosions
  }
}

export interface Normal {
  type: 'normal'
  roll: DieResult
}

export function normal (roll: DieResult): Normal {
  return {
    type: 'normal',
    roll
  }
}

export type DiceResultMapped =
  | Rerolled
  | Exploded
  | Normal

export interface DieResult {
  type: 'die-result'
  result: number
  sides: Sides
}

export function dieResult (result: number, sides: Sides): DieResult {
  return {
    type: 'die-result',
    result,
    sides
  }
}

export interface KeepResult {
  type: 'keep-result'
  roll: RollResult
}

export function keepResult (roll: RollResult): KeepResult {
  return {
    type: 'keep-result',
    roll
  }
}

export interface DiscardResult {
  type: 'discard-result'
  roll: RollResult
}

export function discardResult (roll: RollResult): DiscardResult {
  return {
    type: 'discard-result',
    roll
  }
}

export type DieResultFilter =
  | KeepResult
  | DiscardResult
