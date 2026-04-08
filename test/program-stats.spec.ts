import { ProgramParser } from '../src/program-parser'
import { ProgramStats } from '../src/program-stats'
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
    expect(result.type).toBe('number')
    if (result.type === 'number') {
      expect(result.mean).toBeCloseTo(3.5, 0)
      expect(result.min).toBe(1)
      expect(result.max).toBe(6)
    }
  })

  test('record distribution', () => {
    const prog = parseProgram(
      '$roll = `d20`\n{ attack: $roll, doubled: $roll * 2 }',
    )
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('record')
    if (result.type === 'record') {
      expect(result.fields.attack.type).toBe('number')
      expect(result.fields.doubled.type).toBe('number')
      if (result.fields.attack.type === 'number')
        expect(result.fields.attack.mean).toBeCloseTo(10.5, 0)
    }
  })

  test('conditional probability', () => {
    const prog = parseProgram(
      `$roll = \`d20\`\n$hit = $roll >= 11\n$damage = if $hit then \`2d6\` else 0\n{ damage: $damage }`,
    )
    const result = ProgramStats.analyze(prog, { trials: 50000 })
    expect(result.type).toBe('record')
    if (result.type === 'record' && result.fields.damage.type === 'number') {
      expect(result.fields.damage.mean).toBeCloseTo(3.5, 0)
      expect(result.fields.damage.min).toBe(0)
    }
  })

  test('boolean distribution', () => {
    const prog = parseProgram('`d6` >= 4')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('boolean')
    if (result.type === 'boolean')
      expect(result.truePercent).toBeCloseTo(0.5, 1)
  })

  test('array distribution', () => {
    const prog = parseProgram('repeat 3 { `d6` }')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('array')
    if (result.type === 'array') expect(result.elements).toHaveLength(3)
  })

  test('string frequency', () => {
    const prog = parseProgram('if `d6` >= 4 then "hit" else "miss"')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('string')
    if (result.type === 'string') {
      expect(result.frequencies.get('hit')).toBeCloseTo(0.5, 1)
      expect(result.frequencies.get('miss')).toBeCloseTo(0.5, 1)
    }
  })
})
