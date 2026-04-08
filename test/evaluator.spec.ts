import { ProgramParser } from '../src/program-parser'
import { Evaluator } from '../src/evaluator'
import type { Value } from '../src/program'

function run(input: string, rollFn?: (max: number) => number): Value {
  const result = ProgramParser.parse(input)
  if (!result.success)
    throw new Error('Parse failed: ' + result.errors[0].message)
  const evaluator = new Evaluator(rollFn ?? ((max) => max))
  return evaluator.run(result.program)
}

describe('evaluator - literals', () => {
  test('number', () => expect(run('42')).toBe(42))
  test('boolean', () => expect(run('true')).toBe(true))
  test('string', () => expect(run('"hello"')).toBe('hello'))
  test('negative', () => expect(run('-5')).toBe(-5))
})

describe('evaluator - arithmetic', () => {
  test('addition', () => expect(run('2 + 3')).toBe(5))
  test('subtraction', () => expect(run('10 - 3')).toBe(7))
  test('multiplication', () => expect(run('4 * 5')).toBe(20))
  test('division', () => expect(run('10 / 3')).toBe(3))
  test('precedence', () => expect(run('2 + 3 * 4')).toBe(14))
  test('parentheses', () => expect(run('(2 + 3) * 4')).toBe(20))
})

describe('evaluator - comparison', () => {
  test('>=', () => expect(run('5 >= 3')).toBe(true))
  test('<', () => expect(run('5 < 3')).toBe(false))
  test('==', () => expect(run('5 == 5')).toBe(true))
  test('!=', () => expect(run('5 != 3')).toBe(true))
})

describe('evaluator - boolean', () => {
  test('and', () => expect(run('true and false')).toBe(false))
  test('or', () => expect(run('true or false')).toBe(true))
  test('not', () => expect(run('not true')).toBe(false))
  test('boolean coercion in arithmetic', () => expect(run('true + 1')).toBe(2))
  test('boolean coercion false', () => expect(run('false * 10')).toBe(0))
})

describe('evaluator - strings', () => {
  test('concatenation', () =>
    expect(run('"hello" + " world"')).toBe('hello world'))
})

describe('evaluator - variables', () => {
  test('assignment and reference', () => expect(run('$x = 5\n$x + 3')).toBe(8))
  test('immutability error', () => {
    expect(() => run('$x = 5\n$x = 10')).toThrow()
  })
  test('undefined variable error', () => {
    expect(() => run('$y')).toThrow()
  })
})

describe('evaluator - if', () => {
  test('true branch', () => expect(run('if true then 1 else 0')).toBe(1))
  test('false branch', () => expect(run('if false then 1 else 0')).toBe(0))
  test('nested if', () =>
    expect(run('if false then 1 else if true then 2 else 3')).toBe(2))
  test('conditional with variable', () => {
    expect(run('$x = 10\nif $x >= 5 then "big" else "small"')).toBe('big')
  })
})

describe('evaluator - records', () => {
  test('record creation', () => {
    expect(run('{ a: 1, b: 2 }')).toEqual({ a: 1, b: 2 })
  })
  test('field access', () => {
    expect(run('$r = { x: 42 }\n$r.x')).toBe(42)
  })
  test('record shorthand', () => {
    expect(run('$a = 1\n$b = 2\n{ $a, $b }')).toEqual({ a: 1, b: 2 })
  })
})

describe('evaluator - arrays', () => {
  test('array creation', () => {
    expect(run('[1, 2, 3]')).toEqual([1, 2, 3])
  })
  test('index access', () => {
    expect(run('$arr = [10, 20, 30]\n$arr[1]')).toBe(20)
  })
  test('index out of bounds', () => {
    expect(() => run('$arr = [1]\n$arr[5]')).toThrow()
  })
})

describe('evaluator - repeat', () => {
  test('repeat produces array', () => {
    expect(run('repeat 3 { 42 }')).toEqual([42, 42, 42])
  })
  test('repeat with dice', () => {
    expect(run('repeat 4 { `d6` }', () => 3)).toEqual([3, 3, 3, 3])
  })
  test('repeat with multi-statement body', () => {
    expect(run('repeat 2 {\n$x = 10\n$x + 1\n}')).toEqual([11, 11])
  })
  test('repeat scoping', () => {
    expect(run('repeat 2 { $x = 5\n$x }')).toEqual([5, 5])
  })
  test('repeat with variable count', () => {
    expect(run('$n = 3\nrepeat $n { 1 }')).toEqual([1, 1, 1])
  })
})

describe('evaluator - dice expressions', () => {
  test('simple dice roll', () => {
    expect(run('`d6`', () => 4)).toBe(4)
  })
  test('dice with variable substitution', () => {
    expect(run('$mod = 5\n`d20 + $mod`', () => 10)).toBe(15)
  })
})

describe('evaluator - repeat limits', () => {
  test('repeat limit exceeded throws', () => {
    const result = ProgramParser.parse('repeat 100000 { 1 }')
    if (!result.success) throw new Error('Parse failed')
    const evaluator = new Evaluator(() => 1)
    expect(() => evaluator.run(result.program)).toThrow(/exceeds maximum/)
  })

  test('repeat negative count throws', () => {
    expect(() => run('repeat -1 { 1 }')).toThrow()
  })

  test('custom repeat limit', () => {
    const result = ProgramParser.parse('repeat 5 { 1 }')
    if (!result.success) throw new Error('Parse failed')
    const evaluator = new Evaluator(() => 1, { maxRepeatIterations: 3 })
    expect(() => evaluator.run(result.program)).toThrow()
  })
})

describe('evaluator - full programs', () => {
  test('attack roll', () => {
    const result = run(
      `$str_mod = 5
$ac = 15
$attack = \`d20 + $str_mod\`
$hit = $attack >= $ac
$damage = if $hit then \`2d6 + $str_mod\` else 0
{ attack: $attack, hit: $hit, damage: $damage }`,
      () => 15,
    ) as Record<string, Value>
    expect(result.attack).toBe(20)
    expect(result.hit).toBe(true)
    expect(typeof result.damage).toBe('number')
    expect(result.damage).toBeGreaterThan(0)
  })
})
