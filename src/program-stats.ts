import type { DiceExpression } from './dice-expression'
import type { Program, Statement, Expression, Value } from './program'
import { Evaluator } from './evaluator'
import { DiceStats } from './dice-stats'

export type FieldStats =
  | {
      type: 'number'
      mean: number
      stddev: number
      min: number
      max: number
      distribution: Map<number, number>
    }
  | { type: 'boolean'; truePercent: number }
  | { type: 'string'; frequencies: Map<string, number> }
  | { type: 'array'; elements: FieldStats[] }
  | { type: 'record'; fields: Record<string, FieldStats> }
  | { type: 'mixed' }

export type Tier = 'constant' | 'exact' | 'monte-carlo'

export interface AnalysisStrategy {
  tier: Tier
  trials?: number
  converged?: boolean
}

export interface AnalyzeResult {
  stats: FieldStats
  strategy: AnalysisStrategy
}

interface AnalyzeOptions {
  // Legacy fixed-trial option (still respected as a maxTrials cap when given)
  trials?: number
  maxTrials?: number
  minTrials?: number
  batchSize?: number
  targetRelativeError?: number
}

const DEFAULT_MAX_TRIALS = 100000
const DEFAULT_MIN_TRIALS = 1000
const DEFAULT_BATCH_SIZE = 1000
const DEFAULT_TARGET_REL_ERROR = 0.01

export const ProgramStats = {
  classify(program: Program): Tier {
    return classifyProgram(program)
  },

  analyze(program: Program, options?: AnalyzeOptions): AnalyzeResult {
    const tier = classifyProgram(program)

    if (tier === 'constant') {
      const evaluator = makeEvaluator()
      const value = evaluator.run(program)
      return {
        stats: constantStats(value),
        strategy: { tier: 'constant' },
      }
    }

    if (tier === 'exact') {
      const diceExpr = extractSingleDiceExpression(program)
      if (diceExpr !== null) {
        try {
          const dist = DiceStats.distribution(diceExpr)
          return {
            stats: numberStatsFromDistribution(dist),
            strategy: { tier: 'exact' },
          }
        } catch {
          // Fall through to Monte Carlo if exact analysis is unsupported
        }
      }
    }

    return runMonteCarlo(program, options)
  },
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface ClassifyContext {
  randomVars: Set<string>
  varUseCount: Map<string, number>
}

function makeContext(): ClassifyContext {
  return { randomVars: new Set(), varUseCount: new Map() }
}

interface ExprClassification {
  random: boolean
}

function classifyProgram(program: Program): Tier {
  const ctx = makeContext()
  let lastExprClass: ExprClassification = { random: false }
  let lastStmt: Statement | null = null

  for (const stmt of program.statements) {
    lastStmt = stmt
    if (stmt.type === 'assignment') {
      const c = classifyExpr(stmt.value, ctx)
      if (c.random) ctx.randomVars.add(stmt.name)
      lastExprClass = c
    } else {
      lastExprClass = classifyExpr(stmt.expr, ctx)
    }
  }

  if (!lastExprClass.random) return 'constant'

  // Tier 2 (exact) only for the simplest case: a single expression-statement
  // whose expression is a `DiceExpr` with no variable references inside.
  if (
    lastStmt &&
    lastStmt.type === 'expression-statement' &&
    lastStmt.expr.type === 'dice-expr' &&
    !diceExpressionHasVarRef(lastStmt.expr.expr) &&
    program.statements.length === 1
  ) {
    return 'exact'
  }

  return 'monte-carlo'
}

function classifyExpr(
  expr: Expression,
  ctx: ClassifyContext,
): ExprClassification {
  switch (expr.type) {
    case 'number-literal':
    case 'boolean-literal':
    case 'string-literal':
      return { random: false }

    case 'variable-ref': {
      ctx.varUseCount.set(expr.name, (ctx.varUseCount.get(expr.name) ?? 0) + 1)
      return { random: ctx.randomVars.has(expr.name) }
    }

    case 'dice-expr':
      return { random: true }

    case 'unary-expr':
      return classifyExpr(expr.expr, ctx)

    case 'binary-expr': {
      const left = classifyExpr(expr.left, ctx)
      const right = classifyExpr(expr.right, ctx)
      return { random: left.random || right.random }
    }

    case 'if-expr': {
      const cond = classifyExpr(expr.condition, ctx)
      const thenC = classifyExpr(expr.then, ctx)
      const elseC = classifyExpr(expr.else, ctx)
      return { random: cond.random || thenC.random || elseC.random }
    }

    case 'record-expr': {
      let random = false
      for (const f of expr.fields) {
        const c = classifyExpr(f.value, ctx)
        if (c.random) random = true
      }
      return { random }
    }

    case 'array-expr': {
      let random = false
      for (const el of expr.elements) {
        const c = classifyExpr(el, ctx)
        if (c.random) random = true
      }
      return { random }
    }

    case 'repeat-expr': {
      // Even if body is non-random, the count or body randomness propagates.
      const countC = classifyExpr(expr.count, ctx)
      let bodyRandom = false
      for (const stmt of expr.body) {
        if (stmt.type === 'assignment') {
          const c = classifyExpr(stmt.value, ctx)
          if (c.random) {
            ctx.randomVars.add(stmt.name)
            bodyRandom = true
          }
        } else {
          const c = classifyExpr(stmt.expr, ctx)
          if (c.random) bodyRandom = true
        }
      }
      return { random: countC.random || bodyRandom }
    }

    case 'field-access':
      return classifyExpr(expr.object, ctx)

    case 'index-access': {
      const obj = classifyExpr(expr.object, ctx)
      const idx = classifyExpr(expr.index, ctx)
      return { random: obj.random || idx.random }
    }
  }
}

function diceExpressionHasVarRef(expr: DiceExpression): boolean {
  switch (expr.type) {
    case 'die':
    case 'custom-die':
    case 'literal':
      return false
    case 'dice-variable-ref':
      return true
    case 'binary-op':
      return (
        diceExpressionHasVarRef(expr.left) ||
        diceExpressionHasVarRef(expr.right)
      )
    case 'unary-op':
      return diceExpressionHasVarRef(expr.expr)
    case 'dice-reduce': {
      const r = expr.reduceable
      switch (r.type) {
        case 'dice-expressions':
          return r.exprs.some(diceExpressionHasVarRef)
        case 'dice-list-with-filter':
          if (r.list.type === 'filterable-dice-array') return false
          return r.list.exprs.some(diceExpressionHasVarRef)
        case 'dice-list-with-map':
          return false
      }
    }
  }
}

function extractSingleDiceExpression(program: Program): DiceExpression | null {
  if (program.statements.length !== 1) return null
  const stmt = program.statements[0]
  if (stmt.type !== 'expression-statement') return null
  if (stmt.expr.type !== 'dice-expr') return null
  return stmt.expr.expr
}

// ---------------------------------------------------------------------------
// Constant tier
// ---------------------------------------------------------------------------

function constantStats(value: Value): FieldStats {
  if (typeof value === 'number') {
    return {
      type: 'number',
      mean: value,
      stddev: 0,
      min: value,
      max: value,
      distribution: new Map([[value, 1]]),
    }
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', truePercent: value ? 1 : 0 }
  }
  if (typeof value === 'string') {
    return { type: 'string', frequencies: new Map([[value, 1]]) }
  }
  if (Array.isArray(value)) {
    return { type: 'array', elements: value.map(constantStats) }
  }
  if (value !== null && typeof value === 'object') {
    const fields: Record<string, FieldStats> = {}
    for (const [k, v] of Object.entries(value)) {
      fields[k] = constantStats(v)
    }
    return { type: 'record', fields }
  }
  return { type: 'mixed' }
}

// ---------------------------------------------------------------------------
// Exact tier helpers
// ---------------------------------------------------------------------------

function numberStatsFromDistribution(dist: Map<number, number>): FieldStats {
  let mean = 0
  let min = Infinity
  let max = -Infinity
  for (const [v, p] of dist) {
    mean += v * p
    if (v < min) min = v
    if (v > max) max = v
  }
  let variance = 0
  for (const [v, p] of dist) {
    variance += (v - mean) ** 2 * p
  }
  // Copy the distribution to avoid sharing internal maps with callers.
  const distribution = new Map<number, number>()
  for (const [k, p] of dist) distribution.set(k, p)
  return {
    type: 'number',
    mean,
    stddev: Math.sqrt(variance),
    min,
    max,
    distribution,
  }
}

// ---------------------------------------------------------------------------
// Adaptive Monte Carlo tier
// ---------------------------------------------------------------------------

function makeEvaluator(): Evaluator {
  const rollFn = (max: number) => Math.floor(Math.random() * max) + 1
  return new Evaluator(rollFn)
}

function runMonteCarlo(
  program: Program,
  options?: AnalyzeOptions,
): AnalyzeResult {
  const explicitTrials = options?.trials
  const maxTrials = options?.maxTrials ?? explicitTrials ?? DEFAULT_MAX_TRIALS
  const minTrialsRaw = options?.minTrials ?? DEFAULT_MIN_TRIALS
  const minTrials = Math.min(minTrialsRaw, maxTrials)
  const batchSizeRaw = options?.batchSize ?? DEFAULT_BATCH_SIZE
  const batchSize = Math.max(1, Math.min(batchSizeRaw, maxTrials))
  const targetRelativeError =
    options?.targetRelativeError ?? DEFAULT_TARGET_REL_ERROR
  // If user passed legacy `trials` (without maxTrials), honor it as a fixed run.
  const fixedTrials =
    explicitTrials !== undefined && options?.maxTrials === undefined
      ? explicitTrials
      : null

  const results: Value[] = []
  let total = 0
  let converged = false

  if (fixedTrials !== null) {
    const evaluator = makeEvaluator()
    for (let i = 0; i < fixedTrials; i++) {
      results.push(evaluator.run(program))
    }
    total = fixedTrials
    return {
      stats: buildStats(results),
      strategy: { tier: 'monte-carlo', trials: total, converged: false },
    }
  }

  const evaluator = makeEvaluator()

  // Phase 1: minTrials
  while (total < minTrials) {
    const target = Math.min(total + batchSize, minTrials)
    while (total < target) {
      results.push(evaluator.run(program))
      total++
    }
  }

  // Phase 2: keep running batches until convergence or maxTrials
  while (total < maxTrials) {
    if (hasConverged(results, targetRelativeError)) {
      converged = true
      break
    }
    const target = Math.min(total + batchSize, maxTrials)
    while (total < target) {
      results.push(evaluator.run(program))
      total++
    }
  }

  if (!converged && hasConverged(results, targetRelativeError)) {
    converged = true
  }

  return {
    stats: buildStats(results),
    strategy: { tier: 'monte-carlo', trials: total, converged },
  }
}

// ---------------------------------------------------------------------------
// Convergence checks
// ---------------------------------------------------------------------------

function hasConverged(values: Value[], target: number): boolean {
  if (values.length === 0) return false
  return checkConvergence(values, target)
}

function checkConvergence(values: Value[], target: number): boolean {
  const first = values[0]
  const t = typeOf(first)
  for (const v of values) {
    if (typeOf(v) !== t) return true // mixed - cannot improve, treat as converged
  }
  switch (t) {
    case 'number':
      return numberConverged(values as number[], target)
    case 'boolean':
      return booleanConverged(values as boolean[], target)
    case 'string':
      return stringConverged(values as string[], target)
    case 'array': {
      const arrs = values as Value[][]
      if (arrs.length === 0) return true
      const len = arrs[0].length
      for (let i = 0; i < len; i++) {
        const column = arrs.map((a) => a[i])
        if (!checkConvergence(column, target)) return false
      }
      return true
    }
    case 'record': {
      const recs = values as Record<string, Value>[]
      if (recs.length === 0) return true
      const keys = Object.keys(recs[0])
      for (const k of keys) {
        const column = recs.map((r) => r[k])
        if (!checkConvergence(column, target)) return false
      }
      return true
    }
    default:
      return true
  }
}

function numberConverged(values: number[], target: number): boolean {
  const n = values.length
  if (n < 2) return false
  let sum = 0
  let min = values[0]
  let max = values[0]
  for (const v of values) {
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  const mean = sum / n
  let variance = 0
  for (const v of values) variance += (v - mean) ** 2
  variance /= n
  const stddev = Math.sqrt(variance)
  const stderr = stddev / Math.sqrt(n)
  if (stddev === 0) return true
  const range = max - min
  // Use range when meaningful, otherwise fall back to |mean|, then to stddev.
  const denom = range > 0 ? range : Math.abs(mean) > 0 ? Math.abs(mean) : stddev
  return stderr / denom <= target
}

function booleanConverged(values: boolean[], target: number): boolean {
  const n = values.length
  if (n < 2) return false
  let trueCount = 0
  for (const v of values) if (v) trueCount++
  const p = trueCount / n
  // Standard error of a proportion. Use 0.25 (max variance at p=0.5)
  // when p is at an extreme to avoid early convergence on tiny samples.
  const variance = Math.max(p * (1 - p), 0)
  const stderr = Math.sqrt(variance / n)
  // Compare stderr against the target; range for booleans is 1.
  return stderr <= target
}

function stringConverged(values: string[], target: number): boolean {
  const n = values.length
  if (n < 2) return false
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  for (const c of counts.values()) {
    const p = c / n
    const stderr = Math.sqrt((p * (1 - p)) / n)
    if (stderr > target) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Stats aggregation (Monte Carlo result -> FieldStats)
// ---------------------------------------------------------------------------

function buildStats(values: Value[]): FieldStats {
  if (values.length === 0) return { type: 'mixed' }

  const first = values[0]
  const firstType = typeOf(first)

  // Check for mixed types
  for (const v of values) {
    if (typeOf(v) !== firstType) return { type: 'mixed' }
  }

  if (firstType === 'number') {
    return buildNumberStats(values as number[])
  }

  if (firstType === 'boolean') {
    return buildBooleanStats(values as boolean[])
  }

  if (firstType === 'string') {
    return buildStringStats(values as string[])
  }

  if (firstType === 'array') {
    return buildArrayStats(values as Value[][])
  }

  if (firstType === 'record') {
    return buildRecordStats(values as Record<string, Value>[])
  }

  return { type: 'mixed' }
}

function typeOf(value: Value): string {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  return 'record'
}

function buildNumberStats(values: number[]): FieldStats {
  const n = values.length
  let sum = 0
  let min = values[0]
  let max = values[0]
  const counts = new Map<number, number>()

  for (const v of values) {
    sum += v
    if (v < min) min = v
    if (v > max) max = v
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  const mean = sum / n

  let variance = 0
  for (const v of values) {
    variance += (v - mean) ** 2
  }
  const stddev = Math.sqrt(variance / n)

  const distribution = new Map<number, number>()
  for (const [k, count] of counts) {
    distribution.set(k, count / n)
  }

  return { type: 'number', mean, stddev, min, max, distribution }
}

function buildBooleanStats(values: boolean[]): FieldStats {
  const trueCount = values.filter((v) => v).length
  return { type: 'boolean', truePercent: trueCount / values.length }
}

function buildStringStats(values: string[]): FieldStats {
  const counts = new Map<string, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const frequencies = new Map<string, number>()
  for (const [k, count] of counts) {
    frequencies.set(k, count / values.length)
  }
  return { type: 'string', frequencies }
}

function buildArrayStats(values: Value[][]): FieldStats {
  if (values.length === 0) return { type: 'array', elements: [] }
  const length = values[0].length
  const elements: FieldStats[] = []
  for (let i = 0; i < length; i++) {
    const column = values.map((arr) => arr[i])
    elements.push(buildStats(column))
  }
  return { type: 'array', elements }
}

function buildRecordStats(values: Record<string, Value>[]): FieldStats {
  if (values.length === 0) return { type: 'record', fields: {} }
  const keys = Object.keys(values[0])
  const fields: Record<string, FieldStats> = {}
  for (const key of keys) {
    const column = values.map((rec) => rec[key])
    fields[key] = buildStats(column)
  }
  return { type: 'record', fields }
}
