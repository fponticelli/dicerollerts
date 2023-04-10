export type Sides = number

export type Roll = (sides: Sides) => number

export interface Die {
  type: 'die'
  sides: number
}

export function die (sides: number): Die {
  return {
    type: 'die',
    sides
  }
}

export interface Literal {
  type: 'literal'
  value: number
}

export function literal (value: number): Literal {
  return {
    type: 'literal',
    value
  }
}

export interface DiceReduce {
  type: 'dice-reduce'
  reduceable: DiceReduceable
  reducer: DiceReducer
}

export function diceReduce (
  reduceable: DiceReduceable,
  reducer: DiceReducer
): DiceReduce {
  return {
    type: 'dice-reduce',
    reduceable,
    reducer
  }
}

export interface BinaryOp {
  type: 'binary-op'
  op: DiceBinOp
  left: DiceExpression
  right: DiceExpression
}

export function binaryOp (
  op: DiceBinOp,
  left: DiceExpression,
  right: DiceExpression
): BinaryOp {
  return {
    type: 'binary-op',
    op,
    left,
    right
  }
}

export interface UnaryOp {
  type: 'unary-op'
  op: DiceUnOp
  expr: DiceExpression
}

export function unaryOp (op: DiceUnOp, expr: DiceExpression): UnaryOp {
  return {
    type: 'unary-op',
    op,
    expr
  }
}

export type DiceExpression =
  | Die
  | Literal
  | DiceReduce
  | BinaryOp
  | UnaryOp

export enum DiceReducer {
  Sum = 'sum',
  Min = 'min',
  Max = 'max',
  Average = 'average',
  Median = 'median',
}

export interface DiceExpressions {
  type: 'dice-expressions'
  exprs: DiceExpression[]
}

export function diceExpressions (...exprs: DiceExpression[]): DiceExpressions {
  return {
    type: 'dice-expressions',
    exprs
  }
}

export interface DiceListWithFilter {
  type: 'dice-list-with-filter'
  list: DiceFilterable
  filter: DiceFilter
}

export function diceListWithFilter (
  list: DiceFilterable,
  filter: DiceFilter
): DiceListWithFilter {
  return {
    type: 'dice-list-with-filter',
    list,
    filter
  }
}

export interface DiceListWithMap {
  type: 'dice-list-with-map'
  dice: Sides[]
  functor: DiceFunctor
}

export function diceListWithMap (
  dice: Sides[],
  functor: DiceFunctor
): DiceListWithMap {
  return {
    type: 'dice-list-with-map',
    dice,
    functor
  }
}

export type DiceReduceable =
  | DiceExpressions
  | DiceListWithFilter
  | DiceListWithMap

export interface FilterableDiceArray {
  type: 'filterable-dice-array'
  dice: Sides[]
}

export function filterableDiceArray (dice: Sides[]): FilterableDiceArray {
  return {
    type: 'filterable-dice-array',
    dice
  }
}

export interface FilterableDiceExpressions {
  type: 'filterable-dice-expressions'
  exprs: DiceExpression[]
}

export function filterableDiceExpressions (
  exprs: DiceExpression[]
): FilterableDiceExpressions {
  return {
    type: 'filterable-dice-expressions',
    exprs
  }
}

export type DiceFilterable =
  | FilterableDiceArray
  | FilterableDiceExpressions

export interface Drop {
  type: 'drop'
  dir: LowHigh
  value: number
}

export function drop (dir: LowHigh, value: number): Drop {
  return {
    type: 'drop',
    dir,
    value
  }
}

export interface Keep {
  type: 'keep'
  dir: LowHigh
  value: number
}

export function keep (dir: LowHigh, value: number): Keep {
  return {
    type: 'keep',
    dir,
    value
  }
}

export type DiceFilter =
  | Drop
  | Keep

export interface Explode {
  type: 'explode'
  times: Times
  range: Range
}

export function explode (times: Times, range: Range): Explode {
  return {
    type: 'explode',
    times,
    range
  }
}

export interface Reroll {
  type: 'reroll'
  times: Times
  range: Range
}

export function reroll (times: Times, range: Range): Reroll {
  return {
    type: 'reroll',
    times,
    range
  }
}

export type DiceFunctor =
  | Explode
  | Reroll

export interface Always {
  type: 'always'
}

export function always (): Always {
  return {
    type: 'always'
  }
}

export interface UpTo {
  type: 'up-to'
  value: number
}

export function upTo (value: number): UpTo {
  return {
    type: 'up-to',
    value
  }
}

export type Times =
  | Always
  | UpTo

export interface Exact {
  type: 'exact'
  value: number
}

export function exact (value: number): Exact {
  return {
    type: 'exact',
    value
  }
}

export interface Between {
  type: 'between'
  minInclusive: number
  maxInclusive: number
}

export function between (
  minInclusive: number,
  maxInclusive: number
): Between {
  return {
    type: 'between',
    minInclusive,
    maxInclusive
  }
}

export interface ValueOrMore {
  type: 'value-or-more'
  value: number
}

export function valueOrMore (value: number): ValueOrMore {
  return {
    type: 'value-or-more',
    value
  }
}

export interface ValueOrLess {
  type: 'value-or-less'
  value: number
}

export function valueOrLess (value: number): ValueOrLess {
  return {
    type: 'value-or-less',
    value
  }
}

export interface Composite {
  type: 'composite'
  ranges: Range[]
}

export function composite (ranges: Range[]): Composite {
  return {
    type: 'composite',
    ranges
  }
}

export type Range =
  | Exact
  | Between
  | ValueOrMore
  | ValueOrLess
  | Composite

export enum LowHigh {
  Low = 'low',
  High = 'high',
}

export enum DiceBinOp {
  Sum = 'sum',
  Difference = 'difference',
  Multiplication = 'multiplication',
  Division = 'division',
}

export enum DiceUnOp {
  Negate = 'negate',
}

export interface InsufficientSides {
  type: 'insufficient-sides'
  sides: number
}

export function insufficientSides (sides: number): InsufficientSides {
  return {
    type: 'insufficient-sides',
    sides
  }
}

export interface EmptySet {
  type: 'empty-set'
}

export function emptySet (): EmptySet {
  return {
    type: 'empty-set'
  }
}

export interface InfiniteReroll {
  type: 'infinite-reroll'
  sides: number
  range: Range
}

export function infiniteReroll (
  sides: number,
  range: Range
): InfiniteReroll {
  return {
    type: 'infinite-reroll',
    sides,
    range
  }
}

export interface TooManyDrops {
  type: 'too-many-drops'
  available: number
  toDrop: number
}

export function tooManyDrops (
  available: number,
  toDrop: number
): TooManyDrops {
  return {
    type: 'too-many-drops',
    available,
    toDrop
  }
}

export interface TooManyKeeps {
  type: 'too-many-keeps'
  available: number
  toKeep: number
}

export function tooManyKeeps (
  available: number,
  toKeep: number
): TooManyKeeps {
  return {
    type: 'too-many-keeps',
    available,
    toKeep
  }
}

export interface DropOrKeepShouldBePositive {
  type: 'drop-or-keep-should-be-positive'
}

export function dropOrKeepShouldBePositive (): DropOrKeepShouldBePositive {
  return {
    type: 'drop-or-keep-should-be-positive'
  }
}

export type ValidationMessage =
  | InsufficientSides
  | EmptySet
  | InfiniteReroll
  | TooManyDrops
  | TooManyKeeps
  | DropOrKeepShouldBePositive
