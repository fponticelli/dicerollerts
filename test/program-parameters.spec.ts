import { ProgramParser } from '../src/program-parser'
import { ProgramParameters } from '../src/program-parameters'
import type { Program } from '../src/program'

function parse(input: string): Program {
  const r = ProgramParser.parse(input)
  if (!r.success) throw new Error('parse failed: ' + r.errors[0].message)
  return r.program
}

describe('ProgramParameters.list', () => {
  test('empty when no parameters', () => {
    expect(ProgramParameters.list(parse('5 + 3'))).toEqual([])
  })

  test('extracts a simple parameter', () => {
    const params = ProgramParameters.list(parse('$x is { default: 5 }'))
    expect(params).toHaveLength(1)
    expect(params[0].name).toBe('x')
    expect(params[0].default).toBe(5)
    expect(params[0].defaultExpr).toBeUndefined()
    expect(params[0].defaultSource).toBeUndefined()
  })

  test('extracts dice expression default', () => {
    const params = ProgramParameters.list(parse('$x is { default: `d6` }'))
    expect(params[0].default).toBeUndefined()
    expect(params[0].defaultExpr).toBeDefined()
    expect(params[0].defaultSource).toBe('d6')
  })

  test('extracts all metadata', () => {
    const src =
      '$x is { default: 5, min: 0, max: 10, label: "X", description: "..." }'
    const p = ProgramParameters.list(parse(src))[0]
    expect(p.label).toBe('X')
    expect(p.description).toBe('...')
    expect(p.min).toBe(0)
    expect(p.max).toBe(10)
  })

  test('extracts enum', () => {
    const p = ProgramParameters.list(
      parse('$x is { default: "a", enum: ["a", "b"] }'),
    )[0]
    expect(p.enum).toEqual(['a', 'b'])
  })

  test('boolean parameter default', () => {
    const p = ProgramParameters.list(
      parse('$adv is { default: false, label: "Advantage" }'),
    )[0]
    expect(p.default).toBe(false)
    expect(p.label).toBe('Advantage')
  })

  test('extracts multiple parameters in declaration order', () => {
    const src =
      '$a is { default: 1 }\n$b is { default: 2 }\n$c is { default: 3 }\n$a + $b + $c'
    const params = ProgramParameters.list(parse(src))
    expect(params.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(params.map((p) => p.default)).toEqual([1, 2, 3])
  })

  test('skips non-parameter statements', () => {
    const src = '$assigned = 5\n$param is { default: 10 }\n$assigned + $param'
    const params = ProgramParameters.list(parse(src))
    expect(params).toHaveLength(1)
    expect(params[0].name).toBe('param')
  })
})
