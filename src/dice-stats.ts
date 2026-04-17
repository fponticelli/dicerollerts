import type {
  DiceExpression,
  DiceReduceable,
  DiceReducer,
  DiceBinOp,
  DiceFunctor,
  NDice,
  Sides,
} from './dice-expression'
import { DE } from './dice-expression-domain'
import { Roller } from './roller'
import { RR } from './roll-result-domain'

type Distribution = Map<number, number>

function distributionOf(expr: DiceExpression): Distribution {
  switch (expr.type) {
    case 'die': {
      const dist: Distribution = new Map()
      const p = 1 / expr.sides
      for (let i = 1; i <= expr.sides; i++) {
        dist.set(i, p)
      }
      return dist
    }
    case 'custom-die': {
      const dist: Distribution = new Map()
      const p = 1 / expr.faces.length
      for (const face of expr.faces) {
        dist.set(face, (dist.get(face) ?? 0) + p)
      }
      return dist
    }
    case 'literal': {
      return new Map([[expr.value, 1]])
    }
    case 'binary-op': {
      const leftDist = distributionOf(expr.left)
      const rightDist = distributionOf(expr.right)
      return combineBinary(leftDist, rightDist, expr.op)
    }
    case 'unary-op': {
      const inner = distributionOf(expr.expr)
      if (expr.op === 'negate') {
        const dist: Distribution = new Map()
        for (const [v, p] of inner) {
          dist.set(-v, (dist.get(-v) ?? 0) + p)
        }
        return dist
      }
      return inner
    }
    case 'dice-reduce': {
      return distributeReduceable(expr.reduceable, expr.reducer)
    }
    case 'dice-variable-ref': {
      throw new Error(
        `Cannot compute distribution for variable reference: $${expr.name}`,
      )
    }
    case 'n-dice': {
      return distributeNDice(expr)
    }
  }
}

function distributeNDice(expr: NDice): Distribution {
  if (expr.count.kind !== 'literal' || expr.sides.kind !== 'literal') {
    // Variable count or sides: cannot compute exact distribution without
    // knowing the variable's distribution. Caller must handle (e.g., via
    // ProgramStats which has access to bindings).
    throw new Error(
      `Cannot compute distribution for parametric n-dice with variable parameters`,
    )
  }
  const count = expr.count.value
  const sides = expr.sides.value
  if (count <= 0) {
    return new Map([[0, 1]])
  }
  if (sides <= 0) {
    throw new Error(`dice sides must be positive, got ${sides}`)
  }
  // Sum of N independent d<sides>: convolve the per-die distribution.
  const oneDie: Distribution = new Map()
  const p = 1 / sides
  for (let i = 1; i <= sides; i++) oneDie.set(i, p)
  let result: Distribution = new Map([[0, 1]])
  for (let i = 0; i < count; i++) {
    result = combineBinary(result, oneDie, 'sum')
  }
  return result
}

function applyBinOp(op: DiceBinOp, a: number, b: number): number {
  switch (op) {
    case 'sum':
      return a + b
    case 'difference':
      return a - b
    case 'multiplication':
      return a * b
    case 'division':
      return b === 0 ? 0 : Math.trunc(a / b)
  }
}

function combineBinary(
  left: Distribution,
  right: Distribution,
  op: DiceBinOp,
): Distribution {
  const dist: Distribution = new Map()
  for (const [lv, lp] of left) {
    for (const [rv, rp] of right) {
      const val = applyBinOp(op, lv, rv)
      const prob = lp * rp
      dist.set(val, (dist.get(val) ?? 0) + prob)
    }
  }
  return dist
}

function distributeFunctor(sides: Sides, functor: DiceFunctor): Distribution {
  switch (functor.type) {
    case 'explode':
    case 'compound': {
      if (functor.times.type === 'always') {
        throw new Error('exact-not-supported')
      }
      const maxDepth = functor.times.value
      return distributeExplodeCompound(
        sides,
        functor.range,
        maxDepth,
        functor.type === 'explode',
      )
    }
    case 'reroll': {
      if (functor.times.type === 'always') {
        throw new Error('exact-not-supported')
      }
      const maxRerolls = functor.times.value
      return distributeReroll(sides, functor.range, maxRerolls)
    }
    case 'emphasis': {
      return distributeEmphasis(sides, functor.furthestFrom, functor.tieBreaker)
    }
  }
}

function distributeExplodeCompound(
  sides: Sides,
  range: import('./dice-expression').Range,
  maxDepth: number,
  _isExplode: boolean,
): Distribution {
  // For a single die, explode and compound produce the same final sum distribution.
  // Explode adds extra dice to the pool; compound sums into one value.
  // When reducing a single die with 'sum', the result is identical.
  const p = 1 / sides
  const dist: Distribution = new Map()

  function enumerate(depth: number, accum: number, prob: number): void {
    for (let face = 1; face <= sides; face++) {
      const total = accum + face
      const faceProb = prob * p
      if (depth < maxDepth && Roller.matchRange(face, range)) {
        // This face triggers another roll
        enumerate(depth + 1, total, faceProb)
      } else {
        dist.set(total, (dist.get(total) ?? 0) + faceProb)
      }
    }
  }

  enumerate(0, 0, 1)
  return dist
}

function distributeReroll(
  sides: Sides,
  range: import('./dice-expression').Range,
  maxRerolls: number,
): Distribution {
  const p = 1 / sides
  const dist: Distribution = new Map()

  function enumerate(depth: number, prob: number): void {
    for (let face = 1; face <= sides; face++) {
      const faceProb = prob * p
      if (depth < maxRerolls && Roller.matchRange(face, range)) {
        // Reroll: discard this face, roll again
        enumerate(depth + 1, faceProb)
      } else {
        dist.set(face, (dist.get(face) ?? 0) + faceProb)
      }
    }
  }

  enumerate(0, 1)
  return dist
}

function distributeEmphasis(
  sides: Sides,
  furthestFrom: number | 'average',
  tieBreaker: 'high' | 'low' | 'reroll',
): Distribution {
  const p = 1 / sides
  const furthestValue =
    furthestFrom === 'average' ? (1 + sides) / 2 : furthestFrom
  const dist: Distribution = new Map()

  for (let first = 1; first <= sides; first++) {
    for (let second = 1; second <= sides; second++) {
      const prob = p * p
      const firstDist = Math.abs(first - furthestValue)
      const secondDist = Math.abs(second - furthestValue)

      let chosen: number
      if (firstDist > secondDist) {
        chosen = first
      } else if (secondDist > firstDist) {
        chosen = second
      } else {
        // Tie
        if (tieBreaker === 'high') {
          chosen = Math.max(first, second)
        } else if (tieBreaker === 'low') {
          chosen = Math.min(first, second)
        } else {
          // reroll tiebreaker - for exact distribution, we model this as
          // equal probability of picking either (since reroll resolves randomly)
          dist.set(first, (dist.get(first) ?? 0) + prob / 2)
          dist.set(second, (dist.get(second) ?? 0) + prob / 2)
          continue
        }
      }
      dist.set(chosen, (dist.get(chosen) ?? 0) + prob)
    }
  }

  return dist
}

function resolveLiteralCount(
  p: import('./dice-expression').NDiceParam,
): number {
  if (p.kind !== 'literal') {
    throw new Error(
      `Cannot compute distribution for parametric dice with variable count $${p.name}`,
    )
  }
  return p.value
}

function resolveLiteralSides(
  p: import('./dice-expression').NDiceParam,
): number {
  if (p.kind !== 'literal') {
    throw new Error(
      `Cannot compute distribution for parametric dice with variable sides $${p.name}`,
    )
  }
  return p.value
}

function customDieDistribution(faces: number[]): Distribution {
  const dist: Distribution = new Map()
  const p = 1 / faces.length
  for (const f of faces) {
    dist.set(f, (dist.get(f) ?? 0) + p)
  }
  return dist
}

function distributeReduceable(
  reduceable: DiceReduceable,
  reducer: DiceReducer,
): Distribution {
  switch (reduceable.type) {
    case 'dice-expressions': {
      const subDists = reduceable.exprs.map(distributionOf)
      return reduceDistributions(subDists, reducer)
    }
    case 'homogeneous-dice-expressions': {
      const count = resolveLiteralCount(reduceable.count)
      const sides = resolveLiteralSides(reduceable.sides)
      if (count <= 0) {
        return new Map([[reduceValues([], reducer), 1]])
      }
      if (sides <= 0) {
        throw new Error(`dice sides must be positive, got ${sides}`)
      }
      const oneDie: Distribution = new Map()
      const p = 1 / sides
      for (let i = 1; i <= sides; i++) oneDie.set(i, p)
      const subDists = Array.from({ length: count }, () => oneDie)
      return reduceDistributions(subDists, reducer)
    }
    case 'homogeneous-custom-dice': {
      const count = resolveLiteralCount(reduceable.count)
      if (count <= 0) {
        return new Map([[reduceValues([], reducer), 1]])
      }
      if (reduceable.faces.length === 0) {
        throw new Error('custom die must have at least one face')
      }
      const oneDie = customDieDistribution(reduceable.faces)
      const subDists = Array.from({ length: count }, () => oneDie)
      return reduceDistributions(subDists, reducer)
    }
    case 'dice-list-with-filter': {
      // Enumerate all combinations from the filterable list
      let subDists: Distribution[]
      const list = reduceable.list
      switch (list.type) {
        case 'filterable-dice-array':
          subDists = list.dice.map((sides) =>
            distributionOf({ type: 'die', sides }),
          )
          break
        case 'filterable-dice-expressions':
          subDists = list.exprs.map(distributionOf)
          break
        case 'filterable-homogeneous': {
          const count = resolveLiteralCount(list.count)
          const sides = resolveLiteralSides(list.sides)
          if (sides <= 0) {
            throw new Error(`dice sides must be positive, got ${sides}`)
          }
          subDists = Array.from({ length: count }, () =>
            distributionOf({ type: 'die', sides }),
          )
          break
        }
        case 'filterable-homogeneous-custom': {
          const count = resolveLiteralCount(list.count)
          if (list.faces.length === 0) {
            throw new Error('custom die must have at least one face')
          }
          const oneDie = customDieDistribution(list.faces)
          subDists = Array.from({ length: count }, () => oneDie)
          break
        }
      }
      // Enumerate all combinations, apply filter, then reduce
      const allCombos = enumerateCombinations(subDists)
      const dist: Distribution = new Map()
      for (const { values, prob } of allCombos) {
        const sorted = [...values].sort((a, b) => a - b)
        let kept: number[]
        const filter = reduceable.filter
        if (filter.type === 'drop') {
          if (filter.dir === 'low') {
            kept = sorted.slice(filter.value)
          } else {
            kept = sorted.slice(0, sorted.length - filter.value)
          }
        } else {
          // keep
          if (filter.dir === 'high') {
            kept = sorted.slice(sorted.length - filter.value)
          } else {
            kept = sorted.slice(0, filter.value)
          }
        }
        const result = reduceValues(kept, reducer)
        dist.set(result, (dist.get(result) ?? 0) + prob)
      }
      return dist
    }
    case 'dice-list-with-map': {
      const functor = reduceable.functor
      const dieDists = reduceable.dice.map((sides) =>
        distributeFunctor(sides, functor),
      )
      return reduceDistributions(dieDists, reducer)
    }
    case 'dice-list-with-map-homogeneous': {
      const count = resolveLiteralCount(reduceable.count)
      const sides = resolveLiteralSides(reduceable.sides)
      if (count <= 0) {
        return new Map([[reduceValues([], reducer), 1]])
      }
      if (sides <= 0) {
        throw new Error(`dice sides must be positive, got ${sides}`)
      }
      const oneDist = distributeFunctor(sides, reduceable.functor)
      const subDists = Array.from({ length: count }, () => oneDist)
      return reduceDistributions(subDists, reducer)
    }
  }
}

function reduceDistributions(
  dists: Distribution[],
  reducer: DiceReducer,
): Distribution {
  if (typeof reducer === 'string' && reducer === 'sum') {
    // Convolution for sum - more efficient
    let result: Distribution = new Map([[0, 1]])
    for (const d of dists) {
      result = combineBinary(result, d, 'sum')
    }
    return result
  }
  // For other reducers, enumerate all combinations
  const allCombos = enumerateCombinations(dists)
  const dist: Distribution = new Map()
  for (const { values, prob } of allCombos) {
    const result = reduceValues(values, reducer)
    dist.set(result, (dist.get(result) ?? 0) + prob)
  }
  return dist
}

interface Combination {
  values: number[]
  prob: number
}

function enumerateCombinations(dists: Distribution[]): Combination[] {
  let combos: Combination[] = [{ values: [], prob: 1 }]
  for (const d of dists) {
    const next: Combination[] = []
    for (const combo of combos) {
      for (const [v, p] of d) {
        next.push({ values: [...combo.values, v], prob: combo.prob * p })
      }
    }
    combos = next
  }
  return combos
}

function reduceValues(values: number[], reducer: DiceReducer): number {
  if (typeof reducer === 'object') {
    return values.filter((r) => Roller.matchRange(r, reducer.threshold)).length
  }
  switch (reducer) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'min':
      return values.length === 0 ? 0 : Math.min(...values)
    case 'max':
      return values.length === 0 ? 0 : Math.max(...values)
    case 'average':
      return values.length === 0
        ? 0
        : Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    case 'median': {
      if (values.length === 0) return 0
      const sorted = [...values].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid]
    }
    default: {
      const _exhaustive: never = reducer
      throw new Error(`Unexpected reducer: ${_exhaustive}`)
    }
  }
}

function meanFromDist(dist: Distribution): number {
  let sum = 0
  for (const [v, p] of dist) {
    sum += v * p
  }
  return sum
}

function varianceFromDist(dist: Distribution): number {
  const m = meanFromDist(dist)
  let sum = 0
  for (const [v, p] of dist) {
    sum += (v - m) ** 2 * p
  }
  return sum
}

export interface MonteCarloResult {
  mean: number
  stddev: number
  min: number
  max: number
  distribution: Map<number, number>
  percentile: (p: number) => number
}

export interface SummaryResult {
  min: number
  max: number
  mean: number
  stddev: number
  distribution: Map<number, number>
  percentiles: Record<number, number>
}

interface MonteCarloOptions {
  trials?: number
}

export interface MonteCarloAsyncOptions {
  trials?: number
  chunkSize?: number
  roller?: Roller
}

export interface MonteCarloProgress {
  completed: number
  total: number
  result: MonteCarloResult
}

function percentileFromDist(dist: Distribution, p: number): number {
  const entries = [...dist.entries()].sort((a, b) => a[0] - b[0])
  const target = p / 100
  let cumulative = 0
  for (const [v, prob] of entries) {
    cumulative += prob
    if (cumulative >= target) return v
  }
  return entries[entries.length - 1][0]
}

function stddevFromDist(dist: Distribution): number {
  return Math.sqrt(varianceFromDist(dist))
}

function buildMonteCarloResult(
  results: number[],
  rawDist: Map<number, number>,
): MonteCarloResult {
  const count = results.length
  const dist: Map<number, number> = new Map()
  for (const [k, v] of rawDist) {
    dist.set(k, v / count)
  }
  const mean = results.reduce((a, b) => a + b, 0) / count
  const variance = results.reduce((a, b) => a + (b - mean) ** 2, 0) / count
  const sorted = results.slice().sort((a, b) => a - b)
  return {
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    distribution: dist,
    percentile: (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)]
    },
  }
}

export const DiceStats = {
  distribution(expr: DiceExpression): Distribution {
    return distributionOf(expr)
  },

  mean(expr: DiceExpression): number {
    return meanFromDist(distributionOf(expr))
  },

  stddev(expr: DiceExpression): number {
    return Math.sqrt(varianceFromDist(distributionOf(expr)))
  },

  min(expr: DiceExpression): number {
    const dist = distributionOf(expr)
    let minVal = Infinity
    for (const v of dist.keys()) {
      if (v < minVal) minVal = v
    }
    return minVal
  },

  max(expr: DiceExpression): number {
    const dist = distributionOf(expr)
    let maxVal = -Infinity
    for (const v of dist.keys()) {
      if (v > maxVal) maxVal = v
    }
    return maxVal
  },

  percentile(expr: DiceExpression, p: number): number {
    return percentileFromDist(distributionOf(expr), p)
  },

  monteCarlo(
    expr: DiceExpression,
    options?: MonteCarloOptions,
  ): MonteCarloResult {
    const trials = options?.trials ?? 10000
    const roller = new Roller((max) => Math.floor(Math.random() * max) + 1)
    const results: number[] = []
    const dist: Map<number, number> = new Map()

    for (let i = 0; i < trials; i++) {
      const value = RR.getResult(roller.roll(expr))
      results.push(value)
      dist.set(value, (dist.get(value) ?? 0) + 1)
    }

    return buildMonteCarloResult(results, dist)
  },

  async *monteCarloAsync(
    expr: DiceExpression,
    options?: MonteCarloAsyncOptions,
  ): AsyncGenerator<MonteCarloProgress> {
    const total = options?.trials ?? 10000
    const chunkSize = options?.chunkSize ?? 1000
    const roller =
      options?.roller ??
      new Roller((max) => Math.floor(Math.random() * max) + 1)
    const results: number[] = []
    const dist: Map<number, number> = new Map()

    for (let i = 0; i < total; i++) {
      const value = RR.getResult(roller.roll(expr))
      results.push(value)
      dist.set(value, (dist.get(value) ?? 0) + 1)

      if ((i + 1) % chunkSize === 0 || i === total - 1) {
        yield {
          completed: i + 1,
          total,
          result: buildMonteCarloResult(results, dist),
        }
      }
    }
  },

  summary(expr: DiceExpression): SummaryResult {
    const complexity = DE.calculateBasicRolls(expr)
    if (complexity <= 20) {
      try {
        const dist = DiceStats.distribution(expr)
        return {
          min: Math.min(...dist.keys()),
          max: Math.max(...dist.keys()),
          mean: meanFromDist(dist),
          stddev: stddevFromDist(dist),
          distribution: dist,
          percentiles: {
            25: percentileFromDist(dist, 25),
            50: percentileFromDist(dist, 50),
            75: percentileFromDist(dist, 75),
          },
        }
      } catch {
        // fall through to Monte Carlo
      }
    }
    const mc = DiceStats.monteCarlo(expr, { trials: 50000 })
    return {
      min: mc.min,
      max: mc.max,
      mean: mc.mean,
      stddev: mc.stddev,
      distribution: mc.distribution,
      percentiles: {
        25: mc.percentile(25),
        50: mc.percentile(50),
        75: mc.percentile(75),
      },
    }
  },
}
