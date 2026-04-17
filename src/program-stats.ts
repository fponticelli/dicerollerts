import type { DiceExpression } from './dice-expression'
import type {
  Program,
  Statement,
  Expression,
  Value,
  BinaryOper,
  ParameterSpec,
  RecordExpr,
  IfExpr,
} from './program'
import { Evaluator } from './evaluator'
import { DiceStats } from './dice-stats'

// Minimal ambient type for AbortSignal (not in ESNext lib without DOM).
type AbortSignal = { readonly aborted: boolean }

// Use performance.now() when available (browser/Node >=16), else Date.now().
const perfNow: () => number = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (globalThis as any).performance
    if (p && typeof p.now === 'function') return () => p.now() as number
  } catch {
    // ignore
  }
  return () => Date.now()
})()

export interface Percentiles {
  p5: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
}

export interface NumberAggregateStats {
  mean: number
  stddev: number
  min: number
  max: number
  distribution: Map<number, number>
  cdf: Map<number, number>
  percentiles: Percentiles
  count: number
}

export type FieldStats =
  | {
      type: 'number'
      mean: number
      stddev: number
      variance: number
      mode: number[]
      min: number
      max: number
      distribution: Map<number, number>
      cdf: Map<number, number>
      percentiles: Percentiles
      skewness: number
      kurtosis: number
      standardError?: number
    }
  | { type: 'boolean'; truePercent: number; standardError?: number }
  | {
      type: 'string'
      frequencies: Map<string, number>
      standardErrors?: Map<string, number>
    }
  | {
      type: 'array'
      elements: FieldStats[]
      aggregate?: NumberAggregateStats
    }
  | { type: 'record'; fields: Record<string, FieldStats> }
  | {
      type: 'discriminated'
      discriminator: 'kind' | 'shape'
      variants: DiscriminatedVariant[]
    }
  | { type: 'mixed' }

export interface DiscriminatedVariant {
  // The kind value for `discriminator: 'kind'`, or a synthetic `shape:a,b,c`
  // tag for `discriminator: 'shape'`.
  tag: string
  // Share of trials matching this variant.
  probability: number
  // Standard error of the probability (Monte Carlo only).
  standardError?: number
  // Field names present in this variant (excluding the discriminator field
  // when `discriminator: 'kind'`).
  keys: string[]
  // Marginal stats per field, computed only over this variant's trials.
  fields: Record<string, FieldStats>
}

export type Tier = 'constant' | 'exact' | 'monte-carlo'

export interface AnalysisStrategy {
  tier: Tier
  trials?: number
  converged?: boolean
}

export interface AnalyzeDiagnostics {
  classifyTimeMs: number
  analyzeTimeMs: number
  jointSizeMax?: number
  fellBackToMC: boolean
}

export interface AnalyzeResult {
  stats: FieldStats
  strategy: AnalysisStrategy
  diagnostics: AnalyzeDiagnostics
}

export interface AnalyzeOptions {
  // Legacy fixed-trial option (still respected as a maxTrials cap when given)
  trials?: number
  maxTrials?: number
  minTrials?: number
  batchSize?: number
  targetRelativeError?: number
  targetBinStderr?: number
  // Optional cancellation. The Monte Carlo loop checks `signal.aborted`
  // between batches; if set, it throws `DOMException('Aborted', 'AbortError')`.
  signal?: AbortSignal
  // Parameter overrides — when provided, parameters are bound to the given
  // values for the entire analysis (treated as constants).
  parameters?: Record<string, Value>
}

export interface AnalyzeAsyncOptions extends AnalyzeOptions {
  // Emit progress every N trials. Defaults to `batchSize`.
  yieldEvery?: number
}

export interface AsyncProgress {
  // Current snapshot of the stats computed from trials so far. For the
  // `constant` and `exact` tiers this is the final stats.
  stats: FieldStats
  // Number of Monte Carlo trials completed so far. 0 for non-MC tiers.
  trials: number
  // Whether the convergence threshold has been met. Always true for the
  // `constant` and `exact` tiers.
  converged: boolean
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
  classify(
    program: Program,
    options?: { parameters?: Record<string, Value> },
  ): Tier {
    return classifyProgram(program, options?.parameters)
  },

  analyze(program: Program, options?: AnalyzeOptions): AnalyzeResult {
    validateProgramParameters(program, options?.parameters)
    const t0 = perfNow()
    const analysis = analyzeProgram(program, options?.parameters)
    const classifyTimeMs = perfNow() - t0

    if (!analysis.random) {
      const t1 = perfNow()
      const evaluator = makeEvaluator()
      const value = evaluator.run(program, { parameters: options?.parameters })
      const analyzeTimeMs = perfNow() - t1
      return {
        stats: constantStats(value),
        strategy: { tier: 'constant' },
        diagnostics: { classifyTimeMs, analyzeTimeMs, fellBackToMC: false },
      }
    }

    if (analysis.exactDist !== null) {
      const t1 = perfNow()
      const stats = analysis.exactDist()
      const analyzeTimeMs = perfNow() - t1
      if (stats !== null) {
        return {
          stats,
          strategy: { tier: 'exact' },
          diagnostics: { classifyTimeMs, analyzeTimeMs, fellBackToMC: false },
        }
      }
      // Exact was attempted but failed — fall back to MC
      const mcResult = runMonteCarlo(program, options)
      return {
        ...mcResult,
        diagnostics: {
          classifyTimeMs,
          analyzeTimeMs: mcResult.diagnostics.analyzeTimeMs,
          fellBackToMC: true,
        },
      }
    }

    const mcResult = runMonteCarlo(program, options)
    return {
      ...mcResult,
      diagnostics: {
        classifyTimeMs,
        analyzeTimeMs: mcResult.diagnostics.analyzeTimeMs,
        fellBackToMC: false,
      },
    }
  },

  async *analyzeAsync(
    program: Program,
    options?: AnalyzeAsyncOptions,
  ): AsyncGenerator<AsyncProgress> {
    throwIfAborted(options?.signal)
    validateProgramParameters(program, options?.parameters)
    const analysis = analyzeProgram(program, options?.parameters)

    if (!analysis.random) {
      const evaluator = makeEvaluator()
      const value = evaluator.run(program, { parameters: options?.parameters })
      yield {
        stats: constantStats(value),
        trials: 0,
        converged: true,
      }
      return
    }

    if (analysis.exactDist !== null) {
      const stats = analysis.exactDist()
      if (stats !== null) {
        yield { stats, trials: 0, converged: true }
        return
      }
      // Exact failed — fall through to streaming MC.
    }

    yield* runMonteCarloAsync(program, options)
  },
}

function validateProgramParameters(
  program: Program,
  parameters: Record<string, Value> | undefined,
): void {
  if (!parameters) return
  const declared = new Set<string>()
  for (const stmt of program.statements) {
    if (stmt.type === 'parameter-declaration') declared.add(stmt.name)
  }
  for (const name of Object.keys(parameters)) {
    if (!declared.has(name)) {
      throw new Error(`Unknown parameter: $${name}`)
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw makeAbortError()
  }
}

function makeAbortError(): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DE = (globalThis as any).DOMException
  if (typeof DE !== 'undefined') {
    return new DE('Aborted', 'AbortError') as Error
  }
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
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

// Restrict d's joint to outcomes where `predicate` evaluates to true, then
// renormalize. The resulting SymDist preserves d's source-id tracking so it
// can still participate in further combinations.
//
// Returns null if:
//   - the combined joint exceeds MAX_JOINT_SIZE
//   - no entries satisfy the predicate (P(condition) = 0)
//
// Sources may be shared between d and predicate; the routine joins on shared
// source values and uses the chain rule (just like combineSymDist) to assign
// joint probability.
function conditionalizeSymDist<T extends SymValue>(
  d: SymDist<T>,
  predicate: SymDist<boolean>,
): SymDist<T> | null {
  // Fast path: disjoint sources -> filtering is just on predicate's joint.
  // d itself doesn't change shape; the marginal of d remains correct since
  // d is independent of predicate (when sources are disjoint), but the
  // total mass of the conditioned distribution is P(predicate=true). We can
  // simply return d if P(true) > 0 because conditioning an independent
  // distribution on an event leaves its distribution unchanged.
  let sharesAny = false
  for (const s of d.sourceIds) {
    if (predicate.sourceIds.indexOf(s) >= 0) {
      sharesAny = true
      break
    }
  }
  if (!sharesAny) {
    let pTrue = 0
    for (const [v, p] of predicate.dist) if (v) pTrue += p
    if (pTrue === 0) return null
    // Independent: distribution unchanged.
    return {
      dist: new Map(d.dist),
      sourceIds: d.sourceIds.slice(),
      joint: d.joint.map((e) => ({
        sourceVals: e.sourceVals.slice(),
        value: e.value,
        prob: e.prob,
      })),
    }
  }

  // Compute merged source ordering (d's sources first, then predicate's
  // unique sources).
  const mergedSources: string[] = d.sourceIds.slice()
  const sourceIndex = new Map<string, number>()
  d.sourceIds.forEach((s, i) => sourceIndex.set(s, i))
  for (const s of predicate.sourceIds) {
    if (!sourceIndex.has(s)) {
      sourceIndex.set(s, mergedSources.length)
      mergedSources.push(s)
    }
  }

  const sharedDIdx: number[] = []
  const sharedPIdx: number[] = []
  for (let i = 0; i < d.sourceIds.length; i++) {
    const j = predicate.sourceIds.indexOf(d.sourceIds[i])
    if (j >= 0) {
      sharedDIdx.push(i)
      sharedPIdx.push(j)
    }
  }

  // Index predicate entries by shared source values.
  const pByShared = new Map<string, JointEntry<boolean>[]>()
  for (const pe of predicate.joint) {
    const key = sharedPIdx.map((i) => pe.sourceVals[i]).join('|')
    const arr = pByShared.get(key)
    if (arr) arr.push(pe)
    else pByShared.set(key, [pe])
  }

  // Marginal mass of shared values in predicate (chain rule denominator).
  const pSharedMarginal = sharedMarginalCache(predicate, sharedPIdx)

  const newJoint: JointEntry<T>[] = []
  const newMarginal = new Map<T, number>()

  for (const de of d.joint) {
    const key = sharedDIdx.map((i) => de.sourceVals[i]).join('|')
    const candidates = pByShared.get(key) ?? []
    const pShared = pSharedMarginal.get(key) ?? 0
    if (pShared === 0) continue
    for (const pe of candidates) {
      if (pe.value !== true) continue
      // Joint prob (d outcome AND predicate outcome) given they agree on
      // shared sources: de.prob * pe.prob / p(shared).
      const jointProb = (de.prob * pe.prob) / pShared
      // sourceVals layout: keep d's positions; predicate-only sources are
      // appended. We don't need to record predicate-only source values since
      // we're collapsing to d's value space; preserving d's positions is
      // sufficient for further conditioning/combinations on d's sources.
      // But to keep mergedSources consistent we extend with whatever the
      // predicate contributed (or fill in undefined-as-NaN).
      let sourceVals: number[]
      if (mergedSources.length === d.sourceIds.length) {
        sourceVals = de.sourceVals.slice()
      } else {
        sourceVals = new Array(mergedSources.length)
        for (let i = 0; i < d.sourceIds.length; i++) {
          sourceVals[i] = de.sourceVals[i]
        }
        for (let i = 0; i < predicate.sourceIds.length; i++) {
          const mIdx = sourceIndex.get(predicate.sourceIds[i])!
          if (mIdx >= d.sourceIds.length) {
            sourceVals[mIdx] = pe.sourceVals[i]
          }
        }
      }
      newJoint.push({ sourceVals, value: de.value, prob: jointProb })
      newMarginal.set(de.value, (newMarginal.get(de.value) ?? 0) + jointProb)
      if (newJoint.length > MAX_JOINT_SIZE) return null
    }
  }

  if (newJoint.length === 0) return null

  // Renormalize so probabilities sum to 1 (we conditioned on the event).
  let total = 0
  for (const e of newJoint) total += e.prob
  if (total === 0) return null
  for (const e of newJoint) e.prob /= total
  for (const k of [...newMarginal.keys()]) {
    newMarginal.set(k, newMarginal.get(k)! / total)
  }

  return { dist: newMarginal, sourceIds: mergedSources, joint: newJoint }
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
    } else if (stmt.type === 'parameter-declaration') {
      // Dice expression defaults can reference variables, but per spec
      // defaults are constants only and don't depend on other variables.
      // We still walk the dice expression to count any var refs (would be
      // a runtime error, but we keep the analysis simple).
      if (stmt.spec.default.kind === 'dice') {
        countDiceVarRefs(stmt.spec.default.expr, (name) => {
          if (declared.has(name)) inc(name)
        })
      }
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

function classifyProgram(
  program: Program,
  parameters?: Record<string, Value>,
): Tier {
  const analysis = analyzeProgram(program, parameters)
  if (!analysis.random) return 'constant'
  if (analysis.exactDist !== null) return 'exact'
  return 'monte-carlo'
}

interface RecordShape {
  keys: string // sorted comma-joined key list
  kind: string | null // literal value of `kind` field, if it's a string literal
}

function analyzeProgram(
  program: Program,
  parameters?: Record<string, Value>,
): ExprAnalysis {
  const useCounts = countVariableUses(program)
  const env = makeAnalysisEnv(useCounts)
  const overrides = parameters ?? {}
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
    } else if (stmt.type === 'parameter-declaration') {
      const a = analyzeParameterDeclaration(
        stmt.name,
        stmt.spec,
        overrides,
        env,
      )
      env.bindings.set(stmt.name, a)
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

function analyzeParameterDeclaration(
  name: string,
  spec: ParameterSpec,
  overrides: Record<string, Value>,
  env: AnalysisEnv,
): ExprAnalysis {
  // If overridden, treat as constant.
  if (Object.prototype.hasOwnProperty.call(overrides, name)) {
    return constantValueAnalysis(overrides[name])
  }
  // Literal default → constant.
  if (spec.default.kind === 'value') {
    return constantValueAnalysis(spec.default.value)
  }
  // Dice expression default → analyze like a fresh dice-expr.
  const exprCopy = spec.default.expr
  const sourceId = freshSourceId(env)
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

function constantValueAnalysis(value: Value): ExprAnalysis {
  if (typeof value === 'number') {
    return symDistAnalysis(() => constSymDist<number>(value), false, new Set())
  }
  if (typeof value === 'boolean') {
    return symDistAnalysis(() => constSymDist<boolean>(value), false, new Set())
  }
  if (typeof value === 'string') {
    return symDistAnalysis(() => constSymDist<string>(value), false, new Set())
  }
  // Arrays and records as parameter values aren't currently produced by the
  // parser, but treat them as opaque non-random values.
  return {
    random: false,
    randomVarsUsed: new Set(),
    exactDist: () => constantStats(value),
    symDist: null,
  }
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
  const rawFreq = new Map<string, number>()
  for (const [v, p] of sd.dist) rawFreq.set(v as string, p)
  const frequencies = sortFrequenciesDesc(normalizeMap(rawFreq))
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

      // Multi-shape discriminated path: when both branches produce records
      // (possibly nested through further if-exprs) and their shapes differ,
      // build a discriminated FieldStats by conditioning each variant's
      // fields on the path that selects it.
      const discriminatedExact = tryDiscriminatedIfExact(expr, env)
      const exactDist: (() => FieldStats | null) | null =
        discriminatedExact !== null
          ? () => {
              const stats = discriminatedExact()
              if (stats !== null) return stats
              // Discriminated analysis failed (e.g., joint too big or a
              // field's SymDist couldn't be conditioned). Try the symbolic
              // marginal as fallback if possible.
              if (symDist !== null) {
                const sd = symDist()
                if (sd === null) return null
                return symDistToFieldStats(sd)
              }
              return null
            }
          : symDist !== null
            ? () => {
                const sd = symDist!()
                if (sd === null) return null
                return symDistToFieldStats(sd)
              }
            : null

      return {
        random: cond.random || thenA.random || elseA.random,
        randomVarsUsed: unionSets(
          cond.randomVarsUsed,
          unionSets(thenA.randomVarsUsed, elseA.randomVarsUsed),
        ),
        exactDist,
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
          const aggregate = computeAggregateIfNumeric(elements)
          if (aggregate !== null) {
            return { type: 'array', elements, aggregate }
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
        } else if (stmt.type === 'parameter-declaration') {
          // Parameter declarations inside repeat bodies have no overrides
          // accessible; analyze their defaults.
          const a = analyzeParameterDeclaration(
            stmt.name,
            stmt.spec,
            {},
            childEnv,
          )
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
          const aggregate = computeAggregateIfNumeric(elements)
          if (aggregate !== null) {
            return { type: 'array', elements, aggregate }
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

// ---------------------------------------------------------------------------
// Discriminated if-expr exact analysis
// ---------------------------------------------------------------------------
//
// When an if-expr's branches produce records with different shapes (or the
// `kind` literal differs), we can still analyze it exactly by treating the
// result as a discriminated union: each variant has a probability (the
// probability of its path being taken) and per-field stats CONDITIONED on
// that path.
//
// The path conditions are derived from the chain of `if cond` decisions
// leading to each leaf record-expr. Fields that share random sources with
// the path conditions get conditioned via `conditionalizeSymDist`.

interface VariantBranch {
  recordExpr: RecordExpr
  // Conditions along the path: each is the analyzed condition of an if-expr
  // and whether this branch is reached when the cond is true or false.
  condsAlongPath: Array<{ cond: ExprAnalysis; truth: boolean }>
}

// Walks a (possibly nested) if-expr chain whose leaves are all record-exprs.
// Returns the list of variants with their path conditions, or null if any
// leaf is not a record-expr.
function extractIfRecordChain(
  expr: Expression,
  env: AnalysisEnv,
): VariantBranch[] | null {
  if (expr.type === 'record-expr') {
    return [{ recordExpr: expr, condsAlongPath: [] }]
  }
  if (expr.type === 'if-expr') {
    const condA = analyzeExpr(expr.condition, env)
    const thenChain = extractIfRecordChain(expr.then, env)
    const elseChain = extractIfRecordChain(expr.else, env)
    if (thenChain === null || elseChain === null) return null
    const out: VariantBranch[] = []
    for (const v of thenChain) {
      out.push({
        recordExpr: v.recordExpr,
        condsAlongPath: [{ cond: condA, truth: true }, ...v.condsAlongPath],
      })
    }
    for (const v of elseChain) {
      out.push({
        recordExpr: v.recordExpr,
        condsAlongPath: [{ cond: condA, truth: false }, ...v.condsAlongPath],
      })
    }
    return out
  }
  return null
}

// Returns true if the variants' record shapes are non-uniform — i.e., the
// keys differ across variants, or `kind:` literal values differ across
// variants. If all variants share the exact same shape (and same `kind`
// literal), this returns false and the existing if-expr SymDist machinery
// handles it.
function variantsAreMultiShape(variants: VariantBranch[]): boolean {
  if (variants.length < 2) return false
  const shapes = variants.map((v) => recordShapeOf(v.recordExpr))
  const firstKeys = shapes[0].keys
  for (let i = 1; i < shapes.length; i++) {
    if (shapes[i].keys !== firstKeys) return true
  }
  // Same keys; check `kind:` literals.
  const firstKind = shapes[0].kind
  for (let i = 1; i < shapes.length; i++) {
    if (
      firstKind !== null &&
      shapes[i].kind !== null &&
      shapes[i].kind !== firstKind
    ) {
      return true
    }
  }
  return false
}

function recordShapeOf(rec: RecordExpr): RecordShape {
  const keys = rec.fields
    .map((f) => f.key)
    .sort()
    .join(',')
  let kind: string | null = null
  for (const f of rec.fields) {
    if (f.key === 'kind' && f.value.type === 'string-literal') {
      kind = f.value.value
      break
    }
  }
  return { keys, kind }
}

// Build a SymDist<boolean> for a path: AND together the cond's value
// (negated when truth=false). Returns null if any cond's SymDist isn't
// available or isn't boolean, or if the joint exceeds MAX_JOINT_SIZE.
function buildPathSymDist(
  conds: Array<{ cond: ExprAnalysis; truth: boolean }>,
): SymDist<boolean> | null {
  if (conds.length === 0) return constSymDist<boolean>(true)
  let result: SymDist<boolean> | null = null
  for (const { cond, truth } of conds) {
    if (cond.symDist === null) return null
    const sd = cond.symDist()
    if (sd === null) return null
    for (const v of sd.dist.keys()) {
      if (typeof v !== 'boolean') return null
    }
    let polarized = sd as SymDist<boolean>
    if (!truth) {
      polarized = mapSymDist<boolean, boolean>(polarized, (b) => !b)
    }
    if (result === null) {
      result = polarized
    } else {
      const combined: SymDist<boolean> | null = combineSymDist<
        boolean,
        boolean,
        boolean
      >(result, polarized, (a, b) => a && b)
      if (combined === null) return null
      result = combined
    }
  }
  return result
}

// Computes P(path) — marginal probability that a SymDist<boolean> is true.
function probTrue(sd: SymDist<boolean>): number {
  let p = 0
  for (const [v, q] of sd.dist) if (v) p += q
  return p
}

// Attempt to build a discriminated FieldStats for an if-expr whose branches
// produce records with differing shapes. Returns:
//   - a thunk producing the discriminated FieldStats
//   - or null if the if-expr structurally isn't a discriminated multi-shape
//     case (e.g. a non-record branch, or all branches share the same shape).
//
// The thunk itself may return null at evaluation time if conditioning fails
// (joint too big, etc.) — the caller should fall back to MC in that case.
function tryDiscriminatedIfExact(
  expr: IfExpr,
  env: AnalysisEnv,
): (() => FieldStats | null) | null {
  const variants = extractIfRecordChain(expr, env)
  if (variants === null) return null
  if (!variantsAreMultiShape(variants)) return null

  // Determine discriminator (kind vs shape).
  const allHaveKind = variants.every(
    (v) => recordShapeOf(v.recordExpr).kind !== null,
  )
  const distinctKinds = new Set(
    variants.map((v) => recordShapeOf(v.recordExpr).kind),
  )
  const discriminator: 'kind' | 'shape' =
    allHaveKind && distinctKinds.size === variants.length ? 'kind' : 'shape'

  // Pre-analyze each variant's record-expr fields. We do this once
  // (eagerly) so SymDist source IDs are allocated up front and shared with
  // the conditions in the path (e.g., `$attack` referenced both in cond
  // and inside the record).
  interface PreparedVariant {
    tag: string
    keys: string[] // ordered, excluding `kind` when discriminator='kind'
    fieldAnalyses: Array<{ key: string; analysis: ExprAnalysis }>
    conds: Array<{ cond: ExprAnalysis; truth: boolean }>
  }
  const prepared: PreparedVariant[] = variants.map((v) => {
    const shape = recordShapeOf(v.recordExpr)
    const tag =
      discriminator === 'kind' && shape.kind !== null
        ? shape.kind
        : 'shape:' + shape.keys
    const keys: string[] = []
    const fieldAnalyses: Array<{ key: string; analysis: ExprAnalysis }> = []
    for (const f of v.recordExpr.fields) {
      if (discriminator === 'kind' && f.key === 'kind') continue
      keys.push(f.key)
      fieldAnalyses.push({
        key: f.key,
        analysis: analyzeExpr(f.value, env),
      })
    }
    return { tag, keys, fieldAnalyses, conds: v.condsAlongPath }
  })

  return () => {
    const variantStats: DiscriminatedVariant[] = []
    for (const v of prepared) {
      const pathSd = buildPathSymDist(v.conds)
      if (pathSd === null) return null
      const probability = probTrue(pathSd)
      // Skip variants with zero probability — they shouldn't appear in the
      // output. (Edge case: an unsatisfiable path.)
      if (probability === 0) continue

      const fields: Record<string, FieldStats> = {}
      for (const fa of v.fieldAnalyses) {
        // Get the field's SymDist if available; otherwise use exactDist
        // (records/arrays/discriminated nested in the field).
        if (fa.analysis.symDist !== null) {
          const sd = fa.analysis.symDist()
          if (sd === null) return null
          const conditioned = conditionalizeSymDist(sd, pathSd)
          if (conditioned === null) return null
          const stats = symDistToFieldStats(conditioned)
          if (stats === null) return null
          fields[fa.key] = stats
        } else if (fa.analysis.exactDist !== null) {
          // Field doesn't expose a SymDist (e.g., nested record/array). The
          // exact stats can't be conditioned on the path here — if the
          // field uses random vars shared with the path, this would be
          // incorrect. Detect that case and fail.
          const usesShared = setsIntersect(
            fa.analysis.randomVarsUsed,
            collectRandomVarsFromConds(v.conds),
          )
          // Also fail if the field's analysis has any direct random source
          // dependency (e.g., a fresh dice-expr inside a nested record).
          // We can't statically know whether it shares with the path, but
          // for safety we only allow non-random fields or fields whose
          // randomness is fully captured by `randomVarsUsed` and is
          // disjoint from the path's randomness.
          if (
            usesShared ||
            (fa.analysis.random &&
              fa.analysis.symDist === null &&
              hasFreshRandomness(fa.analysis))
          ) {
            return null
          }
          const stats = fa.analysis.exactDist()
          if (stats === null) return null
          fields[fa.key] = stats
        } else {
          return null
        }
      }
      variantStats.push({
        tag: v.tag,
        probability,
        keys: v.keys.slice(),
        fields,
      })
    }

    if (variantStats.length === 0) return null
    if (variantStats.length === 1) {
      // Degenerate: one path has zero probability; surface as a plain record.
      return { type: 'record', fields: variantStats[0].fields }
    }

    return {
      type: 'discriminated',
      discriminator,
      variants: variantStats,
    }
  }
}

// Heuristic: does this analysis have any direct random source dependency
// not captured by named-variable references? (e.g., an inline dice-expr).
// True means: even though randomVarsUsed is empty, there's randomness
// inside that we can't track for conditioning purposes.
function hasFreshRandomness(a: ExprAnalysis): boolean {
  return a.random && a.randomVarsUsed.size === 0
}

// Collect the union of randomVarsUsed across all conds in a path.
function collectRandomVarsFromConds(
  conds: Array<{ cond: ExprAnalysis; truth: boolean }>,
): Set<string> {
  const out = new Set<string>()
  for (const { cond } of conds) {
    for (const v of cond.randomVarsUsed) out.add(v)
  }
  return out
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
    const distribution = new Map([[value, 1]])
    const cdf = new Map([[value, 1]])
    return {
      type: 'number',
      mean: value,
      stddev: 0,
      variance: 0,
      mode: [value],
      min: value,
      max: value,
      distribution,
      cdf,
      percentiles: {
        p5: value,
        p10: value,
        p25: value,
        p50: value,
        p75: value,
        p90: value,
        p95: value,
      },
      skewness: 0,
      kurtosis: 0,
    }
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', truePercent: value ? 1 : 0 }
  }
  if (typeof value === 'string') {
    return { type: 'string', frequencies: new Map([[value, 1]]) }
  }
  if (Array.isArray(value)) {
    const elements = value.map(constantStats)
    const aggregate = computeAggregateIfNumeric(elements)
    if (aggregate !== null) {
      return { type: 'array', elements, aggregate }
    }
    return { type: 'array', elements }
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
// Distribution helpers (CDF, percentiles, moments, aggregate, binning)
// ---------------------------------------------------------------------------

function percentileFromCdf(cdf: Map<number, number>, p: number): number {
  const sortedEntries = [...cdf.entries()].sort((a, b) => a[0] - b[0])
  for (const [v, cum] of sortedEntries) {
    if (cum >= p) return v
  }
  return sortedEntries[sortedEntries.length - 1][0]
}

function computePercentiles(cdf: Map<number, number>): Percentiles {
  return {
    p5: percentileFromCdf(cdf, 0.05),
    p10: percentileFromCdf(cdf, 0.1),
    p25: percentileFromCdf(cdf, 0.25),
    p50: percentileFromCdf(cdf, 0.5),
    p75: percentileFromCdf(cdf, 0.75),
    p90: percentileFromCdf(cdf, 0.9),
    p95: percentileFromCdf(cdf, 0.95),
  }
}

function computeSkewness(
  dist: Map<number, number>,
  mean: number,
  stddev: number,
): number {
  if (stddev === 0) return 0
  let m3 = 0
  for (const [v, p] of dist) {
    m3 += p * Math.pow(v - mean, 3)
  }
  return m3 / Math.pow(stddev, 3)
}

function computeKurtosis(
  dist: Map<number, number>,
  mean: number,
  stddev: number,
): number {
  if (stddev === 0) return 0
  let m4 = 0
  for (const [v, p] of dist) {
    m4 += p * Math.pow(v - mean, 4)
  }
  return m4 / Math.pow(stddev, 4) - 3
}

/**
 * Compute the aggregate stats for an array of FieldStats whose elements are
 * all numeric. Returns null if any element is not numeric or the array is
 * empty.
 *
 * The pooled distribution treats the array as a mixture: each element
 * contributes 1/n of its probability mass to the pooled distribution. Mean
 * and variance are computed from the pooled distribution (equivalent to:
 * pooled_mean = avg of means, pooled_E[X^2] = avg of E[X^2_i], pooled_var =
 * pooled_E[X^2] - pooled_mean^2).
 */
function computeAggregateIfNumeric(
  elements: FieldStats[],
): NumberAggregateStats | null {
  if (elements.length === 0) return null
  for (const el of elements) {
    if (el.type !== 'number') return null
  }
  const numericElements = elements as Array<
    Extract<FieldStats, { type: 'number' }>
  >
  const n = numericElements.length
  const pooled = new Map<number, number>()
  let pooledMean = 0
  let pooledExSq = 0
  let min = Infinity
  let max = -Infinity
  for (const el of numericElements) {
    pooledMean += el.mean / n
    pooledExSq += (el.stddev * el.stddev + el.mean * el.mean) / n
    if (el.min < min) min = el.min
    if (el.max > max) max = el.max
    for (const [v, p] of el.distribution) {
      pooled.set(v, (pooled.get(v) ?? 0) + p / n)
    }
  }
  const variance = Math.max(0, pooledExSq - pooledMean * pooledMean)
  const stddev = Math.sqrt(variance)
  const distribution = normalizeMap(pooled)
  const cdf = buildCdf(distribution)
  const percentiles = computePercentiles(cdf)
  return {
    mean: pooledMean,
    stddev,
    min,
    max,
    distribution,
    cdf,
    percentiles,
    count: n,
  }
}

/**
 * Suggest a "nice" bucket size that produces at most maxBuckets buckets
 * for a value range. Uses 1, 2, 5 multipliers of powers of 10.
 */
export function suggestBucketSize(
  min: number,
  max: number,
  maxBuckets = 100,
): number {
  const range = max - min + 1
  const multipliers = [1, 2, 5, 10, 20, 25, 50, 100]
  let mult = 1
  while (true) {
    for (const m of multipliers) {
      const bs = mult * m
      if (range / bs <= maxBuckets) return bs
    }
    mult *= 100
  }
}

/**
 * Re-bin a distribution into buckets of the given size. Each bucket k contains
 * the sum of probabilities of values in [(k-1)*bucketSize+1, k*bucketSize].
 * Returns a new Map<bucketIndex, probability>. Use bucketSize=1 for no binning.
 */
export function binDistribution(
  dist: Map<number, number>,
  bucketSize: number,
): Map<number, number> {
  if (bucketSize === 1) return new Map(dist)
  const result = new Map<number, number>()
  for (const [v, p] of dist) {
    const bucket = Math.ceil(v / bucketSize)
    result.set(bucket, (result.get(bucket) ?? 0) + p)
  }
  return result
}

// ---------------------------------------------------------------------------
// Distribution normalization and sorting helpers
// ---------------------------------------------------------------------------

function normalizeMap<T>(m: Map<T, number>): Map<T, number> {
  let total = 0
  for (const v of m.values()) total += v
  if (total === 0 || total === 1) return m
  const result = new Map<T, number>()
  for (const [k, v] of m) result.set(k, v / total)
  return result
}

function sortFrequenciesDesc(freqs: Map<string, number>): Map<string, number> {
  const sorted = [...freqs.entries()].sort((a, b) => b[1] - a[1])
  return new Map(sorted)
}

function computeMode(dist: Map<number, number>): number[] {
  let maxProb = -Infinity
  for (const p of dist.values()) {
    if (p > maxProb) maxProb = p
  }
  const modes: number[] = []
  for (const [v, p] of dist) {
    if (p === maxProb) modes.push(v)
  }
  return modes.sort((a, b) => a - b)
}

// Rebuild CDF from a (normalized) distribution.
function buildCdf(dist: Map<number, number>): Map<number, number> {
  const sortedKeys = [...dist.keys()].sort((a, b) => a - b)
  const cdf = new Map<number, number>()
  let cum = 0
  const lastIdx = sortedKeys.length - 1
  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i]
    cum += dist.get(k)!
    // Force exact 1 on the last key to avoid floating-point drift.
    cdf.set(k, i === lastIdx ? 1 : cum)
  }
  return cdf
}

// ---------------------------------------------------------------------------
// Exact tier helpers
// ---------------------------------------------------------------------------

function numberStatsFromDistribution(dist: Map<number, number>): FieldStats {
  // Normalize first so probabilities sum to exactly 1.
  const distribution = normalizeMap(new Map<number, number>(dist))

  let mean = 0
  let min = Infinity
  let max = -Infinity
  for (const [v, p] of distribution) {
    mean += v * p
    if (v < min) min = v
    if (v > max) max = v
  }
  let variance = 0
  for (const [v, p] of distribution) {
    variance += (v - mean) ** 2 * p
  }
  const stddev = Math.sqrt(variance)
  const cdf = buildCdf(distribution)
  const percentiles = computePercentiles(cdf)
  const skewness = computeSkewness(distribution, mean, stddev)
  const kurtosis = computeKurtosis(distribution, mean, stddev)
  const mode = computeMode(distribution)
  return {
    type: 'number',
    mean,
    stddev,
    variance,
    mode,
    min,
    max,
    distribution,
    cdf,
    percentiles,
    skewness,
    kurtosis,
  }
}

function cloneFieldStats(stats: FieldStats): FieldStats {
  switch (stats.type) {
    case 'number':
      return {
        type: 'number',
        mean: stats.mean,
        stddev: stats.stddev,
        variance: stats.variance,
        mode: stats.mode.slice(),
        min: stats.min,
        max: stats.max,
        distribution: new Map(stats.distribution),
        cdf: new Map(stats.cdf),
        percentiles: { ...stats.percentiles },
        skewness: stats.skewness,
        kurtosis: stats.kurtosis,
        ...(stats.standardError !== undefined
          ? { standardError: stats.standardError }
          : {}),
      }
    case 'boolean':
      return {
        type: 'boolean',
        truePercent: stats.truePercent,
        ...(stats.standardError !== undefined
          ? { standardError: stats.standardError }
          : {}),
      }
    case 'string':
      return {
        type: 'string',
        frequencies: new Map(stats.frequencies),
        ...(stats.standardErrors !== undefined
          ? { standardErrors: new Map(stats.standardErrors) }
          : {}),
      }
    case 'array': {
      const elements = stats.elements.map(cloneFieldStats)
      const aggregate = stats.aggregate
        ? cloneAggregate(stats.aggregate)
        : undefined
      return {
        type: 'array',
        elements,
        ...(aggregate !== undefined ? { aggregate } : {}),
      }
    }
    case 'record': {
      const fields: Record<string, FieldStats> = {}
      for (const [k, v] of Object.entries(stats.fields)) {
        fields[k] = cloneFieldStats(v)
      }
      return { type: 'record', fields }
    }
    case 'discriminated': {
      const variants = stats.variants.map((v) => {
        const fields: Record<string, FieldStats> = {}
        for (const [k, sub] of Object.entries(v.fields)) {
          fields[k] = cloneFieldStats(sub)
        }
        return {
          tag: v.tag,
          probability: v.probability,
          ...(v.standardError !== undefined
            ? { standardError: v.standardError }
            : {}),
          keys: v.keys.slice(),
          fields,
        }
      })
      return {
        type: 'discriminated',
        discriminator: stats.discriminator,
        variants,
      }
    }
    case 'mixed':
      return { type: 'mixed' }
  }
}

function cloneAggregate(agg: NumberAggregateStats): NumberAggregateStats {
  return {
    mean: agg.mean,
    stddev: agg.stddev,
    min: agg.min,
    max: agg.max,
    distribution: new Map(agg.distribution),
    cdf: new Map(agg.cdf),
    percentiles: { ...agg.percentiles },
    count: agg.count,
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

interface MonteCarloPlan {
  fixedTrials: number | null
  maxTrials: number
  minTrials: number
  batchSize: number
  yieldEvery: number
  config: ConvergenceConfig
  signal: AbortSignal | undefined
  parameters: Record<string, Value> | undefined
}

function planMonteCarlo(
  options: AnalyzeAsyncOptions | undefined,
): MonteCarloPlan {
  const explicitTrials = options?.trials
  const maxTrials = options?.maxTrials ?? explicitTrials ?? DEFAULT_MAX_TRIALS
  const minTrialsRaw = options?.minTrials ?? DEFAULT_MIN_TRIALS
  const minTrials = Math.min(minTrialsRaw, maxTrials)
  const batchSizeRaw = options?.batchSize ?? DEFAULT_BATCH_SIZE
  const batchSize = Math.max(1, Math.min(batchSizeRaw, maxTrials))
  const yieldEveryRaw = options?.yieldEvery ?? batchSize
  const yieldEvery = Math.max(1, yieldEveryRaw)
  const targetRelativeError =
    options?.targetRelativeError ?? DEFAULT_TARGET_REL_ERROR
  const targetBinStderr = options?.targetBinStderr ?? DEFAULT_TARGET_BIN_STDERR
  const fixedTrials =
    explicitTrials !== undefined && options?.maxTrials === undefined
      ? explicitTrials
      : null
  return {
    fixedTrials,
    maxTrials,
    minTrials,
    batchSize,
    yieldEvery,
    config: { targetRelativeError, targetBinStderr, minTrials },
    signal: options?.signal,
    parameters: options?.parameters,
  }
}

function runMonteCarlo(
  program: Program,
  options?: AnalyzeOptions,
): AnalyzeResult {
  const t0 = perfNow()
  const plan = planMonteCarlo(options)
  throwIfAborted(plan.signal)

  const results: Value[] = []
  let total = 0
  let converged = false
  const evaluator = makeEvaluator()

  const runOpts = plan.parameters ? { parameters: plan.parameters } : undefined

  if (plan.fixedTrials !== null) {
    for (let i = 0; i < plan.fixedTrials; i++) {
      results.push(evaluator.run(program, runOpts))
      total++
      if (total % plan.batchSize === 0) {
        throwIfAborted(plan.signal)
      }
    }
    return {
      stats: buildStats(results, total),
      strategy: { tier: 'monte-carlo', trials: total, converged: false },
      diagnostics: {
        classifyTimeMs: 0,
        analyzeTimeMs: perfNow() - t0,
        fellBackToMC: false,
      },
    }
  }

  while (total < plan.minTrials) {
    const target = Math.min(total + plan.batchSize, plan.minTrials)
    while (total < target) {
      results.push(evaluator.run(program, runOpts))
      total++
    }
    throwIfAborted(plan.signal)
  }

  while (total < plan.maxTrials) {
    if (hasConverged(results, plan.config)) {
      converged = true
      break
    }
    const target = Math.min(total + plan.batchSize, plan.maxTrials)
    while (total < target) {
      results.push(evaluator.run(program, runOpts))
      total++
    }
    throwIfAborted(plan.signal)
  }

  if (!converged && hasConverged(results, plan.config)) {
    converged = true
  }

  return {
    stats: buildStats(results, total),
    strategy: { tier: 'monte-carlo', trials: total, converged },
    diagnostics: {
      classifyTimeMs: 0,
      analyzeTimeMs: perfNow() - t0,
      fellBackToMC: false,
    },
  }
}

async function* runMonteCarloAsync(
  program: Program,
  options?: AnalyzeAsyncOptions,
): AsyncGenerator<AsyncProgress> {
  const plan = planMonteCarlo(options)
  throwIfAborted(plan.signal)

  const results: Value[] = []
  let total = 0
  const evaluator = makeEvaluator()

  const runOpts = plan.parameters ? { parameters: plan.parameters } : undefined

  if (plan.fixedTrials !== null) {
    let nextYield = plan.yieldEvery
    for (let i = 0; i < plan.fixedTrials; i++) {
      results.push(evaluator.run(program, runOpts))
      total++
      if (total >= nextYield || total === plan.fixedTrials) {
        throwIfAborted(plan.signal)
        const stats = buildStats(results, total)
        yield { stats, trials: total, converged: false }
        nextYield = total + plan.yieldEvery
      }
    }
    return
  }

  let nextYield = plan.yieldEvery

  while (total < plan.maxTrials) {
    const target = Math.min(total + plan.batchSize, plan.maxTrials)
    while (total < target) {
      results.push(evaluator.run(program, runOpts))
      total++
    }

    throwIfAborted(plan.signal)

    if (total >= nextYield || total >= plan.maxTrials) {
      const meetsMin = total >= plan.minTrials
      const converged = meetsMin && hasConverged(results, plan.config)
      const stats = buildStats(results, total)
      yield { stats, trials: total, converged }
      nextYield = total + plan.yieldEvery
      if (converged) return
    } else if (total >= plan.minTrials && hasConverged(results, plan.config)) {
      // Convergence reached between yield points — emit a final progress.
      const stats = buildStats(results, total)
      yield { stats, trials: total, converged: true }
      return
    }
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
      const discriminator = detectDiscriminator(recs)
      if (discriminator !== 'none') {
        // Group records by tag and check convergence within each group, plus
        // convergence of the variant frequencies themselves.
        const groups = new Map<string, Record<string, Value>[]>()
        for (const rec of recs) {
          const tag =
            discriminator === 'kind'
              ? (rec['kind'] as string)
              : 'shape:' + shapeKey(rec)
          let group = groups.get(tag)
          if (!group) {
            group = []
            groups.set(tag, group)
          }
          group.push(rec)
        }
        const n = recs.length
        // Variant-frequency convergence (treat each variant probability as a
        // boolean trial).
        for (const group of groups.values()) {
          const p = group.length / n
          const stderr = Math.sqrt((p * (1 - p)) / n)
          if (stderr > config.targetBinStderr) return false
        }
        // Per-variant per-field convergence (skip the `kind` field for kind).
        for (const group of groups.values()) {
          const keySet = new Set<string>()
          for (const rec of group) {
            for (const k of Object.keys(rec)) {
              if (discriminator === 'kind' && k === 'kind') continue
              keySet.add(k)
            }
          }
          for (const k of keySet) {
            const column: Value[] = []
            for (const rec of group) {
              if (Object.prototype.hasOwnProperty.call(rec, k)) {
                column.push(rec[k])
              }
            }
            if (column.length === 0) continue
            if (!checkConvergence(column, config)) return false
          }
        }
        return true
      }
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

function buildStats(values: Value[], trialCount?: number): FieldStats {
  if (values.length === 0) return { type: 'mixed' }

  const first = values[0]
  const firstType = typeOf(first)

  for (const v of values) {
    if (typeOf(v) !== firstType) return { type: 'mixed' }
  }

  // When trialCount is provided (top-level MC call) we use it for stderr;
  // otherwise (recursive calls into columns of arrays/records) we treat the
  // column length as the trial count.
  const n = trialCount ?? values.length

  if (firstType === 'number') {
    return buildNumberStats(values as number[], n)
  }

  if (firstType === 'boolean') {
    return buildBooleanStats(values as boolean[], n)
  }

  if (firstType === 'string') {
    return buildStringStats(values as string[], n)
  }

  if (firstType === 'array') {
    return buildArrayStats(values as Value[][], n)
  }

  if (firstType === 'record') {
    return buildRecordStats(values as Record<string, Value>[], n)
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

function buildNumberStats(values: number[], trialCount: number): FieldStats {
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

  let varianceRaw = 0
  for (const v of values) {
    varianceRaw += (v - mean) ** 2
  }
  const variance = varianceRaw / n
  const stddev = Math.sqrt(variance)

  const rawDist = new Map<number, number>()
  for (const [k, count] of counts) {
    rawDist.set(k, count / n)
  }

  const distribution = normalizeMap(rawDist)
  const cdf = buildCdf(distribution)
  const percentiles = computePercentiles(cdf)
  const skewness = computeSkewness(distribution, mean, stddev)
  const kurtosis = computeKurtosis(distribution, mean, stddev)
  const standardError = trialCount > 0 ? stddev / Math.sqrt(trialCount) : 0
  const mode = computeMode(distribution)

  return {
    type: 'number',
    mean,
    stddev,
    variance,
    mode,
    min,
    max,
    distribution,
    cdf,
    percentiles,
    skewness,
    kurtosis,
    standardError,
  }
}

function buildBooleanStats(values: boolean[], trialCount: number): FieldStats {
  const trueCount = values.filter((v) => v).length
  const truePercent = trueCount / values.length
  const standardError =
    trialCount > 0
      ? Math.sqrt((truePercent * (1 - truePercent)) / trialCount)
      : 0
  return { type: 'boolean', truePercent, standardError }
}

function buildStringStats(values: string[], trialCount: number): FieldStats {
  const counts = new Map<string, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const rawFreq = new Map<string, number>()
  for (const [k, count] of counts) {
    rawFreq.set(k, count / values.length)
  }
  const frequencies = sortFrequenciesDesc(normalizeMap(rawFreq))
  // Build standardErrors in the same key order as frequencies.
  const standardErrors = new Map<string, number>()
  for (const [k, f] of frequencies) {
    standardErrors.set(
      k,
      trialCount > 0 ? Math.sqrt((f * (1 - f)) / trialCount) : 0,
    )
  }
  return { type: 'string', frequencies, standardErrors }
}

function buildArrayStats(values: Value[][], trialCount: number): FieldStats {
  if (values.length === 0) return { type: 'array', elements: [] }
  const length = values[0].length
  const elements: FieldStats[] = []
  for (let i = 0; i < length; i++) {
    const column = values.map((arr) => arr[i])
    elements.push(buildStats(column, trialCount))
  }
  const aggregate = computeAggregateIfNumeric(elements)
  if (aggregate !== null) {
    return { type: 'array', elements, aggregate }
  }
  return { type: 'array', elements }
}

function buildRecordStats(
  values: Record<string, Value>[],
  trialCount: number,
): FieldStats {
  if (values.length === 0) return { type: 'record', fields: {} }

  // Detect discrimination strategy.
  const discriminator = detectDiscriminator(values)
  if (discriminator !== 'none') {
    return buildDiscriminatedStats(values, trialCount, discriminator)
  }

  const keys = Object.keys(values[0])
  const fields: Record<string, FieldStats> = {}
  for (const key of keys) {
    const column = values.map((rec) => rec[key])
    fields[key] = buildStats(column, trialCount)
  }
  return { type: 'record', fields }
}

/**
 * Determine the discrimination strategy for an array of records:
 * - `kind`: every record has a string `kind` field, with at least two
 *   distinct values across the records.
 * - `shape`: records have varying key sets (and not all have a string `kind`).
 * - `none`: all records share the same key set (and either no `kind` field or
 *   all `kind` values agree).
 */
function detectDiscriminator(
  values: Record<string, Value>[],
): 'kind' | 'shape' | 'none' {
  if (values.length === 0) return 'none'

  // Check for `kind` discrimination: every record has a string `kind`.
  let allHaveStringKind = true
  for (const rec of values) {
    const k = rec['kind']
    if (typeof k !== 'string') {
      allHaveStringKind = false
      break
    }
  }
  if (allHaveStringKind) {
    const kinds = new Set<string>()
    for (const rec of values) {
      kinds.add(rec['kind'] as string)
    }
    if (kinds.size > 1) return 'kind'
    // Single kind value across all records: not a discriminated union.
    // Fall through to shape check (shapes likely identical too, returning
    // `none`).
  }

  // Check for shape discrimination: records have varying key sets.
  const firstKey = shapeKey(values[0])
  for (let i = 1; i < values.length; i++) {
    if (shapeKey(values[i]) !== firstKey) return 'shape'
  }
  return 'none'
}

function shapeKey(rec: Record<string, Value>): string {
  return Object.keys(rec).sort().join(',')
}

function buildDiscriminatedStats(
  values: Record<string, Value>[],
  trialCount: number,
  discriminator: 'kind' | 'shape',
): FieldStats {
  // Group trials by tag (preserve first-seen order for stable output).
  const groupOrder: string[] = []
  const groups = new Map<string, Record<string, Value>[]>()
  for (const rec of values) {
    const tag =
      discriminator === 'kind'
        ? (rec['kind'] as string)
        : 'shape:' + shapeKey(rec)
    let group = groups.get(tag)
    if (!group) {
      group = []
      groups.set(tag, group)
      groupOrder.push(tag)
    }
    group.push(rec)
  }

  // Single variant: not actually discriminated — fall back to normal record
  // stats.
  if (groupOrder.length <= 1) {
    const keys = Object.keys(values[0])
    const fields: Record<string, FieldStats> = {}
    for (const key of keys) {
      const column = values.map((rec) => rec[key])
      fields[key] = buildStats(column, trialCount)
    }
    return { type: 'record', fields }
  }

  const total = values.length
  const variants: DiscriminatedVariant[] = []
  for (const tag of groupOrder) {
    const group = groups.get(tag)!
    const probability = group.length / total
    const standardError =
      trialCount > 0
        ? Math.sqrt((probability * (1 - probability)) / trialCount)
        : 0

    // Collect all keys present in this group's records, excluding the
    // `kind` field when discriminating by kind. Preserve first-seen order.
    const keySeen = new Set<string>()
    const keys: string[] = []
    for (const rec of group) {
      for (const k of Object.keys(rec)) {
        if (discriminator === 'kind' && k === 'kind') continue
        if (!keySeen.has(k)) {
          keySeen.add(k)
          keys.push(k)
        }
      }
    }

    const fields: Record<string, FieldStats> = {}
    for (const key of keys) {
      // Only include records that actually contain this key (for shape
      // discrimination, all records in the group share the same shape, so
      // this is a no-op; for kind discrimination, records may have
      // optional fields).
      const column: Value[] = []
      for (const rec of group) {
        if (Object.prototype.hasOwnProperty.call(rec, key)) {
          column.push(rec[key])
        }
      }
      fields[key] = buildStats(column, group.length)
    }

    variants.push({
      tag,
      probability,
      standardError,
      keys,
      fields,
    })
  }

  return {
    type: 'discriminated',
    discriminator,
    variants,
  }
}
