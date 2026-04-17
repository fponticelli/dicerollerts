export type Sides = number

export type Roll = (sides: Sides) => number

export interface Die {
  type: 'die'
  sides: number
}

export function die(sides: number): Die {
  return {
    type: 'die',
    sides,
  }
}

export interface Literal {
  type: 'literal'
  value: number
}

export function literal(value: number): Literal {
  return {
    type: 'literal',
    value,
  }
}

export interface DiceReduce {
  type: 'dice-reduce'
  reduceable: DiceReduceable
  reducer: DiceReducer
}

export function diceReduce(
  reduceable: DiceReduceable,
  reducer: DiceReducer,
): DiceReduce {
  return {
    type: 'dice-reduce',
    reduceable,
    reducer,
  }
}

export interface BinaryOp {
  type: 'binary-op'
  op: DiceBinOp
  left: DiceExpression
  right: DiceExpression
}

export function binaryOp(
  op: DiceBinOp,
  left: DiceExpression,
  right: DiceExpression,
): BinaryOp {
  return {
    type: 'binary-op',
    op,
    left,
    right,
  }
}

export interface UnaryOp {
  type: 'unary-op'
  op: DiceUnOp
  expr: DiceExpression
}

export function unaryOp(op: DiceUnOp, expr: DiceExpression): UnaryOp {
  return {
    type: 'unary-op',
    op,
    expr,
  }
}

export interface CustomDie {
  type: 'custom-die'
  faces: number[]
}

export function customDie(faces: number[]): CustomDie {
  return {
    type: 'custom-die',
    faces,
  }
}

export interface DiceVariableRef {
  type: 'dice-variable-ref'
  name: string
}

export function diceVariableRef(name: string): DiceVariableRef {
  return {
    type: 'dice-variable-ref',
    name,
  }
}

export type NDiceParam =
  | { kind: 'literal'; value: number }
  | { kind: 'variable'; name: string }

export function nDiceLit(value: number): NDiceParam {
  return { kind: 'literal', value }
}

export function nDiceVar(name: string): NDiceParam {
  return { kind: 'variable', name }
}

export interface NDice {
  type: 'n-dice'
  count: NDiceParam
  sides: NDiceParam
}

export function nDice(count: NDiceParam, sides: NDiceParam): NDice {
  return {
    type: 'n-dice',
    count,
    sides,
  }
}

export type DiceExpression =
  | Die
  | Literal
  | DiceReduce
  | BinaryOp
  | UnaryOp
  | CustomDie
  | DiceVariableRef
  | NDice

export type SimpleReducer = 'sum' | 'min' | 'max' | 'average' | 'median'

export interface CountReducer {
  type: 'count'
  threshold: Range
}

export type DiceReducer = SimpleReducer | CountReducer

export interface DiceExpressions {
  type: 'dice-expressions'
  exprs: DiceExpression[]
}

export function diceExpressions(...exprs: DiceExpression[]): DiceExpressions {
  return {
    type: 'dice-expressions',
    exprs,
  }
}

export interface DiceListWithFilter {
  type: 'dice-list-with-filter'
  list: DiceFilterable
  filter: DiceFilter
}

export function diceListWithFilter(
  list: DiceFilterable,
  filter: DiceFilter,
): DiceListWithFilter {
  return {
    type: 'dice-list-with-filter',
    list,
    filter,
  }
}

export interface DiceListWithMap {
  type: 'dice-list-with-map'
  dice: Sides[]
  functor: DiceFunctor
}

export function diceListWithMap(
  dice: Sides[],
  functor: DiceFunctor,
): DiceListWithMap {
  return {
    type: 'dice-list-with-map',
    dice,
    functor,
  }
}

/**
 * Compact representation of N homogeneous dice in a "mapeable" position
 * (e.g. `Nd6 explode on 6`, `Nd6 reroll on 1`). Materializes individual rolls
 * at evaluation time rather than at parse time.
 */
export interface DiceListWithMapHomogeneous {
  type: 'dice-list-with-map-homogeneous'
  count: NDiceParam
  sides: NDiceParam
  functor: DiceFunctor
}

export function diceListWithMapHomogeneous(
  count: NDiceParam,
  sides: NDiceParam,
  functor: DiceFunctor,
): DiceListWithMapHomogeneous {
  return {
    type: 'dice-list-with-map-homogeneous',
    count,
    sides,
    functor,
  }
}

/**
 * Compact representation of N homogeneous dice in a "reducer" position
 * (e.g. `Nd6 max`, `Nd6 sum`, `Nd6 count >= 4`). Materializes individual
 * rolls at evaluation time rather than at parse time.
 */
export interface HomogeneousDiceExpressions {
  type: 'homogeneous-dice-expressions'
  count: NDiceParam
  sides: NDiceParam
}

export function homogeneousDiceExpressions(
  count: NDiceParam,
  sides: NDiceParam,
): HomogeneousDiceExpressions {
  return {
    type: 'homogeneous-dice-expressions',
    count,
    sides,
  }
}

/**
 * Compact representation of N copies of a custom-faced die (e.g. `NdF`)
 * in a reducer or filterable position. The dice all share `faces`.
 */
export interface HomogeneousCustomDice {
  type: 'homogeneous-custom-dice'
  count: NDiceParam
  faces: number[]
}

export function homogeneousCustomDice(
  count: NDiceParam,
  faces: number[],
): HomogeneousCustomDice {
  return {
    type: 'homogeneous-custom-dice',
    count,
    faces,
  }
}

export type DiceReduceable =
  | DiceExpressions
  | DiceListWithFilter
  | DiceListWithMap
  | DiceListWithMapHomogeneous
  | HomogeneousDiceExpressions
  | HomogeneousCustomDice

export interface FilterableDiceArray {
  type: 'filterable-dice-array'
  dice: Sides[]
}

export function filterableDiceArray(dice: Sides[]): FilterableDiceArray {
  return {
    type: 'filterable-dice-array',
    dice,
  }
}

export interface FilterableDiceExpressions {
  type: 'filterable-dice-expressions'
  exprs: DiceExpression[]
}

export function filterableDiceExpressions(
  ...exprs: DiceExpression[]
): FilterableDiceExpressions {
  return {
    type: 'filterable-dice-expressions',
    exprs,
  }
}

/**
 * Compact representation of N homogeneous dice in a "filterable" position
 * (e.g. `Nd6 keep N`, `Nd6 drop N`). Materializes individual rolls at
 * evaluation time rather than at parse time.
 */
export interface FilterableHomogeneous {
  type: 'filterable-homogeneous'
  count: NDiceParam
  sides: NDiceParam
}

export function filterableHomogeneous(
  count: NDiceParam,
  sides: NDiceParam,
): FilterableHomogeneous {
  return {
    type: 'filterable-homogeneous',
    count,
    sides,
  }
}

/**
 * Compact representation of N copies of a custom-faced die (e.g. `NdF`)
 * in a filterable position.
 */
export interface FilterableHomogeneousCustom {
  type: 'filterable-homogeneous-custom'
  count: NDiceParam
  faces: number[]
}

export function filterableHomogeneousCustom(
  count: NDiceParam,
  faces: number[],
): FilterableHomogeneousCustom {
  return {
    type: 'filterable-homogeneous-custom',
    count,
    faces,
  }
}

export type DiceFilterable =
  | FilterableDiceArray
  | FilterableDiceExpressions
  | FilterableHomogeneous
  | FilterableHomogeneousCustom

export interface Drop {
  type: 'drop'
  dir: LowHigh
  value: number
}

export function drop(dir: LowHigh, value: number): Drop {
  return {
    type: 'drop',
    dir,
    value,
  }
}

export interface Keep {
  type: 'keep'
  dir: LowHigh
  value: number
}

export function keep(dir: LowHigh, value: number): Keep {
  return {
    type: 'keep',
    dir,
    value,
  }
}

export type DiceFilter = Drop | Keep

export interface Explode {
  type: 'explode'
  times: Times
  range: Range
}

export function explode(times: Times, range: Range): Explode {
  return {
    type: 'explode',
    times,
    range,
  }
}

export interface Reroll {
  type: 'reroll'
  times: Times
  range: Range
}

export function reroll(times: Times, range: Range): Reroll {
  return {
    type: 'reroll',
    times,
    range,
  }
}

export interface Emphasis {
  type: 'emphasis'
  tieBreaker: 'high' | 'low' | 'reroll'
  furthestFrom: number | 'average'
}

export function emphasis(
  tieBreaker: 'high' | 'low' | 'reroll',
  furthestFrom: number | 'average',
): Emphasis {
  return {
    type: 'emphasis',
    tieBreaker,
    furthestFrom,
  }
}

export interface Compound {
  type: 'compound'
  times: Times
  range: Range
}

export function compound(times: Times, range: Range): Compound {
  return { type: 'compound', times, range }
}

export type DiceFunctor = Explode | Reroll | Emphasis | Compound

export interface Always {
  type: 'always'
}

export function always(): Always {
  return {
    type: 'always',
  }
}

export interface UpTo {
  type: 'up-to'
  value: number
}

export function upTo(value: number): UpTo {
  return {
    type: 'up-to',
    value,
  }
}

export type Times = Always | UpTo

export interface Exact {
  type: 'exact'
  value: number
}

export function exact(value: number): Exact {
  return {
    type: 'exact',
    value,
  }
}

export interface Between {
  type: 'between'
  minInclusive: number
  maxInclusive: number
}

export function between(minInclusive: number, maxInclusive: number): Between {
  return {
    type: 'between',
    minInclusive,
    maxInclusive,
  }
}

export interface ValueOrMore {
  type: 'value-or-more'
  value: number
}

export function valueOrMore(value: number): ValueOrMore {
  return {
    type: 'value-or-more',
    value,
  }
}

export interface ValueOrLess {
  type: 'value-or-less'
  value: number
}

export function valueOrLess(value: number): ValueOrLess {
  return {
    type: 'value-or-less',
    value,
  }
}

export interface Composite {
  type: 'composite'
  ranges: Range[]
}

export function composite(ranges: Range[]): Composite {
  return {
    type: 'composite',
    ranges,
  }
}

export type Range = Exact | Between | ValueOrMore | ValueOrLess | Composite

export type LowHigh = 'low' | 'high'

export type DiceBinOp = 'sum' | 'difference' | 'multiplication' | 'division'

export type DiceUnOp = 'negate'

export interface InsufficientSides {
  type: 'insufficient-sides'
  sides: number
}

export function insufficientSides(sides: number): InsufficientSides {
  return {
    type: 'insufficient-sides',
    sides,
  }
}

export interface EmptySet {
  type: 'empty-set'
}

export function emptySet(): EmptySet {
  return {
    type: 'empty-set',
  }
}

export interface InfiniteReroll {
  type: 'infinite-reroll'
  sides: number
  range: Range
}

export function infiniteReroll(sides: number, range: Range): InfiniteReroll {
  return {
    type: 'infinite-reroll',
    sides,
    range,
  }
}

export interface TooManyDrops {
  type: 'too-many-drops'
  available: number
  toDrop: number
}

export function tooManyDrops(available: number, toDrop: number): TooManyDrops {
  return {
    type: 'too-many-drops',
    available,
    toDrop,
  }
}

export interface TooManyKeeps {
  type: 'too-many-keeps'
  available: number
  toKeep: number
}

export function tooManyKeeps(available: number, toKeep: number): TooManyKeeps {
  return {
    type: 'too-many-keeps',
    available,
    toKeep,
  }
}

export interface DropOrKeepShouldBePositive {
  type: 'drop-or-keep-should-be-positive'
}

export function dropOrKeepShouldBePositive(): DropOrKeepShouldBePositive {
  return {
    type: 'drop-or-keep-should-be-positive',
  }
}

export interface EmptyFaces {
  type: 'empty-faces'
}

export function emptyFaces(): EmptyFaces {
  return {
    type: 'empty-faces',
  }
}

export type ValidationMessage =
  | InsufficientSides
  | EmptySet
  | InfiniteReroll
  | TooManyDrops
  | TooManyKeeps
  | DropOrKeepShouldBePositive
  | EmptyFaces
