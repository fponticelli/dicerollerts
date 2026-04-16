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
})
