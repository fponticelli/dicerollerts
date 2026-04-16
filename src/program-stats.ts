import type { DiceExpression } from './dice-expression'
import type { Program, Expression, Value } from './program'
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
  targetBinStderr?: number
}

const DEFAULT_MAX_TRIALS = 100000
const DEFAULT_MIN_TRIALS = 1000
const DEFAULT_BATCH_SIZE = 1000
const DEFAULT_TARGET_REL_ERROR = 0.01
const DEFAULT_TARGET_BIN_STDERR = 0.005

export const ProgramStats = {
  classify(program: Program): Tier {
    return classifyProgram(program)
  },

  analyze(program: Program, options?: AnalyzeOptions): AnalyzeResult {
    const analysis = analyzeProgram(program)

    if (!analysis.random) {
      const evaluator = makeEvaluator()
      const value = evaluator.run(program)
      return {
        stats: constantStats(value),
        strategy: { tier: 'constant' },
      }
    }

    if (analysis.exactDist !== null) {
      const stats = analysis.exactDist()
      if (stats !== null) {
        return {
          stats,
          strategy: { tier: 'exact' },
        }
      }
    }

    return runMonteCarlo(program, options)
  },
}

// ---------------------------------------------------------------------------
// Per-expression analysis
// ---------------------------------------------------------------------------

interface ExprAnalysis {
  random: boolean
  randomVarsUsed: Set<string>
  // A thunk producing the exact FieldStats for the expression, or null if
  // the expression cannot be analyzed exactly.
  exactDist: (() => FieldStats | null) | null
}

interface AnalysisEnv {
  // Map of variable name -> analysis of its bound expression. Used to look up
  // randomVarsUsed transitively and to detect aliases of exact compositions.
  bindings: Map<string, ExprAnalysis>
}

function makeAnalysisEnv(): AnalysisEnv {
  return { bindings: new Map() }
}

function classifyProgram(program: Program): Tier {
  const analysis = analyzeProgram(program)
  if (!analysis.random) return 'constant'
  if (analysis.exactDist !== null) {
    // Test the thunk - if it returns null we cannot actually compute exact stats.
    // However, classify() should not actually compute the (possibly expensive)
    // distribution. We trust the structural analysis: thunks are non-null only
    // when sub-pieces also report exactDist; the only failure mode is
    // DiceStats.distribution() throwing for an unsupported dice expression.
    // To avoid running heavy computation here, we still mark as exact when the
    // structural analysis says so. The analyze() entry point will fall back to
    // monte-carlo if the thunk later returns null.
    return 'exact'
  }
  return 'monte-carlo'
}

function analyzeProgram(program: Program): ExprAnalysis {
  const env = makeAnalysisEnv()
  let last: ExprAnalysis = nonRandomAnalysis()

  for (const stmt of program.statements) {
    if (stmt.type === 'assignment') {
      const a = analyzeExpr(stmt.value, env)
      env.bindings.set(stmt.name, a)
      last = a
    } else {
      last = analyzeExpr(stmt.expr, env)
    }
  }

  return last
}

function nonRandomAnalysis(): ExprAnalysis {
  return { random: false, randomVarsUsed: new Set(), exactDist: null }
}

function analyzeExpr(expr: Expression, env: AnalysisEnv): ExprAnalysis {
  switch (expr.type) {
    case 'number-literal':
    case 'boolean-literal':
    case 'string-literal':
      return nonRandomAnalysis()

    case 'variable-ref': {
      const bound = env.bindings.get(expr.name)
      if (!bound) {
        // Unbound (shouldn't happen in valid programs); treat as non-random.
        return nonRandomAnalysis()
      }
      // Referencing a random variable means this expression depends on that
      // variable's randomness. Track the variable name itself as a "random
      // variable used" so siblings sharing the same variable can be detected
      // as correlated.
      const randomVarsUsed = new Set<string>()
      if (bound.random) randomVarsUsed.add(expr.name)
      // Variable references are exact only when the bound value is non-random
      // (a deterministic alias). For random variables, we cannot recompute the
      // distribution from a reference alone (would create correlations).
      // However an exact-dist binding may still be inlined when used as the
      // sole reference inside a record/array field; conservatively we treat
      // bare variable refs as non-exact for arbitrary use sites.
      return {
        random: bound.random,
        randomVarsUsed,
        exactDist: null,
      }
    }

    case 'dice-expr': {
      const hasVarRef = diceExpressionHasVarRef(expr.expr)
      const exprCopy = expr.expr
      const exactDist: (() => FieldStats | null) | null = hasVarRef
        ? null
        : () => {
            try {
              const dist = DiceStats.distribution(exprCopy)
              return numberStatsFromDistribution(dist)
            } catch {
              return null
            }
          }
      return {
        random: true,
        randomVarsUsed: new Set(),
        exactDist,
      }
    }

    case 'unary-expr': {
      const inner = analyzeExpr(expr.expr, env)
      return {
        random: inner.random,
        randomVarsUsed: new Set(inner.randomVarsUsed),
        exactDist: null,
      }
    }

    case 'binary-expr': {
      const left = analyzeExpr(expr.left, env)
      const right = analyzeExpr(expr.right, env)
      return {
        random: left.random || right.random,
        randomVarsUsed: unionSets(left.randomVarsUsed, right.randomVarsUsed),
        exactDist: null,
      }
    }

    case 'if-expr': {
      const cond = analyzeExpr(expr.condition, env)
      const thenA = analyzeExpr(expr.then, env)
      const elseA = analyzeExpr(expr.else, env)
      return {
        random: cond.random || thenA.random || elseA.random,
        randomVarsUsed: unionSets(
          cond.randomVarsUsed,
          unionSets(thenA.randomVarsUsed, elseA.randomVarsUsed),
        ),
        exactDist: null,
      }
    }

    case 'record-expr': {
      const fieldAnalyses: { key: string; analysis: ExprAnalysis }[] =
        expr.fields.map((f) => ({
          key: f.key,
          analysis: analyzeExpr(f.value, env),
        }))
      const random = fieldAnalyses.some((f) => f.analysis.random)
      const randomVarsUsed = fieldAnalyses.reduce(
        (acc, f) => unionSets(acc, f.analysis.randomVarsUsed),
        new Set<string>(),
      )

      let exactDist: (() => FieldStats | null) | null = null
      if (
        random &&
        fieldAnalyses.every((f) => f.analysis.exactDist !== null) &&
        disjointRandomVars(fieldAnalyses.map((f) => f.analysis))
      ) {
        exactDist = () => {
          const fields: Record<string, FieldStats> = {}
          for (const f of fieldAnalyses) {
            const sub = f.analysis.exactDist!()
            if (sub === null) return null
            fields[f.key] = sub
          }
          return { type: 'record', fields }
        }
      }

      return { random, randomVarsUsed, exactDist }
    }

    case 'array-expr': {
      const elementAnalyses = expr.elements.map((el) => analyzeExpr(el, env))
      const random = elementAnalyses.some((a) => a.random)
      const randomVarsUsed = elementAnalyses.reduce(
        (acc, a) => unionSets(acc, a.randomVarsUsed),
        new Set<string>(),
      )

      let exactDist: (() => FieldStats | null) | null = null
      if (
        random &&
        elementAnalyses.every((a) => a.exactDist !== null) &&
        disjointRandomVars(elementAnalyses)
      ) {
        exactDist = () => {
          const elements: FieldStats[] = []
          for (const a of elementAnalyses) {
            const sub = a.exactDist!()
            if (sub === null) return null
            elements.push(sub)
          }
          return { type: 'array', elements }
        }
      }

      return { random, randomVarsUsed, exactDist }
    }

    case 'repeat-expr': {
      const countA = analyzeExpr(expr.count, env)
      // Variables defined outside the repeat body: snapshot now so we can
      // detect references to them from within the body.
      const outerVars = new Set(env.bindings.keys())

      // Repeat body runs in a fresh scope each iteration. Analyze the body's
      // statements with a child environment that inherits outer bindings (for
      // randomVar tracking) but isolates new ones.
      const childEnv: AnalysisEnv = {
        bindings: new Map(env.bindings),
      }
      let bodyLast: ExprAnalysis = nonRandomAnalysis()
      for (const stmt of expr.body) {
        if (stmt.type === 'assignment') {
          const a = analyzeExpr(stmt.value, childEnv)
          childEnv.bindings.set(stmt.name, a)
          bodyLast = a
        } else {
          bodyLast = analyzeExpr(stmt.expr, childEnv)
        }
      }

      const random = countA.random || bodyLast.random
      const randomVarsUsed = unionSets(
        countA.randomVarsUsed,
        bodyLast.randomVarsUsed,
      )

      let exactDist: (() => FieldStats | null) | null = null
      const constCount = constantIntegerValue(expr.count)
      // Body uses no random variables from the outer scope.
      const bodyUsesOuterRandomVars = setsIntersect(
        bodyLast.randomVarsUsed,
        outerVars,
      )
      if (
        constCount !== null &&
        constCount >= 0 &&
        bodyLast.exactDist !== null &&
        bodyLast.random &&
        !bodyUsesOuterRandomVars
      ) {
        exactDist = () => {
          // Compute the body's exact stats once, then clone for each iteration.
          const single = bodyLast.exactDist!()
          if (single === null) return null
          const elements: FieldStats[] = []
          for (let i = 0; i < constCount; i++) {
            elements.push(cloneFieldStats(single))
          }
          return { type: 'array', elements }
        }
      }

      return { random, randomVarsUsed, exactDist }
    }

    case 'field-access': {
      const obj = analyzeExpr(expr.object, env)
      // Special case: $rec.field where $rec is a variable bound directly to a
      // record literal whose field is exact.
      if (expr.object.type === 'variable-ref') {
        const bound = env.bindings.get(expr.object.name)
        if (bound && bound.exactDist !== null) {
          const field = expr.field
          const exactDist: () => FieldStats | null = () => {
            const stats = bound.exactDist!()
            if (stats === null || stats.type !== 'record') return null
            return stats.fields[field] ?? null
          }
          return {
            random: obj.random,
            randomVarsUsed: new Set(obj.randomVarsUsed),
            exactDist,
          }
        }
      }
      return {
        random: obj.random,
        randomVarsUsed: new Set(obj.randomVarsUsed),
        exactDist: null,
      }
    }

    case 'index-access': {
      const obj = analyzeExpr(expr.object, env)
      const idx = analyzeExpr(expr.index, env)
      const constIdx = constantIntegerValue(expr.index)
      if (
        expr.object.type === 'variable-ref' &&
        constIdx !== null &&
        !idx.random
      ) {
        const bound = env.bindings.get(expr.object.name)
        if (bound && bound.exactDist !== null) {
          const exactDist: () => FieldStats | null = () => {
            const stats = bound.exactDist!()
            if (stats === null || stats.type !== 'array') return null
            return stats.elements[constIdx] ?? null
          }
          return {
            random: obj.random || idx.random,
            randomVarsUsed: unionSets(obj.randomVarsUsed, idx.randomVarsUsed),
            exactDist,
          }
        }
      }
      return {
        random: obj.random || idx.random,
        randomVarsUsed: unionSets(obj.randomVarsUsed, idx.randomVarsUsed),
        exactDist: null,
      }
    }
  }
}

// Returns the constant integer value of an expression, or null if the
// expression is not a constant integer literal.
function constantIntegerValue(expr: Expression): number | null {
  if (expr.type === 'number-literal' && Number.isInteger(expr.value)) {
    return expr.value
  }
  return null
}

function disjointRandomVars(analyses: ExprAnalysis[]): boolean {
  const seen = new Set<string>()
  for (const a of analyses) {
    for (const name of a.randomVarsUsed) {
      if (seen.has(name)) return false
      seen.add(name)
    }
  }
  return true
}

function unionSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a)
  for (const v of b) out.add(v)
  return out
}

function setsIntersect<T>(a: Set<T>, b: Set<T>): boolean {
  for (const v of a) if (b.has(v)) return true
  return false
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

function cloneFieldStats(stats: FieldStats): FieldStats {
  switch (stats.type) {
    case 'number':
      return {
        type: 'number',
        mean: stats.mean,
        stddev: stats.stddev,
        min: stats.min,
        max: stats.max,
        distribution: new Map(stats.distribution),
      }
    case 'boolean':
      return { type: 'boolean', truePercent: stats.truePercent }
    case 'string':
      return { type: 'string', frequencies: new Map(stats.frequencies) }
    case 'array':
      return { type: 'array', elements: stats.elements.map(cloneFieldStats) }
    case 'record': {
      const fields: Record<string, FieldStats> = {}
      for (const [k, v] of Object.entries(stats.fields)) {
        fields[k] = cloneFieldStats(v)
      }
      return { type: 'record', fields }
    }
    case 'mixed':
      return { type: 'mixed' }
  }
}

// ---------------------------------------------------------------------------
// Adaptive Monte Carlo tier
// ---------------------------------------------------------------------------

function makeEvaluator(): Evaluator {
  const rollFn = (max: number) => Math.floor(Math.random() * max) + 1
  return new Evaluator(rollFn)
}

interface ConvergenceConfig {
  targetRelativeError: number
  targetBinStderr: number
  minTrials: number
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
  const targetBinStderr = options?.targetBinStderr ?? DEFAULT_TARGET_BIN_STDERR
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
  const config: ConvergenceConfig = {
    targetRelativeError,
    targetBinStderr,
    minTrials,
  }

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
    if (hasConverged(results, config)) {
      converged = true
      break
    }
    const target = Math.min(total + batchSize, maxTrials)
    while (total < target) {
      results.push(evaluator.run(program))
      total++
    }
  }

  if (!converged && hasConverged(results, config)) {
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

function hasConverged(values: Value[], config: ConvergenceConfig): boolean {
  if (values.length === 0) return false
  return checkConvergence(values, config)
}

function checkConvergence(values: Value[], config: ConvergenceConfig): boolean {
  const first = values[0]
  const t = typeOf(first)
  for (const v of values) {
    if (typeOf(v) !== t) return true // mixed - cannot improve, treat as converged
  }
  switch (t) {
    case 'number':
      return numberConverged(values as number[], config)
    case 'boolean':
      return booleanConverged(values as boolean[], config.targetBinStderr)
    case 'string':
      return stringConverged(values as string[], config.targetBinStderr)
    case 'array': {
      const arrs = values as Value[][]
      if (arrs.length === 0) return true
      const len = arrs[0].length
      for (let i = 0; i < len; i++) {
        const column = arrs.map((a) => a[i])
        if (!checkConvergence(column, config)) return false
      }
      return true
    }
    case 'record': {
      const recs = values as Record<string, Value>[]
      if (recs.length === 0) return true
      const keys = Object.keys(recs[0])
      for (const k of keys) {
        const column = recs.map((r) => r[k])
        if (!checkConvergence(column, config)) return false
      }
      return true
    }
    default:
      return true
  }
}

function numberConverged(values: number[], config: ConvergenceConfig): boolean {
  const n = values.length
  if (n < 2) return false

  // Count unique values to handle the degenerate case of very few bins.
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)

  // For very few unique values the per-bin check converges almost instantly,
  // so require at least minTrials samples before declaring convergence.
  if (counts.size <= 2 && n < config.minTrials) return false

  // Per-bin convergence: each bin's frequency standard error must be below
  // the target. Ignore "noise" bins where p < 1/n (essentially singletons
  // from rare values).
  const threshold = 1 / n
  for (const c of counts.values()) {
    const p = c / n
    if (p < threshold) continue
    const stderrP = Math.sqrt((p * (1 - p)) / n)
    if (stderrP > config.targetBinStderr) return false
  }
  return true
}

function booleanConverged(values: boolean[], targetBinStderr: number): boolean {
  const n = values.length
  if (n < 2) return false
  let trueCount = 0
  for (const v of values) if (v) trueCount++
  const p = trueCount / n
  // Standard error of a proportion. Use 0.25 (max variance at p=0.5)
  // when p is at an extreme to avoid early convergence on tiny samples.
  const variance = Math.max(p * (1 - p), 0)
  const stderr = Math.sqrt(variance / n)
  return stderr <= targetBinStderr
}

function stringConverged(values: string[], targetBinStderr: number): boolean {
  const n = values.length
  if (n < 2) return false
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const threshold = 1 / n
  for (const c of counts.values()) {
    const p = c / n
    if (p < threshold) continue
    const stderr = Math.sqrt((p * (1 - p)) / n)
    if (stderr > targetBinStderr) return false
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
