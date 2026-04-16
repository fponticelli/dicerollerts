import { ProgramParser } from '../src/program-parser'
import {
  ProgramStats,
  binDistribution,
  suggestBucketSize,
} from '../src/program-stats'
import type { Program } from '../src/program'

function parseProgram(input: string): Program {
  const result = ProgramParser.parse(input)
  if (!result.success) throw new Error('Parse failed')
  return result.program
}

describe('program stats', () => {
  test('simple number distribution', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('number')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(3.5, 0)
      expect(result.stats.min).toBe(1)
      expect(result.stats.max).toBe(6)
    }
  })

  test('record distribution', () => {
    const prog = parseProgram(
      '$roll = `d20`\n{ attack: $roll, doubled: $roll * 2 }',
    )
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('record')
    if (result.stats.type === 'record') {
      expect(result.stats.fields.attack.type).toBe('number')
      expect(result.stats.fields.doubled.type).toBe('number')
      if (result.stats.fields.attack.type === 'number')
        expect(result.stats.fields.attack.mean).toBeCloseTo(10.5, 0)
    }
  })

  test('conditional probability', () => {
    const prog = parseProgram(
      `$roll = \`d20\`\n$hit = $roll >= 11\n$damage = if $hit then \`2d6\` else 0\n{ damage: $damage }`,
    )
    const result = ProgramStats.analyze(prog, { trials: 50000 })
    expect(result.stats.type).toBe('record')
    if (
      result.stats.type === 'record' &&
      result.stats.fields.damage.type === 'number'
    ) {
      expect(result.stats.fields.damage.mean).toBeCloseTo(3.5, 0)
      expect(result.stats.fields.damage.min).toBe(0)
    }
  })

  test('boolean distribution', () => {
    const prog = parseProgram('`d6` >= 4')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('boolean')
    if (result.stats.type === 'boolean')
      expect(result.stats.truePercent).toBeCloseTo(0.5, 1)
  })

  test('array distribution', () => {
    const prog = parseProgram('repeat 3 { `d6` }')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('array')
    if (result.stats.type === 'array')
      expect(result.stats.elements).toHaveLength(3)
  })

  test('string frequency', () => {
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.stats.type).toBe('string')
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('hit')).toBeCloseTo(0.5, 1)
      expect(result.stats.frequencies.get('miss')).toBeCloseTo(0.5, 1)
    }
  })
})

describe('analysis tiers', () => {
  test('constant program detected', () => {
    const prog = parseProgram('5 + 3')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBe(8)
      expect(result.stats.stddev).toBe(0)
    }
  })

  test('constant with variables', () => {
    const prog = parseProgram('$x = 5\n$y = $x * 2\n$y')
    expect(ProgramStats.classify(prog)).toBe('constant')
  })

  test('exact for single dice expression', () => {
    const prog = parseProgram('`d6`')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(3.5)
      expect(result.stats.distribution.get(1)).toBeCloseTo(1 / 6)
    }
  })

  test('exact for record sharing single variable', () => {
    // With shared-variable enumeration, this is now exact: each field's
    // marginal is the d6 distribution.
    const prog = parseProgram('$x = `d6`\n{ a: $x, b: $x }')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })

  test('exact for 3d6 (single dice expression)', () => {
    const prog = parseProgram('`3d6`')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(10.5)
      expect(result.stats.min).toBe(3)
      expect(result.stats.max).toBe(18)
    }
  })

  test('exact for conditional with categorical branches', () => {
    // Categorical conditional outputs are now handled by SymDist.
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('hit')).toBeCloseTo(0.5, 5)
      expect(result.stats.frequencies.get('miss')).toBeCloseTo(0.5, 5)
    }
  })

  test('constant boolean program', () => {
    const prog = parseProgram('true')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'boolean') {
      expect(result.stats.truePercent).toBe(1)
    }
  })

  test('constant array program', () => {
    const prog = parseProgram('[1, 2, 3]')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('constant')
    if (result.stats.type === 'array') {
      expect(result.stats.elements).toHaveLength(3)
      if (result.stats.elements[0].type === 'number') {
        expect(result.stats.elements[0].mean).toBe(1)
        expect(result.stats.elements[0].stddev).toBe(0)
      }
    }
  })

  test('monte-carlo with adaptive convergence', () => {
    // Force monte-carlo by using a dice expression with an outer variable
    // substitution (not exact-analyzable).
    const prog = parseProgram('$mod = `d4`\n`d20 + $mod`')
    const result = ProgramStats.analyze(prog, {
      maxTrials: 50000,
      minTrials: 1000,
      batchSize: 1000,
      targetRelativeError: 0.02,
    })
    expect(result.strategy.tier).toBe('monte-carlo')
    expect(result.strategy.trials).toBeGreaterThanOrEqual(1000)
    expect(result.strategy.trials).toBeLessThanOrEqual(50000)
  })
})

describe('per-bin convergence', () => {
  test('non-exact program runs more trials for smooth distribution', () => {
    // Force monte-carlo via dice-variable substitution which is non-exact.
    const prog = parseProgram('$mod = `d4`\n`d20 + $mod`')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('monte-carlo')
    // With per-bin convergence, should run more than the minTrials floor
    expect(result.strategy.trials).toBeGreaterThan(1000)
  })
})

describe('exact tier extensions', () => {
  test('repeat with constant body is exact', () => {
    const prog = parseProgram('repeat 6 { `4d6 drop 1` }')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'array') {
      expect(result.stats.elements).toHaveLength(6)
      // each element should be the same exact distribution
      if (result.stats.elements[0].type === 'number') {
        expect(result.stats.elements[0].mean).toBeCloseTo(12.24, 1)
      }
    }
  })

  test('array literal of independent dice is exact', () => {
    const prog = parseProgram('[`d6`, `d8`, `d10`]')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })

  test('record of independent dice is exact', () => {
    const prog = parseProgram('{ atk: `d20`, dmg: `2d6` }')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })

  test('record sharing variable is exact via shared SymDist', () => {
    // Each field's marginal is the d6 distribution.
    const prog = parseProgram('$x = `d6`\n{ a: $x, b: $x }')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })

  test('repeat with non-constant count is monte-carlo', () => {
    const prog = parseProgram('$n = `d6`\nrepeat $n { `d4` }')
    expect(ProgramStats.classify(prog)).toBe('monte-carlo')
  })

  test('dice expression with variable substitution is monte-carlo', () => {
    // dice-variable-ref inside backticks blocks exact analysis (option a)
    const prog = parseProgram('$mod = 5\n`d20 + $mod`')
    // even though everything is constant + dice, we conservatively use MC
    expect(ProgramStats.classify(prog)).toBe('monte-carlo')
  })
})

describe('exact - comparisons', () => {
  test('boolean from comparison', () => {
    const prog = parseProgram('`d20` >= 11')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'boolean') {
      expect(result.stats.truePercent).toBeCloseTo(0.5, 5)
    }
  })

  test('comparison with constant on both sides exact', () => {
    const prog = parseProgram('5 >= 3')
    expect(ProgramStats.classify(prog)).toBe('constant')
  })
})

describe('exact - conditionals', () => {
  test('if-then-else with disjoint random', () => {
    const prog = parseProgram('if `d20` >= 11 then `2d6` else 0')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // P(hit) = 0.5, expected damage on hit = 7
      // overall mean = 0.5 * 7 + 0.5 * 0 = 3.5
      expect(result.stats.mean).toBeCloseTo(3.5, 5)
      expect(result.stats.distribution.get(0)).toBeCloseTo(0.5, 5)
    }
  })

  test('categorical conditional output', () => {
    const prog = parseProgram('if `d20` >= 11 then "hit" else "miss"')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('hit')).toBeCloseTo(0.5, 5)
      expect(result.stats.frequencies.get('miss')).toBeCloseTo(0.5, 5)
    }
  })
})

describe('exact - arithmetic on distributions', () => {
  test('dist plus constant', () => {
    const prog = parseProgram('`d6` + 5')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.min).toBe(6)
      expect(result.stats.max).toBe(11)
    }
  })

  test('two independent dists', () => {
    const prog = parseProgram('$x = `d6`\n$y = `d6`\n$x + $y')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBeCloseTo(7, 5)
      expect(result.stats.distribution.get(7)).toBeCloseTo(6 / 36, 5)
    }
  })

  test('multiplication by constant', () => {
    const prog = parseProgram('`d6` * 3')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })

  test('negation', () => {
    const prog = parseProgram('-`d6`')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.min).toBe(-6)
      expect(result.stats.max).toBe(-1)
    }
  })
})

describe('exact - shared variables', () => {
  test('variable used once is exact', () => {
    const prog = parseProgram('$x = `d6`\n$x * 2')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.distribution.get(2)).toBeCloseTo(1 / 6, 5)
      expect(result.stats.distribution.get(12)).toBeCloseTo(1 / 6, 5)
    }
  })

  test('variable used twice via enumeration', () => {
    const prog = parseProgram('$x = `d6`\n$x * $x')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // 1*1=1, 2*2=4, 3*3=9, 4*4=16, 5*5=25, 6*6=36 each with prob 1/6
      expect(result.stats.distribution.get(1)).toBeCloseTo(1 / 6, 5)
      expect(result.stats.distribution.get(36)).toBeCloseTo(1 / 6, 5)
    }
  })

  test('variable used in record fields stays exact via enumeration', () => {
    const prog = parseProgram('$x = `d6`\n{ a: $x, b: $x }')
    expect(ProgramStats.classify(prog)).toBe('exact')
  })
})

describe('exact - boolean operators', () => {
  test('and of independent comparisons', () => {
    const prog = parseProgram('`d6` >= 4 and `d6` >= 4')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'boolean') {
      // 0.5 * 0.5 = 0.25
      expect(result.stats.truePercent).toBeCloseTo(0.25, 5)
    }
  })

  test('or of independent comparisons', () => {
    const prog = parseProgram('`d6` >= 4 or `d6` >= 4')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'boolean') {
      // 1 - 0.5 * 0.5 = 0.75
      expect(result.stats.truePercent).toBeCloseTo(0.75, 5)
    }
  })

  test('not on comparison', () => {
    const prog = parseProgram('not (`d6` >= 4)')
    expect(ProgramStats.classify(prog)).toBe('exact')
    const result = ProgramStats.analyze(prog)
    expect(result.strategy.tier).toBe('exact')
    if (result.stats.type === 'boolean') {
      expect(result.stats.truePercent).toBeCloseTo(0.5, 5)
    }
  })
})

describe('exact - complex composition', () => {
  test('attack roll with conditional damage exact', () => {
    const prog = parseProgram(
      `$attack = \`d20\`\n$hit = $attack >= 11\n$damage = if $hit then \`2d6\` else 0\n{ attack: $attack, hit: $hit, damage: $damage }`,
    )
    // attack is used in: $hit comparison, record field
    // hit is used in: if-then-else, record field
    // damage is used in: record field
    // All shared variables are present. May or may not stay exact depending
    // on implementation. At minimum, this should not crash.
    const result = ProgramStats.analyze(prog)
    expect(result.stats.type).toBe('record')
  })
})

describe('FieldStats - percentiles and CDF', () => {
  test('numeric stats include percentiles', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.percentiles.p50).toBeDefined()
      expect(result.stats.percentiles.p25).toBeDefined()
      expect(result.stats.percentiles.p75).toBeDefined()
      // d6: p50 should be 3 or 4, p25 should be 2, p75 should be 5
      expect(result.stats.percentiles.p50).toBeGreaterThanOrEqual(3)
      expect(result.stats.percentiles.p50).toBeLessThanOrEqual(4)
    }
  })

  test('numeric stats include CDF', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.cdf.get(1)).toBeCloseTo(1 / 6, 5)
      expect(result.stats.cdf.get(3)).toBeCloseTo(3 / 6, 5)
      expect(result.stats.cdf.get(6)).toBeCloseTo(1, 5)
    }
  })

  test('skewness and kurtosis on uniform distribution', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // d6 is uniform symmetric, skewness ~ 0
      expect(result.stats.skewness).toBeCloseTo(0, 5)
      // discrete uniform excess kurtosis is negative for d6
      expect(result.stats.kurtosis).toBeLessThan(0)
    }
  })

  test('skewness on skewed distribution', () => {
    const prog = parseProgram('`4d6 drop 1`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // 4d6 drop lowest is left-skewed (negative skew)
      expect(result.stats.skewness).toBeLessThan(0)
    }
  })
})

describe('FieldStats - standard error', () => {
  test('exact stats have no standardError', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.standardError).toBeUndefined()
    }
  })

  test('MC boolean has standardError', () => {
    // d6 explode on 6 with always blocks exact analysis -> MC.
    const prog = parseProgram('`d6 explode on 6` >= 10')
    const result = ProgramStats.analyze(prog)
    if (
      result.strategy.tier === 'monte-carlo' &&
      result.stats.type === 'boolean'
    ) {
      expect(result.stats.standardError).toBeDefined()
      expect(result.stats.standardError!).toBeGreaterThan(0)
    }
  })
})

describe('FieldStats - array aggregate', () => {
  test('repeat with numeric body has aggregate', () => {
    const prog = parseProgram('repeat 6 { `d6` }')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'array' && result.stats.aggregate) {
      expect(result.stats.aggregate.mean).toBeCloseTo(3.5, 5)
      expect(result.stats.aggregate.count).toBe(6)
      expect(result.stats.aggregate.percentiles.p50).toBeGreaterThanOrEqual(3)
    }
  })

  test('non-numeric array has no aggregate', () => {
    const prog = parseProgram('repeat 3 { "x" }')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'array') {
      expect(result.stats.aggregate).toBeUndefined()
    }
  })
})

describe('FieldStats - mode and variance', () => {
  test('numeric stats include mode', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // d6 is uniform - all values are mode
      expect(result.stats.mode.length).toBe(6)
    }
  })

  test('mode for skewed distribution', () => {
    const prog = parseProgram('`2d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      // 2d6 mode is 7
      expect(result.stats.mode).toEqual([7])
    }
  })

  test('variance is stddev squared', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.variance).toBeCloseTo(result.stats.stddev ** 2, 5)
    }
  })
})

describe('FieldStats - sorted string frequencies', () => {
  test('frequencies iterate most common first', () => {
    const prog = parseProgram('if `d20` >= 2 then "common" else "rare"')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'string') {
      const keys = [...result.stats.frequencies.keys()]
      expect(keys[0]).toBe('common')
      expect(keys[1]).toBe('rare')
    }
  })
})

describe('FieldStats - normalization', () => {
  test('distribution sums to exactly 1', () => {
    const prog = parseProgram('`d6` + `d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      let total = 0
      for (const p of result.stats.distribution.values()) total += p
      expect(total).toBeCloseTo(1, 14)
    }
  })

  test('cdf max equals 1 exactly', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.cdf.get(6)).toBe(1)
    }
  })
})

describe('AnalyzeResult diagnostics', () => {
  test('diagnostics populated', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics.classifyTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.diagnostics.analyzeTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.diagnostics.fellBackToMC).toBe(false)
  })

  test('fellBackToMC tracked', () => {
    // Hard to construct a case where classifier says exact but it fails;
    // just verify the field exists and is false in normal cases
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog)
    expect(result.diagnostics.fellBackToMC).toBe(false)
  })

  test('constant tier also has diagnostics', () => {
    const prog = parseProgram('5 + 3')
    const result = ProgramStats.analyze(prog)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics.classifyTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.diagnostics.analyzeTimeMs).toBeGreaterThanOrEqual(0)
    expect(result.diagnostics.fellBackToMC).toBe(false)
  })
})

describe('histogram utilities', () => {
  test('suggestBucketSize for small range', () => {
    expect(suggestBucketSize(1, 6)).toBe(1)
  })

  test('suggestBucketSize for large range', () => {
    const bs = suggestBucketSize(1, 10000, 100)
    expect(bs).toBeGreaterThan(1)
    expect(10000 / bs).toBeLessThanOrEqual(100)
  })

  test('binDistribution preserves total probability', () => {
    const dist = new Map([
      [1, 0.1],
      [2, 0.2],
      [3, 0.3],
      [4, 0.2],
      [5, 0.1],
      [6, 0.1],
    ])
    const binned = binDistribution(dist, 2)
    let total = 0
    for (const p of binned.values()) total += p
    expect(total).toBeCloseTo(1, 10)
  })

  test('binDistribution with size 1 is identity', () => {
    const dist = new Map([
      [1, 0.5],
      [2, 0.5],
    ])
    const binned = binDistribution(dist, 1)
    expect(binned.get(1)).toBe(0.5)
    expect(binned.get(2)).toBe(0.5)
  })
})
