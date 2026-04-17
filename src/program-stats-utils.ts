import type {
  DiscriminatedVariant,
  FieldStats,
  NumberAggregateStats,
  Percentiles,
} from './program-stats'

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------
//
// `Map` does not survive `JSON.stringify` (it serializes to `{}`). These
// helpers convert `FieldStats` trees to/from a JSON-safe plain-object form.
//
// Maps are encoded as `{ __map: [[k, v], ...] }` to distinguish from regular
// records. The discriminated-union `type` field is preserved so the structure
// remains self-describing.

interface MapBox<K, V> {
  __map: [K, V][]
}

function isMapBox(v: unknown): v is MapBox<unknown, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    '__map' in v &&
    Array.isArray((v as MapBox<unknown, unknown>).__map)
  )
}

function mapToJSON<K, V>(m: Map<K, V>): MapBox<K, V> {
  return { __map: Array.from(m.entries()) }
}

function mapFromJSON<K, V>(json: unknown): Map<K, V> {
  if (!isMapBox(json)) {
    throw new Error('Expected a serialized Map (__map)')
  }
  return new Map(json.__map as [K, V][])
}

function percentilesToJSON(p: Percentiles): Percentiles {
  return { ...p }
}

function percentilesFromJSON(json: unknown): Percentiles {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Expected percentiles object')
  }
  const o = json as Record<string, unknown>
  return {
    p5: o.p5 as number,
    p10: o.p10 as number,
    p25: o.p25 as number,
    p50: o.p50 as number,
    p75: o.p75 as number,
    p90: o.p90 as number,
    p95: o.p95 as number,
  }
}

function numberAggregateToJSON(a: NumberAggregateStats): unknown {
  return {
    mean: a.mean,
    stddev: a.stddev,
    min: a.min,
    max: a.max,
    distribution: mapToJSON(a.distribution),
    cdf: mapToJSON(a.cdf),
    percentiles: percentilesToJSON(a.percentiles),
    count: a.count,
  }
}

function numberAggregateFromJSON(json: unknown): NumberAggregateStats {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Expected number aggregate object')
  }
  const o = json as Record<string, unknown>
  return {
    mean: o.mean as number,
    stddev: o.stddev as number,
    min: o.min as number,
    max: o.max as number,
    distribution: mapFromJSON<number, number>(o.distribution),
    cdf: mapFromJSON<number, number>(o.cdf),
    percentiles: percentilesFromJSON(o.percentiles),
    count: o.count as number,
  }
}

export function fieldStatsToJSON(stats: FieldStats): unknown {
  switch (stats.type) {
    case 'number': {
      const out: Record<string, unknown> = {
        type: 'number',
        mean: stats.mean,
        stddev: stats.stddev,
        variance: stats.variance,
        mode: stats.mode.slice(),
        min: stats.min,
        max: stats.max,
        distribution: mapToJSON(stats.distribution),
        cdf: mapToJSON(stats.cdf),
        percentiles: percentilesToJSON(stats.percentiles),
        skewness: stats.skewness,
        kurtosis: stats.kurtosis,
      }
      if (stats.standardError !== undefined) {
        out.standardError = stats.standardError
      }
      return out
    }
    case 'boolean': {
      const out: Record<string, unknown> = {
        type: 'boolean',
        truePercent: stats.truePercent,
      }
      if (stats.standardError !== undefined) {
        out.standardError = stats.standardError
      }
      return out
    }
    case 'string': {
      const out: Record<string, unknown> = {
        type: 'string',
        frequencies: mapToJSON(stats.frequencies),
      }
      if (stats.standardErrors !== undefined) {
        out.standardErrors = mapToJSON(stats.standardErrors)
      }
      return out
    }
    case 'array': {
      const out: Record<string, unknown> = {
        type: 'array',
        elements: stats.elements.map((e) => fieldStatsToJSON(e)),
      }
      if (stats.aggregate !== undefined) {
        out.aggregate = numberAggregateToJSON(stats.aggregate)
      }
      return out
    }
    case 'record': {
      const fields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(stats.fields)) {
        fields[k] = fieldStatsToJSON(v)
      }
      return { type: 'record', fields }
    }
    case 'discriminated': {
      const variants = stats.variants.map((v) => {
        const fields: Record<string, unknown> = {}
        for (const [k, sub] of Object.entries(v.fields)) {
          fields[k] = fieldStatsToJSON(sub)
        }
        const out: Record<string, unknown> = {
          tag: v.tag,
          probability: v.probability,
          keys: v.keys.slice(),
          fields,
        }
        if (v.standardError !== undefined) {
          out.standardError = v.standardError
        }
        return out
      })
      return {
        type: 'discriminated',
        discriminator: stats.discriminator,
        variants,
      }
    }
    case 'mixed': {
      return { type: 'mixed' }
    }
  }
}

export function fieldStatsFromJSON(json: unknown): FieldStats {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Expected FieldStats object')
  }
  const o = json as Record<string, unknown>
  const type = o.type
  switch (type) {
    case 'number': {
      const result: FieldStats = {
        type: 'number',
        mean: o.mean as number,
        stddev: o.stddev as number,
        variance: o.variance as number,
        mode: (o.mode as number[]).slice(),
        min: o.min as number,
        max: o.max as number,
        distribution: mapFromJSON<number, number>(o.distribution),
        cdf: mapFromJSON<number, number>(o.cdf),
        percentiles: percentilesFromJSON(o.percentiles),
        skewness: o.skewness as number,
        kurtosis: o.kurtosis as number,
      }
      if (o.standardError !== undefined) {
        result.standardError = o.standardError as number
      }
      return result
    }
    case 'boolean': {
      const result: FieldStats = {
        type: 'boolean',
        truePercent: o.truePercent as number,
      }
      if (o.standardError !== undefined) {
        result.standardError = o.standardError as number
      }
      return result
    }
    case 'string': {
      const result: FieldStats = {
        type: 'string',
        frequencies: mapFromJSON<string, number>(o.frequencies),
      }
      if (o.standardErrors !== undefined) {
        result.standardErrors = mapFromJSON<string, number>(o.standardErrors)
      }
      return result
    }
    case 'array': {
      const elements = (o.elements as unknown[]).map((e) =>
        fieldStatsFromJSON(e),
      )
      const result: FieldStats = { type: 'array', elements }
      if (o.aggregate !== undefined) {
        result.aggregate = numberAggregateFromJSON(o.aggregate)
      }
      return result
    }
    case 'record': {
      const fieldsIn = o.fields as Record<string, unknown>
      const fields: Record<string, FieldStats> = {}
      for (const [k, v] of Object.entries(fieldsIn)) {
        fields[k] = fieldStatsFromJSON(v)
      }
      return { type: 'record', fields }
    }
    case 'discriminated': {
      const variantsIn = o.variants as unknown[]
      const discriminator = o.discriminator as 'kind' | 'shape'
      const variants: DiscriminatedVariant[] = variantsIn.map((raw) => {
        if (typeof raw !== 'object' || raw === null) {
          throw new Error('Expected DiscriminatedVariant object')
        }
        const vo = raw as Record<string, unknown>
        const fieldsIn = vo.fields as Record<string, unknown>
        const fields: Record<string, FieldStats> = {}
        for (const [k, sub] of Object.entries(fieldsIn)) {
          fields[k] = fieldStatsFromJSON(sub)
        }
        const variant: DiscriminatedVariant = {
          tag: vo.tag as string,
          probability: vo.probability as number,
          keys: (vo.keys as string[]).slice(),
          fields,
        }
        if (vo.standardError !== undefined) {
          variant.standardError = vo.standardError as number
        }
        return variant
      })
      return {
        type: 'discriminated',
        discriminator,
        variants,
      }
    }
    case 'mixed': {
      return { type: 'mixed' }
    }
    default:
      throw new Error(`Unknown FieldStats type: ${String(type)}`)
  }
}

// ---------------------------------------------------------------------------
// Distribution comparison
// ---------------------------------------------------------------------------

/**
 * Total Variation distance between two discrete probability distributions.
 *   TV(P, Q) = 0.5 * sum_x |P(x) - Q(x)|
 * Result is in [0, 1]. 0 means identical; 1 means disjoint support.
 */
export function totalVariationDistance(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  const keys = new Set<number>()
  for (const k of a.keys()) keys.add(k)
  for (const k of b.keys()) keys.add(k)
  let sum = 0
  for (const k of keys) {
    const pa = a.get(k) ?? 0
    const pb = b.get(k) ?? 0
    sum += Math.abs(pa - pb)
  }
  return 0.5 * sum
}

/**
 * KL divergence D(a || b) = sum_x a(x) * log(a(x) / b(x)).
 * Terms with a(x) = 0 contribute 0 (convention 0*log(0) = 0).
 * Returns `Infinity` if any x has a(x) > 0 but b(x) = 0 (undefined in that case).
 */
export function klDivergence(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  let sum = 0
  for (const [k, pa] of a) {
    if (pa === 0) continue
    const pb = b.get(k) ?? 0
    if (pb === 0) return Infinity
    sum += pa * Math.log(pa / pb)
  }
  return sum
}

/**
 * Probability that X > Y where X has distribution `a` and Y has distribution `b`,
 * assuming independence.
 */
export function probabilityGreaterThan(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  let p = 0
  for (const [xv, xp] of a) {
    if (xp === 0) continue
    for (const [yv, yp] of b) {
      if (yp === 0) continue
      if (xv > yv) p += xp * yp
    }
  }
  return p
}

/**
 * Probability that X < Y for independent X ~ `a`, Y ~ `b`.
 */
export function probabilityLessThan(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  let p = 0
  for (const [xv, xp] of a) {
    if (xp === 0) continue
    for (const [yv, yp] of b) {
      if (yp === 0) continue
      if (xv < yv) p += xp * yp
    }
  }
  return p
}

/**
 * Probability that X == Y for independent X ~ `a`, Y ~ `b`.
 */
export function probabilityEqual(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  let p = 0
  for (const [xv, xp] of a) {
    if (xp === 0) continue
    const yp = b.get(xv)
    if (yp === undefined || yp === 0) continue
    p += xp * yp
  }
  return p
}

/**
 * Box plot data for a numeric distribution: quartiles, whiskers, outliers.
 * Uses the standard 1.5*IQR rule for whisker extents, clamped to the actual
 * minimum and maximum values present in the distribution.
 */
export interface BoxPlotData {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  iqr: number
  /** q1 - 1.5 * iqr, clamped to the smallest value with nonzero probability. */
  lowerWhisker: number
  /** q3 + 1.5 * iqr, clamped to the largest value with nonzero probability. */
  upperWhisker: number
  /** Values with nonzero probability that fall outside the whisker range, sorted. */
  outliers: number[]
}

/**
 * Compute box-plot data for a numeric distribution. Quartiles use the
 * "first value with cumulative probability >= p" rule (matches
 * `program-stats`' `percentileFromCdf`). For empty or invalid distributions,
 * throws.
 */
export function boxPlotData(dist: Map<number, number>): BoxPlotData {
  const entries = Array.from(dist.entries())
    .filter(([, p]) => p > 0)
    .sort((a, b) => a[0] - b[0])
  if (entries.length === 0) {
    throw new Error('Cannot compute box plot data for an empty distribution')
  }
  let total = 0
  for (const [, p] of entries) total += p
  if (total <= 0) {
    throw new Error('Distribution has non-positive total probability')
  }
  // Build a normalized CDF.
  const cdf: [number, number][] = []
  let acc = 0
  for (let i = 0; i < entries.length; i++) {
    acc += entries[i][1] / total
    // Guard against floating-point drift for the last entry.
    cdf.push([entries[i][0], i === entries.length - 1 ? 1 : acc])
  }
  const percentile = (p: number): number => {
    for (const [v, cum] of cdf) {
      if (cum >= p) return v
    }
    return cdf[cdf.length - 1][0]
  }
  const minVal = entries[0][0]
  const maxVal = entries[entries.length - 1][0]
  const q1 = percentile(0.25)
  const median = percentile(0.5)
  const q3 = percentile(0.75)
  const iqr = q3 - q1
  const lowerBound = q1 - 1.5 * iqr
  const upperBound = q3 + 1.5 * iqr

  // Whiskers extend to the nearest data point within the fence bounds.
  let lowerWhisker = minVal
  for (const [v] of cdf) {
    if (v >= lowerBound) {
      lowerWhisker = v
      break
    }
  }
  let upperWhisker = maxVal
  for (let i = cdf.length - 1; i >= 0; i--) {
    const v = cdf[i][0]
    if (v <= upperBound) {
      upperWhisker = v
      break
    }
  }
  const outliers: number[] = []
  for (const [v] of cdf) {
    if (v < lowerWhisker || v > upperWhisker) outliers.push(v)
  }
  outliers.sort((a, b) => a - b)
  return {
    min: minVal,
    q1,
    median,
    q3,
    max: maxVal,
    iqr,
    lowerWhisker,
    upperWhisker,
    outliers,
  }
}

// ---------------------------------------------------------------------------
// Random sampling
// ---------------------------------------------------------------------------

/**
 * Sample `n` values from a numeric discrete distribution using the provided
 * `rng` (defaults to `Math.random`). Uses cumulative inverse method: builds a
 * sorted CDF once, then for each sample generates a uniform and binary-searches
 * for the first bucket whose CDF is >= the uniform sample.
 */
export function sampleFromDistribution(
  dist: Map<number, number>,
  n: number,
  rng: () => number = Math.random,
): number[] {
  if (n <= 0) return []
  const entries = Array.from(dist.entries()).sort((x, y) => x[0] - y[0])
  if (entries.length === 0) {
    throw new Error('Cannot sample from an empty distribution')
  }
  const values: number[] = new Array(entries.length)
  const cdf: number[] = new Array(entries.length)
  let acc = 0
  for (let i = 0; i < entries.length; i++) {
    values[i] = entries[i][0]
    acc += entries[i][1]
    cdf[i] = acc
  }
  // Normalize so CDF ends at 1 (guards against floating-point drift or
  // un-normalized distributions).
  if (acc <= 0) {
    throw new Error('Distribution has non-positive total probability')
  }
  for (let i = 0; i < cdf.length; i++) cdf[i] /= acc
  cdf[cdf.length - 1] = 1

  const out: number[] = new Array(n)
  for (let s = 0; s < n; s++) {
    const r = rng()
    // Binary search for the first index with cdf[i] >= r.
    let lo = 0
    let hi = cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (cdf[mid] >= r) hi = mid
      else lo = mid + 1
    }
    out[s] = values[lo]
  }
  return out
}

// ---------------------------------------------------------------------------
// Field / element accessors
// ---------------------------------------------------------------------------

/**
 * Return the stats for a specific field within a record FieldStats,
 * or `undefined` if `stats` is not a record or the field is not present.
 *
 * Note: this is a projection to a marginal — joint information across
 * fields is not preserved by `FieldStats`, so this is strictly a convenience
 * accessor, not a true conditional.
 */
export function fieldFromRecord(
  stats: FieldStats,
  fieldName: string,
): FieldStats | undefined {
  if (stats.type !== 'record') return undefined
  return stats.fields[fieldName]
}

/**
 * Return the stats for a specific element index within an array FieldStats,
 * or `undefined` if `stats` is not an array or the index is out of range.
 */
export function elementFromArray(
  stats: FieldStats,
  index: number,
): FieldStats | undefined {
  if (stats.type !== 'array') return undefined
  if (index < 0 || index >= stats.elements.length) return undefined
  return stats.elements[index]
}
