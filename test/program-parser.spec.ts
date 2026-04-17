import { ProgramParser } from '../src/program-parser'

describe('program parser - literals', () => {
  test('number literal', () => {
    const result = ProgramParser.parse('42')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr).toEqual({ type: 'number-literal', value: 42 })
    }
  })

  test('boolean true', () => {
    const result = ProgramParser.parse('true')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr).toEqual({ type: 'boolean-literal', value: true })
    }
  })

  test('boolean false', () => {
    const result = ProgramParser.parse('false')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr).toEqual({ type: 'boolean-literal', value: false })
    }
  })

  test('string literal', () => {
    const result = ProgramParser.parse('"hello world"')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr).toEqual({
          type: 'string-literal',
          value: 'hello world',
        })
    }
  })
})

describe('program parser - variables', () => {
  test('variable reference', () => {
    const result = ProgramParser.parse('$foo')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr).toEqual({ type: 'variable-ref', name: 'foo' })
    }
  })

  test('variable assignment', () => {
    const result = ProgramParser.parse('$x = 5')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements[0]).toEqual({
        type: 'assignment',
        name: 'x',
        value: { type: 'number-literal', value: 5 },
      })
    }
  })

  test('multiple statements', () => {
    const result = ProgramParser.parse('$x = 5\n$x')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(2)
    }
  })

  test('comments are ignored', () => {
    const result = ProgramParser.parse('# comment\n$x = 5\n$x # inline')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(2)
    }
  })
})

describe('program parser - arithmetic', () => {
  test('precedence: mul before add', () => {
    const result = ProgramParser.parse('2 + 3 * 4')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      ) {
        expect(stmt.expr.op).toBe('add')
        if (stmt.expr.right.type === 'binary-expr')
          expect(stmt.expr.right.op).toBe('multiply')
      }
    }
  })

  test('parenthesized expression', () => {
    const result = ProgramParser.parse('(2 + 3) * 4')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      )
        expect(stmt.expr.op).toBe('multiply')
    }
  })

  test('comparison operators', () => {
    const cases = [
      { input: '$x >= 5', op: 'gte' },
      { input: '$x <= 5', op: 'lte' },
      { input: '$x == 5', op: 'eq' },
      { input: '$x != 5', op: 'neq' },
      { input: '$x > 5', op: 'gt' },
      { input: '$x < 5', op: 'lt' },
    ]
    for (const { input, op } of cases) {
      const result = ProgramParser.parse(input)
      expect(result.success).toBe(true)
      if (result.success) {
        const stmt = result.program.statements[0]
        if (
          stmt.type === 'expression-statement' &&
          stmt.expr.type === 'binary-expr'
        )
          expect(stmt.expr.op).toBe(op)
      }
    }
  })

  test('boolean operators', () => {
    const result = ProgramParser.parse('$a and $b or $c')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      )
        expect(stmt.expr.op).toBe('or') // or has lower precedence
    }
  })
})

describe('program parser - dice expressions', () => {
  test('backtick dice expression', () => {
    const result = ProgramParser.parse('`3d6 + 5`')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr.type).toBe('dice-expr')
    }
  })

  test('dice expression source preserved', () => {
    const result = ProgramParser.parse('`3d6 + 5`')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'dice-expr'
      )
        expect(stmt.expr.source).toBe('3d6 + 5')
    }
  })

  test('dice with variable', () => {
    const result = ProgramParser.parse('`d20 + $mod`')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'dice-expr'
      )
        expect(stmt.expr.source).toBe('d20 + $mod')
    }
  })
})

describe('program parser - arrays', () => {
  test('array literal', () => {
    const result = ProgramParser.parse('[1, 2, 3]')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'array-expr'
      )
        expect(stmt.expr.elements).toHaveLength(3)
    }
  })

  test('empty array', () => {
    const result = ProgramParser.parse('[]')
    expect(result.success).toBe(true)
  })

  test('array indexing', () => {
    const result = ProgramParser.parse('$arr[0]')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr.type).toBe('index-access')
    }
  })
})

describe('program parser - records', () => {
  test('record literal', () => {
    const result = ProgramParser.parse('{ name: "test", value: 42 }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'record-expr'
      ) {
        expect(stmt.expr.fields).toHaveLength(2)
        expect(stmt.expr.fields[0].key).toBe('name')
      }
    }
  })

  test('record shorthand', () => {
    const result = ProgramParser.parse('{ $attack, $damage }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'record-expr'
      ) {
        expect(stmt.expr.fields[0].key).toBe('attack')
        expect(stmt.expr.fields[0].value).toEqual({
          type: 'variable-ref',
          name: 'attack',
        })
      }
    }
  })

  test('field access', () => {
    const result = ProgramParser.parse('$obj.name')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement')
        expect(stmt.expr.type).toBe('field-access')
    }
  })
})

describe('program parser - if', () => {
  test('if then else', () => {
    const result = ProgramParser.parse('if true then 1 else 0')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'if-expr'
      ) {
        expect(stmt.expr.condition).toEqual({
          type: 'boolean-literal',
          value: true,
        })
        expect(stmt.expr.then).toEqual({ type: 'number-literal', value: 1 })
        expect(stmt.expr.else).toEqual({ type: 'number-literal', value: 0 })
      }
    }
  })

  test('nested if', () => {
    const result = ProgramParser.parse(
      'if true then 1 else if false then 2 else 3',
    )
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement' && stmt.expr.type === 'if-expr')
        expect(stmt.expr.else.type).toBe('if-expr')
    }
  })
})

describe('program parser - repeat', () => {
  test('repeat block', () => {
    const result = ProgramParser.parse('repeat 3 { 42 }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'repeat-expr'
      ) {
        expect(stmt.expr.count).toEqual({ type: 'number-literal', value: 3 })
        expect(stmt.expr.body).toHaveLength(1)
      }
    }
  })

  test('repeat with multi-statement body', () => {
    const result = ProgramParser.parse('repeat 3 {\n$x = `d6`\n$x\n}')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'repeat-expr'
      )
        expect(stmt.expr.body).toHaveLength(2)
    }
  })
})

describe('program parser - multi-line if', () => {
  test('multi-line if/then/else', () => {
    const input = `if true\n  then 1\n  else 0`
    const result = ProgramParser.parse(input)
    expect(result.success).toBe(true)
  })
})

describe('program parser - reserved words', () => {
  test('reserved word as record key fails', () => {
    const result = ProgramParser.parse('{ if: 1 }')
    expect(result.success).toBe(false)
  })
})

describe('program parser - string escapes', () => {
  test('string escape sequences', () => {
    const result = ProgramParser.parse('"hello\\nworld"')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'string-literal'
      )
        expect(stmt.expr.value).toBe('hello\nworld')
    }
  })

  test('string with escaped quote', () => {
    const result = ProgramParser.parse('"say \\"hi\\""')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'string-literal'
      )
        expect(stmt.expr.value).toBe('say "hi"')
    }
  })
})

describe('program parser - dice variable collision', () => {
  test('dice variable used twice', () => {
    const result = ProgramParser.parse('`$mod + $mod`')
    expect(result.success).toBe(true)
  })
})

describe('program parser - full programs', () => {
  test('attack roll program', () => {
    const input = `$str_mod = 5
$ac = 15
$attack = \`d20 + $str_mod\`
$hit = $attack >= $ac
$damage = if $hit then \`2d6 + $str_mod\` else 0
{ attack: $attack, damage: $damage }`
    const result = ProgramParser.parse(input)
    expect(result.success).toBe(true)
    if (result.success) expect(result.program.statements).toHaveLength(6)
  })

  test('parse error', () => {
    const result = ProgramParser.parse('$x = ')
    expect(result.success).toBe(false)
  })
})

describe('parameter declarations', () => {
  test('basic number parameter', () => {
    const r = ProgramParser.parse('$x is { default: 5 }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      expect(stmt.type).toBe('parameter-declaration')
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.name).toBe('x')
        expect(stmt.spec.default).toEqual({ kind: 'value', value: 5 })
      }
    }
  })

  test('full parameter with metadata', () => {
    const r = ProgramParser.parse(
      '$x is { default: 5, min: 0, max: 10, label: "X", description: "..." }',
    )
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.spec.min).toBe(0)
        expect(stmt.spec.max).toBe(10)
        expect(stmt.spec.label).toBe('X')
        expect(stmt.spec.description).toBe('...')
      }
    }
  })

  test('boolean default', () => {
    const r = ProgramParser.parse('$x is { default: true }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.spec.default).toEqual({ kind: 'value', value: true })
      }
    }
  })

  test('false boolean default', () => {
    const r = ProgramParser.parse('$x is { default: false }')
    expect(r.success).toBe(true)
  })

  test('negative number default', () => {
    const r = ProgramParser.parse('$x is { default: -3 }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.spec.default).toEqual({ kind: 'value', value: -3 })
      }
    }
  })

  test('string default with enum', () => {
    const r = ProgramParser.parse(
      '$x is { default: "a", enum: ["a", "b", "c"] }',
    )
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.spec.enum).toEqual(['a', 'b', 'c'])
      }
    }
  })

  test('dice expression default', () => {
    const r = ProgramParser.parse('$x is { default: `d6` }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'parameter-declaration') {
        expect(stmt.spec.default.kind).toBe('dice')
        if (stmt.spec.default.kind === 'dice') {
          expect(stmt.spec.default.source).toBe('d6')
        }
      }
    }
  })

  test('trailing comma allowed', () => {
    const r = ProgramParser.parse('$x is { default: 5, }')
    expect(r.success).toBe(true)
  })

  test('multiline parameter declaration', () => {
    const r = ProgramParser.parse(
      `$x is {
  default: 5,
  min: 0,
  max: 10,
}`,
    )
    expect(r.success).toBe(true)
  })

  test('rejects missing default', () => {
    const r = ProgramParser.parse('$x is { label: "X" }')
    expect(r.success).toBe(false)
  })

  test('rejects unknown field', () => {
    const r = ProgramParser.parse('$x is { default: 5, foo: "bar" }')
    expect(r.success).toBe(false)
  })

  test('rejects min on string default', () => {
    const r = ProgramParser.parse('$x is { default: "a", min: 0 }')
    expect(r.success).toBe(false)
  })

  test('rejects min on boolean default', () => {
    const r = ProgramParser.parse('$x is { default: true, min: 0 }')
    expect(r.success).toBe(false)
  })

  test('rejects enum on number', () => {
    const r = ProgramParser.parse('$x is { default: 5, enum: [1, 2, 3] }')
    expect(r.success).toBe(false)
  })

  test('rejects default not in enum', () => {
    const r = ProgramParser.parse('$x is { default: "z", enum: ["a", "b"] }')
    expect(r.success).toBe(false)
  })

  test('rejects default out of range (above max)', () => {
    const r = ProgramParser.parse('$x is { default: 50, min: 0, max: 10 }')
    expect(r.success).toBe(false)
  })

  test('rejects default out of range (below min)', () => {
    const r = ProgramParser.parse('$x is { default: -5, min: 0, max: 10 }')
    expect(r.success).toBe(false)
  })

  test('rejects min > max', () => {
    const r = ProgramParser.parse('$x is { default: 5, min: 10, max: 0 }')
    expect(r.success).toBe(false)
  })

  test('rejects label not a string', () => {
    const r = ProgramParser.parse('$x is { default: 5, label: 42 }')
    expect(r.success).toBe(false)
  })

  test('rejects description not a string', () => {
    const r = ProgramParser.parse('$x is { default: 5, description: 42 }')
    expect(r.success).toBe(false)
  })

  test('rejects enum mixed types', () => {
    const r = ProgramParser.parse(
      '$x is { default: "a", enum: ["a", 5, true] }',
    )
    expect(r.success).toBe(false)
  })

  test('parameter then expression', () => {
    const r = ProgramParser.parse('$x is { default: 5 }\n$x + 3')
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.program.statements).toHaveLength(2)
    }
  })

  test('is is reserved as record key', () => {
    const r = ProgramParser.parse('{ is: 1 }')
    expect(r.success).toBe(false)
  })

  test('dice expression default with arithmetic', () => {
    const r = ProgramParser.parse('$x is { default: `2d6 + 1` }')
    expect(r.success).toBe(true)
  })
})
