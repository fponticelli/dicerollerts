import type { DiceExpression } from './dice-expression'
import type {
  Program,
  Statement,
  Expression,
  Value,
  BinaryOper,
} from './program'
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

// Maximum number of joint distribution entries before we abandon exact analysis
// for an expression and fall back to MC.
const MAX_JOINT_SIZE = 100000

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
// Symbolic distribution (SymDist)
// ---------------------------------------------------------------------------
//
// A SymDist represents an expression's value as a probability distribution that
// optionally tracks correlations with other random sources. Each `dice-expr`
// node creates one fresh random source. When SymDists are combined, source
// sets are unioned. If they overlap, we walk the joint distribution to keep
// correlations exact; otherwise we Cartesian-product the marginals.
//
// Joint entries map a tuple of source values to an output value/probability.
// We keep `sourceIds` ordered so `sourceVals` can be aligned across entries.

type SymValue = number | boolean | string

interface JointEntry<T extends SymValue> {
  sourceVals: number[]
  value: T
  prob: number
}

interface SymDist<T extends SymValue> {
  // Marginal distribution: value -> probability. Always present.
  dist: Map<T, number>
  // Ordered random source IDs this distribution depends on.
  sourceIds: string[]
  // Joint distribution entries (one per joint outcome); empty array when the
  // distribution is constant (no sources).
  joint: JointEntry<T>[]
}

// ---------------------------------------------------------------------------
// SymDist constructors and operations
// ---------------------------------------------------------------------------

function constSymDist<T extends SymValue>(value: T): SymDist<T> {
  return {
    dist: new Map([[value, 1]]),
    sourceIds: [],
    joint: [{ sourceVals: [], value, prob: 1 }],
  }
}

function fromDiceDistribution(
  sourceId: string,
  dist: Map<number, number>,
): SymDist<number> {
  const joint: JointEntry<number>[] = []
  const marginal = new Map<number, number>()
  for (const [v, p] of dist) {
    if (p === 0) continue
    joint.push({ sourceVals: [v], value: v, prob: p })
    marginal.set(v, (marginal.get(v) ?? 0) + p)
  }
  return { dist: marginal, sourceIds: [sourceId], joint }
}

function mapSymDist<T extends SymValue, U extends SymValue>(
  sd: SymDist<T>,
  fn: (v: T) => U,
): SymDist<U> {
  const joint: JointEntry<U>[] = []
  const marginal = new Map<U, number>()
  for (const entry of sd.joint) {
    const out = fn(entry.value)
    joint.push({ sourceVals: entry.sourceVals, value: out, prob: entry.prob })
    marginal.set(out, (marginal.get(out) ?? 0) + entry.prob)
  }
  return { dist: marginal, sourceIds: sd.sourceIds.slice(), joint }
}

// Combine two SymDists with a binary function. Returns null if the result
// would exceed MAX_JOINT_SIZE.
function combineSymDist<
  A extends SymValue,
  B extends SymValue,
  C extends SymValue,
>(a: SymDist<A>, b: SymDist<B>, fn: (av: A, bv: B) => C): SymDist<C> | null {
  // Compute merged source ordering.
  const mergedSources: string[] = a.sourceIds.slice()
  const sourceIndex = new Map<string, number>()
  a.sourceIds.forEach((s, i) => sourceIndex.set(s, i))
  for (const s of b.sourceIds) {
    if (!sourceIndex.has(s)) {
      sourceIndex.set(s, mergedSources.length)
      mergedSources.push(s)
    }
  }

  const aIdxToMerged = a.sourceIds.map((s) => sourceIndex.get(s)!)
  const bIdxToMerged = b.sourceIds.map((s) => sourceIndex.get(s)!)
  const sharedAIdx: number[] = []
  const sharedBIdx: number[] = []
  for (let i = 0; i < a.sourceIds.length; i++) {
    const j = b.sourceIds.indexOf(a.sourceIds[i])
    if (j >= 0) {
      sharedAIdx.push(i)
      sharedBIdx.push(j)
    }
  }

  // Quick size estimate to fail fast.
  const estimate = a.joint.length * b.joint.length
  if (estimate > MAX_JOINT_SIZE * 4) return null

  // Group b entries by their values at shared positions for efficient lookup
  // when sources overlap.
  let bByShared: Map<string, JointEntry<B>[]> | null = null
  if (sharedAIdx.length > 0) {
    bByShared = new Map()
    for (const be of b.joint) {
      const key = sharedBIdx.map((i) => be.sourceVals[i]).join('|')
      const arr = bByShared.get(key)
      if (arr) arr.push(be)
      else bByShared.set(key, [be])
    }
  }

  const joint: JointEntry<C>[] = []
  const marginal = new Map<C, number>()

  for (const ae of a.joint) {
    let candidates: JointEntry<B>[]
    if (bByShared) {
      const key = sharedAIdx.map((i) => ae.sourceVals[i]).join('|')
      candidates = bByShared.get(key) ?? []
    } else {
      candidates = b.joint
    }
    for (const be of candidates) {
      const merged = new Array<number>(mergedSources.length)
      for (let i = 0; i < a.sourceIds.length; i++) {
        merged[aIdxToMerged[i]] = ae.sourceVals[i]
      }
      for (let i = 0; i < b.sourceIds.length; i++) {
        merged[bIdxToMerged[i]] = be.sourceVals[i]
      }
      // For shared sources the value must match (enforced by grouping).
      // Probability of disjoint pieces multiply; shared piece probability is
      // already counted in `ae`, so we divide out b's marginal contribution
      // for shared sources only when we'd be double-counting. Since each joint
      // entry's probability is the joint probability of its sourceVals, and
      // shared sources are forced to match, we need:
      //   p(merged) = p(ae's unique sources, shared values) * p(be | shared)
      // For independence (no overlap), p(merged) = ae.prob * be.prob.
      // For full overlap (b only depends on shared sources), p(merged) = ae.prob if be matches.
      // General: p(merged) = ae.prob * be.prob / p(shared values)
      let prob: number
      if (sharedAIdx.length === 0) {
        prob = ae.prob * be.prob
      } else {
        // Compute marginal probability of the shared values from b's joint.
        // (Equivalent to summing be.prob over all joint entries with these
        // shared values.) For correctness when shared sources fully determine
        // a, we use the conditional p(b_unique | shared) = be.prob / p_shared.
        const sharedKey = sharedAIdx.map((i) => ae.sourceVals[i]).join('|')
        const pShared = sharedMarginalCache(b, sharedBIdx).get(sharedKey) ?? 0
        if (pShared === 0) continue
        prob = (ae.prob * be.prob) / pShared
      }
      const out = fn(ae.value, be.value)
      joint.push({ sourceVals: merged, value: out, prob })
      marginal.set(out, (marginal.get(out) ?? 0) + prob)
      if (joint.length > MAX_JOINT_SIZE) return null
    }
  }

  return { dist: marginal, sourceIds: mergedSources, joint }
}

// Cache marginal probabilities of shared source values from a joint
// distribution. Recomputed per (joint, shared indices) pair via WeakMap.
const sharedMarginalCacheStore = new WeakMap<
  JointEntry<SymValue>[],
  Map<string, Map<string, number>>
>()

function sharedMarginalCache<T extends SymValue>(
  sd: SymDist<T>,
  sharedIdx: number[],
): Map<string, number> {
  const key = sharedIdx.join(',')
  let outer = sharedMarginalCacheStore.get(
    sd.joint as JointEntry<SymValue>[],
  ) as Map<string, Map<string, number>> | undefined
  if (!outer) {
    outer = new Map()
    sharedMarginalCacheStore.set(sd.joint as JointEntry<SymValue>[], outer)
  }
  const cached = outer.get(key)
  if (cached) return cached
  const m = new Map<string, number>()
  for (const e of sd.joint) {
    const k = sharedIdx.map((i) => e.sourceVals[i]).join('|')
    m.set(k, (m.get(k) ?? 0) + e.prob)
  }
  outer.set(key, m)
  return m
}

// Conditional combinator: if cond then thenD else elseD.
// Manually merges joint distributions across the three SymDists, picking the
// appropriate branch for each joint outcome.
function condSymDist<T extends SymValue>(
  cond: SymDist<boolean>,
  thenD: SymDist<T>,
  elseD: SymDist<T>,
): SymDist<T> | null {
  // We don't need a merged source-id ordering because the resulting SymDist
  // collapses to a pure marginal (sourceIds: []). What we do need is mapping
  // between the three SymDists' source positions to detect shared sources.

  // Enumerate all merged source assignments by combining joint distributions.
  // We compute the joint of (cond, thenD, elseD) using sequential combination
  // with a generic wrapper; since the result type may not be SymValue, we do
  // it manually. Approach: compute joint over the three by enumerating all
  // entries in each, requiring agreement on shared source values.

  // Pre-group thenD and elseD entries by their source values for shared lookup.
  const thenSharedWithCond: number[] = []
  const condSharedWithThen: number[] = []
  for (let i = 0; i < cond.sourceIds.length; i++) {
    const j = thenD.sourceIds.indexOf(cond.sourceIds[i])
    if (j >= 0) {
      condSharedWithThen.push(i)
      thenSharedWithCond.push(j)
    }
  }
  // To simplify: we'll do nested enumeration with agreement checks against
  // partial assignments, tracking a probability based on conditional
  // probabilities derived from shared marginals.

  // Easier and still correct: convert the three SymDists into a "joint over
  // all three's union of sources" via two pairwise combines using a wrapper
  // type. Since SymDist requires SymValue, wrap (boolean, T) and (T) into
  // strings via JSON, but we can avoid that by building the joint directly.

  // Build the joint manually:
  const joint: JointEntry<T>[] = []
  const marginal = new Map<T, number>()

  // We'll enumerate (cond entry, then entry, else entry) tuples that agree on
  // shared source values, computing the joint probability via the chain rule.
  // To avoid combinatorial blow-up we group by shared keys.

  // Index thenD by shared-with-cond source values.
  const thenByCondShared = new Map<string, JointEntry<T>[]>()
  for (const te of thenD.joint) {
    const key = thenSharedWithCond.map((i) => te.sourceVals[i]).join('|')
    const arr = thenByCondShared.get(key)
    if (arr) arr.push(te)
    else thenByCondShared.set(key, [te])
  }

  // For else: shared sources with cond and with then.
  const elseSharedWithCond: number[] = []
  const condSharedWithElse: number[] = []
  for (let i = 0; i < cond.sourceIds.length; i++) {
    const j = elseD.sourceIds.indexOf(cond.sourceIds[i])
    if (j >= 0) {
      condSharedWithElse.push(i)
      elseSharedWithCond.push(j)
    }
  }
  const elseSharedWithThen: number[] = []
  const thenSharedWithElse: number[] = []
  for (let i = 0; i < thenD.sourceIds.length; i++) {
    const j = elseD.sourceIds.indexOf(thenD.sourceIds[i])
    if (j >= 0) {
      thenSharedWithElse.push(i)
      elseSharedWithThen.push(j)
    }
  }

  // Index elseD by combined (shared-with-cond, shared-with-then) keys.
  const elseSharedAll: number[] = []
  for (const j of elseSharedWithCond) elseSharedAll.push(j)
  for (const j of elseSharedWithThen) {
    if (!elseSharedAll.includes(j)) elseSharedAll.push(j)
  }
  const elseByShared = new Map<string, JointEntry<T>[]>()
  for (const ee of elseD.joint) {
    const key = elseSharedAll.map((i) => ee.sourceVals[i]).join('|')
    const arr = elseByShared.get(key)
    if (arr) arr.push(ee)
    else elseByShared.set(key, [ee])
  }

  // Marginal of thenD over its shared-with-cond sources (for chain-rule prob).
  const thenSharedCondMarginal = sharedMarginalCache(thenD, thenSharedWithCond)
  const elseSharedAllMarginal = sharedMarginalCache(elseD, elseSharedAll)

  for (const ce of cond.joint) {
    const condKey = condSharedWithThen.map((i) => ce.sourceVals[i]).join('|')
    const thenCandidates = thenByCondShared.get(condKey) ?? []

    // If condition is true, we need thenD to materialize. If false, elseD.
    // But we still need to integrate over the other side too — no, the other
    // side's randomness is irrelevant because its outcome isn't used. We can
    // skip enumerating it but must still account for source mass correctly.
    //
    // For simplicity (and to keep correlations in further combinations) we
    // pick the appropriate branch and ignore the other's source values when
    // they're not also shared with cond/picked-branch. Since we only need the
    // marginal output distribution, we don't have to track source vals beyond
    // those that determine the value.
    //
    // To stay general, we enumerate the picked branch only:

    if (ce.value === true) {
      for (const te of thenCandidates) {
        // Joint prob of (cond outcome, then outcome) given they agree on
        // shared sources. Using chain rule:
        // P(cond_vals, then_vals) = P(cond_vals) * P(then_unique | shared)
        //                         = ce.prob * te.prob / P(shared from then)
        let jointProb: number
        if (condSharedWithThen.length === 0) {
          jointProb = ce.prob * te.prob
        } else {
          const tShared = thenSharedCondMarginal.get(condKey) ?? 0
          if (tShared === 0) continue
          jointProb = (ce.prob * te.prob) / tShared
        }
        joint.push({
          sourceVals: [],
          value: te.value,
          prob: jointProb,
        })
        marginal.set(te.value, (marginal.get(te.value) ?? 0) + jointProb)
        if (joint.length > MAX_JOINT_SIZE) return null
      }
    } else {
      // ce.value === false → use elseD
      // Build key for elseD by combining cond's shared part. (Then's shared
      // part with else doesn't need agreement since we're not using then's
      // outcome — we marginalize over then implicitly.)
      const elseKey = elseSharedAll
        .map((i) => {
          // i is an index into elseD.sourceIds. Find which source it refers
          // to and look up its value from cond if shared.
          const srcId = elseD.sourceIds[i]
          const cIdx = cond.sourceIds.indexOf(srcId)
          if (cIdx >= 0) return ce.sourceVals[cIdx]
          // Source comes from thenD only — we don't constrain.
          return undefined
        })
        .map((v) => (v === undefined ? '*' : v))
        .join('|')
      // If any element is '*' we need to enumerate over those too. To keep
      // things tractable, conservatively bail out when elseD shares sources
      // with thenD that aren't shared with cond.
      const sharedWithThenOnly = elseSharedWithThen.filter(
        (j) => cond.sourceIds.indexOf(elseD.sourceIds[j]) < 0,
      )
      if (sharedWithThenOnly.length > 0) {
        return null
      }
      const elseCandidates = elseByShared.get(elseKey) ?? []
      for (const ee of elseCandidates) {
        let jointProb: number
        if (elseSharedAll.length === 0) {
          jointProb = ce.prob * ee.prob
        } else {
          const eShared = elseSharedAllMarginal.get(elseKey) ?? 0
          if (eShared === 0) continue
          jointProb = (ce.prob * ee.prob) / eShared
        }
        joint.push({
          sourceVals: [],
          value: ee.value,
          prob: jointProb,
        })
        marginal.set(ee.value, (marginal.get(ee.value) ?? 0) + jointProb)
        if (joint.length > MAX_JOINT_SIZE) return null
      }
    }
  }

  // Note: the resulting SymDist's joint loses precise per-source tracking
  // (we set sourceVals: [] for output entries). Return a SymDist with empty
  // sourceIds so subsequent combinations treat it as a pure marginal. For
  // top-level analysis (the typical use of cond), only the marginal matters.
  return { dist: marginal, sourceIds: [], joint }
}

// ---------------------------------------------------------------------------
// Use-count tracking (variables)
// ---------------------------------------------------------------------------

function countVariableUses(program: Program): Map<string, number> {
  const counts = new Map<string, number>()
  const declared = new Set<string>()
  const inc = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)

  function visitExpr(expr: Expression): void {
    switch (expr.type) {
      case 'number-literal':
      case 'boolean-literal':
      case 'string-literal':
        return
      case 'variable-ref':
        if (declared.has(expr.name)) inc(expr.name)
        return
      case 'dice-expr':
        // dice-variable-refs inside backticks — count them too.
        countDiceVarRefs(expr.expr, (name) => {
          if (declared.has(name)) inc(name)
        })
        return
      case 'unary-expr':
        visitExpr(expr.expr)
        return
      case 'binary-expr':
        visitExpr(expr.left)
        visitExpr(expr.right)
        return
      case 'if-expr':
        visitExpr(expr.condition)
        visitExpr(expr.then)
        visitExpr(expr.else)
        return
      case 'record-expr':
        for (const f of expr.fields) visitExpr(f.value)
        return
      case 'array-expr':
        for (const e of expr.elements) visitExpr(e)
        return
      case 'repeat-expr':
        visitExpr(expr.count)
        for (const stmt of expr.body) visitStmt(stmt)
        return
      case 'field-access':
        visitExpr(expr.object)
        return
      case 'index-access':
        visitExpr(expr.object)
        visitExpr(expr.index)
        return
    }
  }

  function visitStmt(stmt: Statement): void {
    if (stmt.type === 'assignment') {
      visitExpr(stmt.value)
      declared.add(stmt.name)
    } else {
      visitExpr(stmt.expr)
    }
  }

  for (const stmt of program.statements) visitStmt(stmt)
  return counts
}

function countDiceVarRefs(
  expr: DiceExpression,
  onName: (name: string) => void,
): void {
  switch (expr.type) {
    case 'die':
    case 'custom-die':
    case 'literal':
      return
    case 'dice-variable-ref':
      onName(expr.name)
      return
    case 'binary-op':
      countDiceVarRefs(expr.left, onName)
      countDiceVarRefs(expr.right, onName)
      return
    case 'unary-op':
      countDiceVarRefs(expr.expr, onName)
      return
    case 'dice-reduce': {
      const r = expr.reduceable
      switch (r.type) {
        case 'dice-expressions':
          for (const e of r.exprs) countDiceVarRefs(e, onName)
          return
        case 'dice-list-with-filter':
          if (r.list.type !== 'filterable-dice-array') {
            for (const e of r.list.exprs) countDiceVarRefs(e, onName)
          }
          return
        case 'dice-list-with-map':
          return
      }
    }
  }
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
  // SymDist when the value is a primitive (number/boolean/string) and exact
  // analysis succeeded structurally. May still return null at evaluation.
  symDist: (() => SymDist<SymValue> | null) | null
}

interface AnalysisEnv {
  // Map of variable name -> analysis of its bound expression. Used to look up
  // randomVarsUsed transitively and to detect aliases of exact compositions.
  bindings: Map<string, ExprAnalysis>
  // Cached SymDist for each variable so multiple references return the same
  // SymDist (preserving correlations through shared source IDs). Only set for
  // variables whose binding produced a SymDist.
  symBindings: Map<string, SymDist<SymValue> | null>
  // Use counts across the whole program (computed once).
  useCounts: Map<string, number>
  // Counter for fresh source IDs.
  nextSourceId: { value: number }
}

function makeAnalysisEnv(useCounts: Map<string, number>): AnalysisEnv {
  return {
    bindings: new Map(),
    symBindings: new Map(),
    useCounts,
    nextSourceId: { value: 0 },
  }
}

function freshSourceId(env: AnalysisEnv): string {
  return 'r' + env.nextSourceId.value++
}

function classifyProgram(program: Program): Tier {
  const analysis = analyzeProgram(program)
  if (!analysis.random) return 'constant'
  if (analysis.exactDist !== null) {
    return 'exact'
  }
  return 'monte-carlo'
}

function analyzeProgram(program: Program): ExprAnalysis {
  const useCounts = countVariableUses(program)
  const env = makeAnalysisEnv(useCounts)
  let last: ExprAnalysis = nonRandomAnalysis()

  for (const stmt of program.statements) {
    if (stmt.type === 'assignment') {
      const a = analyzeExpr(stmt.value, env)
      env.bindings.set(stmt.name, a)
      // Materialize the SymDist for this variable now (single source of truth
      // shared across all references).
      if (a.symDist !== null) {
        env.symBindings.set(stmt.name, a.symDist())
      } else {
        env.symBindings.set(stmt.name, null)
      }
      last = a
    } else {
      last = analyzeExpr(stmt.expr, env)
    }
  }

  return last
}

function nonRandomAnalysis(): ExprAnalysis {
  return {
    random: false,
    randomVarsUsed: new Set(),
    exactDist: null,
    symDist: null,
  }
}

function symDistToFieldStats(sd: SymDist<SymValue>): FieldStats | null {
  // Detect uniform value type from the marginal.
  let kind: 'number' | 'boolean' | 'string' | null = null
  for (const v of sd.dist.keys()) {
    const t =
      typeof v === 'number'
        ? 'number'
        : typeof v === 'boolean'
          ? 'boolean'
          : 'string'
    if (kind === null) kind = t
    else if (kind !== t) return { type: 'mixed' }
  }
  if (kind === null) return { type: 'mixed' }
  if (kind === 'number') {
    const dist = sd.dist as Map<number, number>
    return numberStatsFromDistribution(dist)
  }
  if (kind === 'boolean') {
    let truePercent = 0
    for (const [v, p] of sd.dist) {
      if (v === true) truePercent += p
    }
    return { type: 'boolean', truePercent }
  }
  // string
  const frequencies = new Map<string, number>()
  for (const [v, p] of sd.dist) frequencies.set(v as string, p)
  return { type: 'string', frequencies }
}

function symDistAnalysis(
  thunk: () => SymDist<SymValue> | null,
  random: boolean,
  randomVarsUsed: Set<string>,
): ExprAnalysis {
  const exactDist: () => FieldStats | null = () => {
    const sd = thunk()
    if (sd === null) return null
    return symDistToFieldStats(sd)
  }
  return {
    random,
    randomVarsUsed,
    exactDist,
    symDist: thunk,
  }
}

function analyzeExpr(expr: Expression, env: AnalysisEnv): ExprAnalysis {
  switch (expr.type) {
    case 'number-literal': {
      const value = expr.value
      return symDistAnalysis(
        () => constSymDist<number>(value),
        false,
        new Set(),
      )
    }
    case 'boolean-literal': {
      const value = expr.value
      return symDistAnalysis(
        () => constSymDist<boolean>(value),
        false,
        new Set(),
      )
    }
    case 'string-literal': {
      const value = expr.value
      return symDistAnalysis(
        () => constSymDist<string>(value),
        false,
        new Set(),
      )
    }

    case 'variable-ref': {
      const bound = env.bindings.get(expr.name)
      if (!bound) return nonRandomAnalysis()
      const randomVarsUsed = new Set<string>()
      if (bound.random) randomVarsUsed.add(expr.name)
      // Resolve the variable's SymDist (shared across references).
      const name = expr.name
      const symDist: () => SymDist<SymValue> | null = () => {
        const sd = env.symBindings.get(name)
        return sd ?? null
      }
      // Preserve exact composition through field/index access on records/arrays
      // bound directly to records.
      const exactDistFromSym: () => FieldStats | null = () => {
        const sd = symDist()
        if (sd === null) return null
        return symDistToFieldStats(sd)
      }
      // Fall back to bound.exactDist (record/array containers) if SymDist is
      // not available.
      const exactDist: (() => FieldStats | null) | null =
        env.symBindings.get(name) !== undefined &&
        env.symBindings.get(name) !== null
          ? exactDistFromSym
          : bound.exactDist
      return {
        random: bound.random,
        randomVarsUsed,
        exactDist,
        symDist:
          env.symBindings.get(name) !== undefined &&
          env.symBindings.get(name) !== null
            ? symDist
            : null,
      }
    }

    case 'dice-expr': {
      const hasVarRef = diceExpressionHasVarRef(expr.expr)
      const exprCopy = expr.expr
      if (hasVarRef) {
        return {
          random: true,
          randomVarsUsed: new Set(),
          exactDist: null,
          symDist: null,
        }
      }
      const sourceId = freshSourceId(env)
      // Cache the computed SymDist so repeated thunk calls don't re-roll the
      // source id.
      let cached: SymDist<SymValue> | null | undefined = undefined
      const sym: () => SymDist<SymValue> | null = () => {
        if (cached !== undefined) return cached
        try {
          const dist = DiceStats.distribution(exprCopy)
          cached = fromDiceDistribution(sourceId, dist)
        } catch {
          cached = null
        }
        return cached
      }
      return {
        random: true,
        randomVarsUsed: new Set(),
        exactDist: () => {
          const sd = sym()
          if (sd === null) return null
          return symDistToFieldStats(sd)
        },
        symDist: sym,
      }
    }

    case 'unary-expr': {
      const inner = analyzeExpr(expr.expr, env)
      const op = expr.op
      let symDist: (() => SymDist<SymValue> | null) | null = null
      if (inner.symDist !== null) {
        symDist = () => {
          const sd = inner.symDist!()
          if (sd === null) return null
          if (op === 'negate') {
            // expects number values
            for (const v of sd.dist.keys()) {
              if (typeof v !== 'number') return null
            }
            return mapSymDist<number, number>(
              sd as SymDist<number>,
              (v) => -v,
            ) as SymDist<SymValue>
          } else {
            // 'not' — boolean
            for (const v of sd.dist.keys()) {
              if (typeof v !== 'boolean') return null
            }
            return mapSymDist<boolean, boolean>(
              sd as SymDist<boolean>,
              (v) => !v,
            ) as SymDist<SymValue>
          }
        }
      }
      return {
        random: inner.random,
        randomVarsUsed: new Set(inner.randomVarsUsed),
        exactDist:
          symDist !== null
            ? () => {
                const sd = symDist!()
                if (sd === null) return null
                return symDistToFieldStats(sd)
              }
            : null,
        symDist,
      }
    }

    case 'binary-expr': {
      const left = analyzeExpr(expr.left, env)
      const right = analyzeExpr(expr.right, env)
      const op = expr.op
      let symDist: (() => SymDist<SymValue> | null) | null = null
      if (left.symDist !== null && right.symDist !== null) {
        symDist = () => {
          const a = left.symDist!()
          const b = right.symDist!()
          if (a === null || b === null) return null
          return applyBinaryToSymDist(op, a, b)
        }
      }
      return {
        random: left.random || right.random,
        randomVarsUsed: unionSets(left.randomVarsUsed, right.randomVarsUsed),
        exactDist:
          symDist !== null
            ? () => {
                const sd = symDist!()
                if (sd === null) return null
                return symDistToFieldStats(sd)
              }
            : null,
        symDist,
      }
    }

    case 'if-expr': {
      const cond = analyzeExpr(expr.condition, env)
      const thenA = analyzeExpr(expr.then, env)
      const elseA = analyzeExpr(expr.else, env)
      let symDist: (() => SymDist<SymValue> | null) | null = null
      if (
        cond.symDist !== null &&
        thenA.symDist !== null &&
        elseA.symDist !== null
      ) {
        symDist = () => {
          const c = cond.symDist!()
          const t = thenA.symDist!()
          const e = elseA.symDist!()
          if (c === null || t === null || e === null) return null
          for (const v of c.dist.keys()) {
            if (typeof v !== 'boolean') return null
          }
          return condSymDist(c as SymDist<boolean>, t, e)
        }
      }
      return {
        random: cond.random || thenA.random || elseA.random,
        randomVarsUsed: unionSets(
          cond.randomVarsUsed,
          unionSets(thenA.randomVarsUsed, elseA.randomVarsUsed),
        ),
        exactDist:
          symDist !== null
            ? () => {
                const sd = symDist!()
                if (sd === null) return null
                return symDistToFieldStats(sd)
              }
            : null,
        symDist,
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

      // Each field may have its own SymDist; we marginalize each independently
      // for the FieldStats output. Correlation across fields is not surfaced
      // in FieldStats anyway. Each field must have an exactDist (via SymDist
      // or via container exactDist).
      let exactDist: (() => FieldStats | null) | null = null
      if (random && fieldAnalyses.every((f) => f.analysis.exactDist !== null)) {
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

      return { random, randomVarsUsed, exactDist, symDist: null }
    }

    case 'array-expr': {
      const elementAnalyses = expr.elements.map((el) => analyzeExpr(el, env))
      const random = elementAnalyses.some((a) => a.random)
      const randomVarsUsed = elementAnalyses.reduce(
        (acc, a) => unionSets(acc, a.randomVarsUsed),
        new Set<string>(),
      )

      let exactDist: (() => FieldStats | null) | null = null
      if (random && elementAnalyses.every((a) => a.exactDist !== null)) {
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

      return { random, randomVarsUsed, exactDist, symDist: null }
    }

    case 'repeat-expr': {
      const countA = analyzeExpr(expr.count, env)
      const outerVars = new Set(env.bindings.keys())
      const childEnv: AnalysisEnv = {
        bindings: new Map(env.bindings),
        symBindings: new Map(env.symBindings),
        useCounts: env.useCounts,
        nextSourceId: env.nextSourceId,
      }
      let bodyLast: ExprAnalysis = nonRandomAnalysis()
      for (const stmt of expr.body) {
        if (stmt.type === 'assignment') {
          const a = analyzeExpr(stmt.value, childEnv)
          childEnv.bindings.set(stmt.name, a)
          if (a.symDist !== null) {
            childEnv.symBindings.set(stmt.name, a.symDist())
          } else {
            childEnv.symBindings.set(stmt.name, null)
          }
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
          const single = bodyLast.exactDist!()
          if (single === null) return null
          const elements: FieldStats[] = []
          for (let i = 0; i < constCount; i++) {
            elements.push(cloneFieldStats(single))
          }
          return { type: 'array', elements }
        }
      }

      return { random, randomVarsUsed, exactDist, symDist: null }
    }

    case 'field-access': {
      const obj = analyzeExpr(expr.object, env)
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
            symDist: null,
          }
        }
      }
      return {
        random: obj.random,
        randomVarsUsed: new Set(obj.randomVarsUsed),
        exactDist: null,
        symDist: null,
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
            symDist: null,
          }
        }
      }
      return {
        random: obj.random || idx.random,
        randomVarsUsed: unionSets(obj.randomVarsUsed, idx.randomVarsUsed),
        exactDist: null,
        symDist: null,
      }
    }
  }
}

function applyBinaryToSymDist(
  op: BinaryOper,
  a: SymDist<SymValue>,
  b: SymDist<SymValue>,
): SymDist<SymValue> | null {
  // Determine if we can support this op for these value types.
  switch (op) {
    case 'add': {
      // String concat if either side is string; otherwise numeric add.
      const aHasStr = anyOfType(a.dist, 'string')
      const bHasStr = anyOfType(b.dist, 'string')
      if (aHasStr || bHasStr) {
        return combineSymDist(a, b, (av, bv) => String(av) + String(bv))
      }
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) + toNum(bv))
      }
      return null
    }
    case 'subtract':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) - toNum(bv))
      }
      return null
    case 'multiply':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) * toNum(bv))
      }
      return null
    case 'divide':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        // Avoid runtime errors (division by zero); skip exact when possible.
        for (const v of b.dist.keys()) {
          if (toNum(v) === 0) return null
        }
        return combineSymDist(a, b, (av, bv) =>
          Math.trunc(toNum(av) / toNum(bv)),
        )
      }
      return null
    case 'eq':
      return combineSymDist<SymValue, SymValue, boolean>(a, b, (av, bv) =>
        valueEq(av, bv),
      )
    case 'neq':
      return combineSymDist<SymValue, SymValue, boolean>(
        a,
        b,
        (av, bv) => !valueEq(av, bv),
      )
    case 'gt':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) > toNum(bv))
      }
      return null
    case 'lt':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) < toNum(bv))
      }
      return null
    case 'gte':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) >= toNum(bv))
      }
      return null
    case 'lte':
      if (allNumericLike(a.dist) && allNumericLike(b.dist)) {
        return combineSymDist(a, b, (av, bv) => toNum(av) <= toNum(bv))
      }
      return null
    case 'and':
      return combineSymDist<SymValue, SymValue, boolean>(
        a,
        b,
        (av, bv) => truthy(av) && truthy(bv),
      )
    case 'or':
      return combineSymDist<SymValue, SymValue, boolean>(
        a,
        b,
        (av, bv) => truthy(av) || truthy(bv),
      )
  }
}

function valueEq(a: SymValue, b: SymValue): boolean {
  return a === b
}

function truthy(v: SymValue): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return v.length > 0
}

function toNum(v: SymValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return NaN
}

function anyOfType(
  dist: Map<SymValue, number>,
  type: 'number' | 'boolean' | 'string',
): boolean {
  for (const v of dist.keys()) {
    if (typeof v === type) return true
  }
  return false
}

function allNumericLike(dist: Map<SymValue, number>): boolean {
  for (const v of dist.keys()) {
    if (typeof v !== 'number' && typeof v !== 'boolean') return false
  }
  return true
}

// Returns the constant integer value of an expression, or null if the
// expression is not a constant integer literal.
function constantIntegerValue(expr: Expression): number | null {
  if (expr.type === 'number-literal' && Number.isInteger(expr.value)) {
    return expr.value
  }
  return null
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

  while (total < minTrials) {
    const target = Math.min(total + batchSize, minTrials)
    while (total < target) {
      results.push(evaluator.run(program))
      total++
    }
  }

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
    if (typeOf(v) !== t) return true
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

  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)

  if (counts.size <= 2 && n < config.minTrials) return false

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
