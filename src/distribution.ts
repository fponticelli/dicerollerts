import type { DiceExpression } from './dice-expression'
import { DiceStats } from './dice-stats'

/**
 * A discrete probability distribution over values of type `T`.
 *
 * The `values` map sends each possible outcome to its probability mass; the
 * probabilities sum to 1 (modulo small floating-point error).
 *
 * Note on map keys: JavaScript `Map` uses SameValueZero / reference equality
 * for keys. `T` should be a primitive (number, string, boolean) or an
 * intentionally stable reference; otherwise distinct objects with the same
 * shape will be treated as different outcomes.
 */
export interface Distribution<T> {
  values: Map<T, number>
}

/** Tolerance used when checking that probability mass is nonzero. */
const EPS = 1e-12

/** Build a Distribution by normalizing the probabilities in `entries`. */
function buildFromEntries<T>(entries: Iterable<[T, number]>): Distribution<T> {
  const merged = new Map<T, number>()
  let total = 0
  for (const [value, weight] of entries) {
    if (weight < 0) {
      throw new Error('Distribution weights/probabilities must be non-negative')
    }
    if (weight === 0) continue
    merged.set(value, (merged.get(value) ?? 0) + weight)
    total += weight
  }
  if (total <= 0) {
    throw new Error(
      'Distribution must have at least one outcome with positive weight',
    )
  }
  const out = new Map<T, number>()
  for (const [v, w] of merged) {
    out.set(v, w / total)
  }
  return { values: out }
}

/** Normalize a distribution in-place against floating-point drift. */
function normalize<T>(d: Distribution<T>): Distribution<T> {
  let total = 0
  for (const p of d.values.values()) total += p
  if (total <= 0) {
    throw new Error('Distribution has no probability mass')
  }
  if (Math.abs(total - 1) < EPS) return d
  const out = new Map<T, number>()
  for (const [v, p] of d.values) {
    out.set(v, p / total)
  }
  return { values: out }
}

function singleton<T>(value: T): Distribution<T> {
  return { values: new Map([[value, 1]]) }
}

function uniform<T>(values: T[]): Distribution<T> {
  if (values.length === 0) {
    throw new Error('Cannot build a uniform distribution from an empty array')
  }
  const p = 1 / values.length
  const merged = new Map<T, number>()
  for (const v of values) {
    merged.set(v, (merged.get(v) ?? 0) + p)
  }
  return { values: merged }
}

function fromMap<T>(map: Map<T, number>): Distribution<T> {
  return buildFromEntries(map.entries())
}

function fromWeights<T>(entries: Array<[T, number]>): Distribution<T> {
  return buildFromEntries(entries)
}

function mapDist<T, U>(d: Distribution<T>, fn: (v: T) => U): Distribution<U> {
  const out = new Map<U, number>()
  for (const [v, p] of d.values) {
    const u = fn(v)
    out.set(u, (out.get(u) ?? 0) + p)
  }
  return normalize({ values: out })
}

function combine<A, B, C>(
  a: Distribution<A>,
  b: Distribution<B>,
  fn: (av: A, bv: B) => C,
): Distribution<C> {
  const out = new Map<C, number>()
  for (const [av, ap] of a.values) {
    for (const [bv, bp] of b.values) {
      const c = fn(av, bv)
      const p = ap * bp
      out.set(c, (out.get(c) ?? 0) + p)
    }
  }
  return normalize({ values: out })
}

function conditional<T>(
  cond: Distribution<boolean>,
  thenD: Distribution<T>,
  elseD: Distribution<T>,
): Distribution<T> {
  const pTrue = cond.values.get(true) ?? 0
  const pFalse = cond.values.get(false) ?? 0
  const out = new Map<T, number>()
  if (pTrue > 0) {
    for (const [v, p] of thenD.values) {
      out.set(v, (out.get(v) ?? 0) + pTrue * p)
    }
  }
  if (pFalse > 0) {
    for (const [v, p] of elseD.values) {
      out.set(v, (out.get(v) ?? 0) + pFalse * p)
    }
  }
  return normalize({ values: out })
}

function add(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<number> {
  return combine(a, b, (x, y) => x + y)
}

function subtract(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<number> {
  return combine(a, b, (x, y) => x - y)
}

function multiply(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<number> {
  return combine(a, b, (x, y) => x * y)
}

function negate(d: Distribution<number>): Distribution<number> {
  return mapDist(d, (v) => -v)
}

function and(
  a: Distribution<boolean>,
  b: Distribution<boolean>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x && y)
}

function or(
  a: Distribution<boolean>,
  b: Distribution<boolean>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x || y)
}

function not(d: Distribution<boolean>): Distribution<boolean> {
  return mapDist(d, (v) => !v)
}

function greaterThan(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x > y)
}

function lessThan(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x < y)
}

function greaterOrEqual(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x >= y)
}

function lessOrEqual(
  a: Distribution<number>,
  b: Distribution<number>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x <= y)
}

function equal<T>(
  a: Distribution<T>,
  b: Distribution<T>,
): Distribution<boolean> {
  return combine(a, b, (x, y) => x === y)
}

function greaterThanConst(
  d: Distribution<number>,
  k: number,
): Distribution<boolean> {
  return mapDist(d, (v) => v > k)
}

function lessThanConst(
  d: Distribution<number>,
  k: number,
): Distribution<boolean> {
  return mapDist(d, (v) => v < k)
}

function greaterOrEqualConst(
  d: Distribution<number>,
  k: number,
): Distribution<boolean> {
  return mapDist(d, (v) => v >= k)
}

function lessOrEqualConst(
  d: Distribution<number>,
  k: number,
): Distribution<boolean> {
  return mapDist(d, (v) => v <= k)
}

function equalConst<T>(d: Distribution<T>, k: T): Distribution<boolean> {
  return mapDist(d, (v) => v === k)
}

function repeat(d: Distribution<number>, n: number): Distribution<number> {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('repeat requires a non-negative integer count')
  }
  if (n === 0) return singleton(0)
  // Repeated convolution. Doubling-and-add is asymptotically faster but
  // produces the same result for small n; iterate for simplicity.
  let result: Distribution<number> = d
  for (let i = 1; i < n; i++) {
    result = add(result, d)
  }
  return result
}

function probabilityOf<T>(
  d: Distribution<T>,
  predicate: (v: T) => boolean,
): number {
  let total = 0
  for (const [v, p] of d.values) {
    if (predicate(v)) total += p
  }
  return total
}

function mean(d: Distribution<number>): number {
  let m = 0
  for (const [v, p] of d.values) m += v * p
  return m
}

function variance(d: Distribution<number>): number {
  const m = mean(d)
  let v = 0
  for (const [x, p] of d.values) v += (x - m) ** 2 * p
  return v
}

function minOf(d: Distribution<number>): number {
  let m = Infinity
  for (const [v, p] of d.values) {
    if (p > 0 && v < m) m = v
  }
  if (!Number.isFinite(m)) {
    throw new Error('Distribution has no outcomes with positive probability')
  }
  return m
}

function maxOf(d: Distribution<number>): number {
  let m = -Infinity
  for (const [v, p] of d.values) {
    if (p > 0 && v > m) m = v
  }
  if (!Number.isFinite(m)) {
    throw new Error('Distribution has no outcomes with positive probability')
  }
  return m
}

function fromDiceExpression(expr: DiceExpression): Distribution<number> {
  // DiceStats.distribution may throw for non-exact-analyzable expressions
  // (e.g. infinite explode/reroll, or variable references). We surface that
  // error to the caller unchanged.
  const dist = DiceStats.distribution(expr)
  return fromMap(dist)
}

/**
 * Public namespace for composing discrete probability distributions.
 *
 * All combinators assume that the input distributions are independent. If you
 * need correlations between random sources, use the program language and
 * `ProgramStats.analyze`, which tracks shared sources internally.
 */
export const Distribution = {
  // Constructors
  singleton,
  uniform,
  from: fromMap,
  fromWeights,

  // Operations (independence assumed)
  map: mapDist,
  combine,
  conditional,

  // Numeric shortcuts
  add,
  subtract,
  multiply,
  negate,

  // Boolean shortcuts
  and,
  or,
  not,

  // Comparisons (numeric -> boolean)
  greaterThan,
  lessThan,
  greaterOrEqual,
  lessOrEqual,
  equal,

  // Comparisons against constants
  greaterThanConst,
  lessThanConst,
  greaterOrEqualConst,
  lessOrEqualConst,
  equalConst,

  // Aggregations
  repeat,
  probabilityOf,
  mean,
  variance,
  min: minOf,
  max: maxOf,

  // Interop
  fromDiceExpression,
}
