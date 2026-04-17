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

function runWithParams(
  input: string,
  params: Record<string, Value>,
  rollFn?: (max: number) => number,
): Value {
  const result = ProgramParser.parse(input)
  if (!result.success)
    throw new Error('Parse failed: ' + result.errors[0].message)
  const evaluator = new Evaluator(rollFn ?? ((max) => max))
  return evaluator.run(result.program, { parameters: params })
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

describe('evaluator - parameters', () => {
  test('uses default when no override', () => {
    const result = run('$x is { default: 5 }\n$x + 3')
    expect(result).toBe(8)
  })

  test('override replaces default', () => {
    const result = runWithParams('$x is { default: 5 }\n$x + 3', { x: 10 })
    expect(result).toBe(13)
  })

  test('dice expression default rolls', () => {
    const result = run('$x is { default: `d6` }\n$x', () => 4)
    expect(result).toBe(4)
  })

  test('dice expression override is constant', () => {
    const result = runWithParams('$x is { default: `d6` }\n$x', { x: 99 })
    expect(result).toBe(99)
  })

  test('unknown parameter throws', () => {
    expect(() => runWithParams('$x is { default: 5 }\n$x', { y: 7 })).toThrow()
  })

  test('type mismatch throws', () => {
    expect(() =>
      runWithParams('$x is { default: 5 }\n$x', { x: 'wrong' }),
    ).toThrow()
  })

  test('out of range throws', () => {
    expect(() =>
      runWithParams('$x is { default: 5, min: 0, max: 10 }\n$x', { x: 20 }),
    ).toThrow()
  })

  test('not in enum throws', () => {
    expect(() =>
      runWithParams('$x is { default: "a", enum: ["a", "b"] }\n$x', { x: 'z' }),
    ).toThrow()
  })

  test('boolean parameter', () => {
    const result = runWithParams(
      '$x is { default: false }\nif $x then 1 else 0',
      { x: true },
    )
    expect(result).toBe(1)
  })

  test('string parameter', () => {
    const result = runWithParams(
      '$x is { default: "a", enum: ["a", "b", "c"] }\n$x',
      { x: 'b' },
    )
    expect(result).toBe('b')
  })

  test('parameter used in dice expression', () => {
    const result = run('$mod is { default: 3 }\n`d6 + $mod`', () => 4)
    expect(result).toBe(7)
  })

  test('parameter override used in dice expression', () => {
    const result = runWithParams(
      '$mod is { default: 0 }\n`d6 + $mod`',
      { mod: 5 },
      () => 4,
    )
    expect(result).toBe(9)
  })

  test('reassigning parameter via assignment throws', () => {
    expect(() => run('$x is { default: 5 }\n$x = 10')).toThrow()
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

describe('evaluator - match expression', () => {
  test('guard mode picks first true', () => {
    expect(run('match { false -> 1, true -> 2, _ -> 3 }')).toBe(2)
  })

  test('guard mode falls through to wildcard', () => {
    expect(run('match { false -> 1, false -> 2, _ -> 3 }')).toBe(3)
  })

  test('value mode picks matching pattern', () => {
    expect(run('match 2 { 1 -> "a", 2 -> "b", _ -> "c" }')).toBe('b')
  })

  test('value mode falls through to wildcard', () => {
    expect(run('match 5 { 1 -> "a", 2 -> "b", _ -> "c" }')).toBe('c')
  })

  test('value mode with guard fires when guard true', () => {
    const result = run(`
$crit = true
match "sword" {
  "sword" if $crit -> "crit hit"
  "sword" -> "normal hit"
  _ -> "miss"
}
`)
    expect(result).toBe('crit hit')
  })

  test('value mode with guard skips when guard false', () => {
    const result = run(`
$crit = false
match "sword" {
  "sword" if $crit -> "crit hit"
  "sword" -> "normal hit"
  _ -> "miss"
}
`)
    expect(result).toBe('normal hit')
  })

  test('wildcard with guard', () => {
    expect(
      run(`
$x = 15
match $x {
  20 -> "twenty"
  _ if $x > 10 -> "big"
  _ -> "small"
}
`),
    ).toBe('big')
  })

  test('no matching arm throws', () => {
    expect(() => run('match 5 { 1 -> "a" }')).toThrow()
  })

  test('match in assignment', () => {
    const result = run(`
$x = 3
$y = match $x {
  1 -> 10
  2 -> 20
  3 -> 30
  _ -> 0
}
$y
`)
    expect(result).toBe(30)
  })

  test('variable as pattern', () => {
    const result = run(`
$y = 5
match 5 {
  $y -> "matched y"
  _ -> "no"
}
`)
    expect(result).toBe('matched y')
  })

  test('computed pattern', () => {
    const result = run(`
$base = 4
match 5 {
  $base + 1 -> "yes"
  _ -> "no"
}
`)
    expect(result).toBe('yes')
  })

  test('guard mode with redundant if guard', () => {
    const result = run(`
$flag = true
match {
  $flag if false -> "no"
  $flag -> "yes"
  _ -> "fallback"
}
`)
    expect(result).toBe('yes')
  })

  test('boolean equality in value mode', () => {
    expect(run('match true { false -> 0, true -> 1, _ -> 2 }')).toBe(1)
  })

  test('string match', () => {
    expect(
      run(
        'match "advantage" { "advantage" -> 1, "disadvantage" -> 2, _ -> 0 }',
      ),
    ).toBe(1)
  })
})
