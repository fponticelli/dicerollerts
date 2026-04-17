import {
  fieldStatsToJSON,
  fieldStatsFromJSON,
  totalVariationDistance,
  klDivergence,
  probabilityGreaterThan,
  sampleFromDistribution,
  fieldFromRecord,
  elementFromArray,
} from '../src/program-stats-utils'
import { ProgramParser } from '../src/program-parser'
import { ProgramStats } from '../src/program-stats'

function analyze(input: string) {
  const parsed = ProgramParser.parse(input)
  if (!parsed.success) throw new Error('parse failed')
  return ProgramStats.analyze(parsed.program)
}

describe('fieldStatsToJSON / fromJSON', () => {
  test('round trip numeric stats', () => {
    const result = analyze('`d6`')
    const json = fieldStatsToJSON(result.stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('number')
    if (restored.type === 'number') {
      expect(restored.mean).toBeCloseTo(3.5)
      expect(restored.distribution.get(1)).toBeCloseTo(1 / 6)
    }
  })

  test('round trip record stats', () => {
    const result = analyze('{ a: `d6`, b: `d8` }')
    const json = fieldStatsToJSON(result.stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('record')
  })

  test('survives JSON.stringify/parse', () => {
    const result = analyze('`d6`')
    const json = fieldStatsToJSON(result.stats)
    const str = JSON.stringify(json)
    const parsed = JSON.parse(str)
    const restored = fieldStatsFromJSON(parsed)
    expect(restored.type).toBe('number')
  })
})

describe('distribution comparison', () => {
  test('TV distance: identical distributions', () => {
    const a = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    expect(totalVariationDistance(a, a)).toBeCloseTo(0)
  })

  test('TV distance: completely different', () => {
    const a = new Map([[1, 1.0]])
    const b = new Map([[2, 1.0]])
    expect(totalVariationDistance(a, b)).toBeCloseTo(1)
  })

  test('KL divergence: identical', () => {
    const a = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    expect(klDivergence(a, a)).toBeCloseTo(0)
  })

  test('P(d20+5 > d20+0)', () => {
    const a = new Map<number, number>()
    const b = new Map<number, number>()
    for (let i = 1; i <= 20; i++) {
      a.set(i + 5, 1 / 20)
      b.set(i, 1 / 20)
    }
    // a is shifted up by 5, should usually win
    const p = probabilityGreaterThan(a, b)
    expect(p).toBeGreaterThan(0.5)
  })
})

describe('sampling', () => {
  test('sample matches distribution shape', () => {
    const dist = new Map([
      [1, 1 / 6],
      [2, 1 / 6],
      [3, 1 / 6],
      [4, 1 / 6],
      [5, 1 / 6],
      [6, 1 / 6],
    ])
    const samples = sampleFromDistribution(dist, 10000)
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    expect(mean).toBeCloseTo(3.5, 0)
  })

  test('sample with seeded rng is deterministic', () => {
    const dist = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    let seed = 12345
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const a = sampleFromDistribution(dist, 100, rng)
    seed = 12345
    const b = sampleFromDistribution(dist, 100, rng)
    expect(a).toEqual(b)
  })
})

describe('field/element accessors', () => {
  test('fieldFromRecord', () => {
    const result = analyze('{ a: 1, b: 2 }')
    const a = fieldFromRecord(result.stats, 'a')
    expect(a?.type).toBe('number')
    if (a?.type === 'number') expect(a.mean).toBe(1)
  })

  test('elementFromArray', () => {
    const result = analyze('[1, 2, 3]')
    const second = elementFromArray(result.stats, 1)
    expect(second?.type).toBe('number')
    if (second?.type === 'number') expect(second.mean).toBe(2)
  })

  test('fieldFromRecord returns undefined for non-record', () => {
    const result = analyze('`d6`')
    expect(fieldFromRecord(result.stats, 'anything')).toBeUndefined()
  })

  test('elementFromArray returns undefined for non-array', () => {
    const result = analyze('`d6`')
    expect(elementFromArray(result.stats, 0)).toBeUndefined()
  })

  test('elementFromArray returns undefined for out-of-range index', () => {
    const result = analyze('[1, 2, 3]')
    expect(elementFromArray(result.stats, 5)).toBeUndefined()
    expect(elementFromArray(result.stats, -1)).toBeUndefined()
  })
})

describe('fieldStatsToJSON / fromJSON - full round-trips', () => {
  test('round trip boolean stats with standardError', () => {
    const stats = analyze('`d6 explode on 6` >= 10').stats
    const json = fieldStatsToJSON(stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('boolean')
  })

  test('round trip string stats', () => {
    const result = analyze('if `d6` >= 4 then "hit" else "miss"')
    const json = fieldStatsToJSON(result.stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('string')
    if (restored.type === 'string') {
      expect(restored.frequencies.get('hit')).toBeCloseTo(0.5, 5)
      expect(restored.frequencies.get('miss')).toBeCloseTo(0.5, 5)
    }
  })

  test('round trip array stats with aggregate', () => {
    const result = analyze('repeat 3 { `d6` }')
    const json = fieldStatsToJSON(result.stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('array')
    if (restored.type === 'array') {
      expect(restored.elements).toHaveLength(3)
      expect(restored.aggregate).toBeDefined()
      if (restored.aggregate) {
        expect(restored.aggregate.mean).toBeCloseTo(3.5, 4)
        expect(restored.aggregate.count).toBe(3)
        expect(restored.aggregate.distribution).toBeInstanceOf(Map)
        expect(restored.aggregate.cdf).toBeInstanceOf(Map)
        expect(restored.aggregate.percentiles.p50).toBeDefined()
      }
    }
  })

  test('round trip array stats without aggregate (non-numeric elements)', () => {
    const result = analyze('repeat 3 { "x" }')
    const json = fieldStatsToJSON(result.stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('array')
    if (restored.type === 'array') {
      expect(restored.aggregate).toBeUndefined()
    }
  })

  test('round trip record stats with nested numeric including cdf/percentiles/skewness/kurtosis', () => {
    const result = analyze('{ a: `d6`, b: `d8` }')
    const json = fieldStatsToJSON(result.stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('record')
    if (restored.type === 'record') {
      const a = restored.fields.a
      expect(a.type).toBe('number')
      if (a.type === 'number') {
        expect(a.mean).toBeCloseTo(3.5, 5)
        expect(a.cdf).toBeInstanceOf(Map)
        expect(a.cdf.get(6)).toBe(1)
        expect(a.percentiles.p50).toBeDefined()
        expect(typeof a.skewness).toBe('number')
        expect(typeof a.kurtosis).toBe('number')
      }
    }
  })

  test('round trip discriminated stats via JSON.stringify', () => {
    const result = analyze(`
if \`d20\` >= 11
  then { kind: "hit", damage: \`2d6\` }
  else { kind: "miss" }
`)
    const json = fieldStatsToJSON(result.stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('discriminated')
    if (restored.type === 'discriminated') {
      expect(restored.discriminator).toBe('kind')
      expect(restored.variants).toHaveLength(2)
      const hit = restored.variants.find((v) => v.tag === 'hit')!
      const miss = restored.variants.find((v) => v.tag === 'miss')!
      expect(hit).toBeDefined()
      expect(miss).toBeDefined()
      expect(hit.probability).toBeCloseTo(0.5, 5)
      expect(miss.probability).toBeCloseTo(0.5, 5)
      expect(hit.keys).toEqual(['damage'])
      expect(miss.keys).toEqual([])
      const damage = hit.fields.damage
      expect(damage.type).toBe('number')
    }
  })

  test('round trip discriminated stats with shape discriminator', () => {
    const result = analyze(`
if \`d20\` >= 11
  then { damage: \`2d6\` }
  else { margin: 5 }
`)
    const json = fieldStatsToJSON(result.stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('discriminated')
    if (restored.type === 'discriminated') {
      expect(restored.discriminator).toBe('shape')
      expect(restored.variants).toHaveLength(2)
    }
  })

  test('round trip mixed stats', () => {
    // Construct a mixed FieldStats manually since it is hard to produce from parse
    const mixed = { type: 'mixed' as const }
    const json = fieldStatsToJSON(mixed)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('mixed')
  })

  test('fieldStatsFromJSON throws on unknown type', () => {
    expect(() => fieldStatsFromJSON({ type: 'unknownXYZ' })).toThrow()
  })

  test('mapFromJSON throws if not a map box', () => {
    // Trying to deserialize a number field stats with a corrupted distribution
    // (not a __map) triggers the internal mapFromJSON error path.
    const corrupt = {
      type: 'number',
      mean: 1,
      stddev: 0,
      variance: 0,
      mode: [1],
      min: 1,
      max: 1,
      distribution: { notAMap: true },
      cdf: { __map: [] },
      percentiles: {
        p5: 1,
        p10: 1,
        p25: 1,
        p50: 1,
        p75: 1,
        p90: 1,
        p95: 1,
      },
      skewness: 0,
      kurtosis: 0,
    }
    expect(() => fieldStatsFromJSON(corrupt)).toThrow('serialized Map')
  })

  test('percentilesFromJSON throws on non-object', () => {
    const corrupt = {
      type: 'number',
      mean: 1,
      stddev: 0,
      variance: 0,
      mode: [1],
      min: 1,
      max: 1,
      distribution: { __map: [] },
      cdf: { __map: [] },
      percentiles: null,
      skewness: 0,
      kurtosis: 0,
    }
    expect(() => fieldStatsFromJSON(corrupt)).toThrow()
  })

  test('fieldStatsFromJSON throws on null input', () => {
    expect(() => fieldStatsFromJSON(null)).toThrow('Expected FieldStats')
  })

  test('boolean stats round trip without standardError', () => {
    const stats = { type: 'boolean' as const, truePercent: 0.5 }
    const json = fieldStatsToJSON(stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('boolean')
    if (restored.type === 'boolean') {
      expect(restored.truePercent).toBe(0.5)
      expect(restored.standardError).toBeUndefined()
    }
  })

  test('boolean stats round trip with standardError', () => {
    const stats = {
      type: 'boolean' as const,
      truePercent: 0.3,
      standardError: 0.01,
    }
    const json = fieldStatsToJSON(stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('boolean')
    if (restored.type === 'boolean') {
      expect(restored.standardError).toBeCloseTo(0.01, 10)
    }
  })

  test('string stats round trip with standardErrors', () => {
    const stats = {
      type: 'string' as const,
      frequencies: new Map([
        ['a', 0.6],
        ['b', 0.4],
      ]),
      standardErrors: new Map([
        ['a', 0.01],
        ['b', 0.01],
      ]),
    }
    const json = fieldStatsToJSON(stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('string')
    if (restored.type === 'string') {
      expect(restored.frequencies.get('a')).toBeCloseTo(0.6, 10)
      expect(restored.standardErrors).toBeDefined()
      expect(restored.standardErrors!.get('a')).toBeCloseTo(0.01, 10)
    }
  })

  test('string stats round trip without standardErrors', () => {
    const stats = {
      type: 'string' as const,
      frequencies: new Map([['x', 1.0]]),
    }
    const json = fieldStatsToJSON(stats)
    const restored = fieldStatsFromJSON(json)
    expect(restored.type).toBe('string')
    if (restored.type === 'string') {
      expect(restored.standardErrors).toBeUndefined()
    }
  })

  test('discriminated variant with standardError round trips', () => {
    const stats = {
      type: 'discriminated' as const,
      discriminator: 'kind' as const,
      variants: [
        {
          tag: 'hit',
          probability: 0.5,
          standardError: 0.005,
          keys: ['damage'],
          fields: {
            damage: {
              type: 'number' as const,
              mean: 7,
              stddev: 2,
              variance: 4,
              mode: [7],
              min: 2,
              max: 12,
              distribution: new Map<number, number>([[7, 1]]),
              cdf: new Map<number, number>([[7, 1]]),
              percentiles: {
                p5: 7,
                p10: 7,
                p25: 7,
                p50: 7,
                p75: 7,
                p90: 7,
                p95: 7,
              },
              skewness: 0,
              kurtosis: 0,
            },
          },
        },
      ],
    }
    const json = fieldStatsToJSON(stats)
    const str = JSON.stringify(json)
    const restored = fieldStatsFromJSON(JSON.parse(str))
    expect(restored.type).toBe('discriminated')
    if (restored.type === 'discriminated') {
      expect(restored.variants[0].standardError).toBeCloseTo(0.005, 10)
    }
  })
})

describe('distribution comparison - edge cases', () => {
  test('TV distance: disjoint single-element distributions equals 1', () => {
    const a = new Map([[10, 1.0]])
    const b = new Map([[20, 1.0]])
    expect(totalVariationDistance(a, b)).toBe(1.0)
  })

  test('TV distance: one side is subset of the other', () => {
    const a = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    const b = new Map([[1, 1.0]])
    // TV = 0.5 * (|0.5-1| + |0.5-0|) = 0.5 * (0.5 + 0.5) = 0.5
    expect(totalVariationDistance(a, b)).toBeCloseTo(0.5)
  })

  test('TV distance: empty map against empty map is 0', () => {
    const empty = new Map<number, number>()
    expect(totalVariationDistance(empty, empty)).toBe(0)
  })

  test('KL divergence: disjoint returns Infinity', () => {
    const a = new Map([[1, 1.0]])
    const b = new Map([[2, 1.0]])
    expect(klDivergence(a, b)).toBe(Infinity)
  })

  test('KL divergence: zero probability entries in a are skipped', () => {
    const a = new Map([
      [1, 0.0],
      [2, 1.0],
    ])
    const b = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    // Only x=2 contributes: 1.0 * log(1.0 / 0.5) = log(2)
    expect(klDivergence(a, b)).toBeCloseTo(Math.log(2), 10)
  })

  test('KL divergence: single matching element gives 0', () => {
    const a = new Map([[3, 1.0]])
    const b = new Map([[3, 1.0]])
    expect(klDivergence(a, b)).toBeCloseTo(0, 10)
  })

  test('probabilityGreaterThan: disjoint where a always less than b', () => {
    const a = new Map([[1, 1.0]])
    const b = new Map([[10, 1.0]])
    expect(probabilityGreaterThan(a, b)).toBe(0)
  })

  test('probabilityGreaterThan: a always greater than b', () => {
    const a = new Map([[10, 1.0]])
    const b = new Map([[1, 1.0]])
    expect(probabilityGreaterThan(a, b)).toBe(1.0)
  })

  test('probabilityGreaterThan: equal values never count as greater', () => {
    const a = new Map([[5, 1.0]])
    const b = new Map([[5, 1.0]])
    expect(probabilityGreaterThan(a, b)).toBe(0)
  })

  test('probabilityGreaterThan: zero probability entries skipped', () => {
    // a has value 10 with prob 0 and value 1 with prob 1
    const a = new Map([
      [10, 0.0],
      [1, 1.0],
    ])
    const b = new Map([[5, 1.0]])
    // 1 > 5 is false, 10 > 5 skipped (prob=0)
    expect(probabilityGreaterThan(a, b)).toBe(0)
  })
})

describe('sampleFromDistribution - edge cases', () => {
  test('returns empty array for n <= 0', () => {
    const dist = new Map([[1, 1.0]])
    expect(sampleFromDistribution(dist, 0)).toEqual([])
    expect(sampleFromDistribution(dist, -1)).toEqual([])
  })

  test('throws for empty distribution', () => {
    expect(() => sampleFromDistribution(new Map(), 1)).toThrow('empty')
  })

  test('deterministic rng always picks same value from single-entry dist', () => {
    const dist = new Map([[42, 1.0]])
    const samples = sampleFromDistribution(dist, 5, () => 0.5)
    expect(samples).toEqual([42, 42, 42, 42, 42])
  })

  test('binary search boundary: rng returns 0 picks lowest value', () => {
    const dist = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    // rng returning 0 should always pick 1 (first CDF entry >= 0)
    const samples = sampleFromDistribution(dist, 3, () => 0)
    expect(samples.every((s) => s === 1)).toBe(true)
  })

  test('binary search boundary: rng returns 1 picks highest value', () => {
    const dist = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    // rng returning 1 picks value at last CDF entry (which is normalized to 1)
    const samples = sampleFromDistribution(dist, 3, () => 1)
    expect(samples.every((s) => s === 2)).toBe(true)
  })
})
