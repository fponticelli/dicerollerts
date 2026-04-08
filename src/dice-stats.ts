import type {
  DiceExpression,
  DiceReduceable,
  DiceReducer,
  DiceBinOp,
} from './dice-expression'
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
  }
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

function distributeReduceable(
  reduceable: DiceReduceable,
  reducer: DiceReducer,
): Distribution {
  switch (reduceable.type) {
    case 'dice-expressions': {
      const subDists = reduceable.exprs.map(distributionOf)
      return reduceDistributions(subDists, reducer)
    }
    case 'dice-list-with-filter': {
      // Enumerate all combinations from the filterable list
      let subDists: Distribution[]
      if (reduceable.list.type === 'filterable-dice-array') {
        subDists = reduceable.list.dice.map((sides) =>
          distributionOf({ type: 'die', sides }),
        )
      } else {
        subDists = reduceable.list.exprs.map(distributionOf)
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
      throw 'exact-not-supported'
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

interface MonteCarloResult {
  mean: number
  stddev: number
  min: number
  max: number
  distribution: Map<number, number>
  percentile: (p: number) => number
}

interface SummaryResult {
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

    // Normalize distribution
    for (const [k, v] of dist) {
      dist.set(k, v / trials)
    }

    const mean = results.reduce((a, b) => a + b, 0) / results.length
    const variance =
      results.reduce((a, b) => a + (b - mean) ** 2, 0) / results.length
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
  },

  summary(expr: DiceExpression): SummaryResult {
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
    }
  },
}
