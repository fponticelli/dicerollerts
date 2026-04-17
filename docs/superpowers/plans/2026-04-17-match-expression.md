# Match Expression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `match { ... }` and `match VALUE { ... }` expression syntax to the dice scripting language. Supports guard mode, value mode, optional `if` guards on arms, and `_` wildcard.

**Architecture:** Add new AST node `MatchExpr`, extend parser to recognize `match` keyword and `_` token, evaluate by iterating arms top-to-bottom, and analyze probability by desugaring to nested `if-then-else` for the existing symbolic interpreter.

**Tech Stack:** TypeScript, Vitest, hand-written recursive descent parser

---

## Spec

Read first: `docs/superpowers/specs/2026-04-17-match-expression-design.md`

## File structure

| File                          | Change                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `src/program.ts`              | Add `MatchExpr`, `MatchArm`, `MatchPattern` types and factories        |
| `src/program-parser.ts`       | Add `match` keyword, `_` token, `->` arrow; implement `parseMatchExpr` |
| `src/evaluator.ts`            | Handle `match-expr` in `evalExpr`                                      |
| `src/program-stats.ts`        | Handle `match-expr` via desugar to if-expr in classifier and analyzer  |
| `src/index.ts`                | Export new types                                                       |
| `test/program-parser.spec.ts` | Parser tests                                                           |
| `test/evaluator.spec.ts`      | Evaluator tests                                                        |
| `test/program-stats.spec.ts`  | Analysis tests                                                         |

---

### Task 1: AST types

**Files:**

- Modify: `src/program.ts`

- [ ] **Step 1: Add types and factories**

In `src/program.ts`, add:

```ts
export interface MatchExpr {
  type: 'match-expr'
  value?: Expression
  arms: MatchArm[]
}

export interface MatchArm {
  pattern: MatchPattern
  guard?: Expression
  body: Expression
}

export type MatchPattern =
  | { kind: 'wildcard' }
  | { kind: 'expression'; expr: Expression }

export function matchExpr(
  value: Expression | undefined,
  arms: MatchArm[],
): MatchExpr {
  return { type: 'match-expr', value, arms }
}

export function matchArm(
  pattern: MatchPattern,
  body: Expression,
  guard?: Expression,
): MatchArm {
  return { pattern, body, guard }
}

export const wildcardPattern: MatchPattern = { kind: 'wildcard' }

export function expressionPattern(expr: Expression): MatchPattern {
  return { kind: 'expression', expr }
}
```

Update the `Expression` union to include `MatchExpr`:

```ts
export type Expression =
  | NumberLiteral
  | BooleanLiteral
  | StringLiteral
  | VariableRef
  | DiceExpr
  | BinaryExpr
  | UnaryExpr
  | IfExpr
  | RecordExpr
  | ArrayExpr
  | RepeatExpr
  | FieldAccess
  | IndexAccess
  | MatchExpr
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Update index.ts exports**

In `src/index.ts`, add to the program type exports:

```ts
export type { MatchExpr, MatchArm, MatchPattern } from './program'
```

And to the value exports:

```ts
export {
  matchExpr,
  matchArm,
  wildcardPattern,
  expressionPattern,
} from './program'
```

- [ ] **Step 4: Commit**

```bash
git add src/program.ts src/index.ts
git commit -m "feat: add MatchExpr AST types"
```

---

### Task 2: Parser - guard mode

**Files:**

- Modify: `src/program-parser.ts`
- Modify: `test/program-parser.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/program-parser.spec.ts`:

```ts
describe('match expression - guard mode', () => {
  test('basic guard ladder', () => {
    const r = ProgramParser.parse('match { $a -> 1, $b -> 2, _ -> 3 }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('match-expr')
        if (stmt.expr.type === 'match-expr') {
          expect(stmt.expr.value).toBeUndefined()
          expect(stmt.expr.arms).toHaveLength(3)
          expect(stmt.expr.arms[0].pattern.kind).toBe('expression')
          expect(stmt.expr.arms[2].pattern.kind).toBe('wildcard')
        }
      }
    }
  })

  test('newline-separated arms', () => {
    const r = ProgramParser.parse('match {\n  $a -> 1\n  $b -> 2\n  _ -> 3\n}')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'match-expr'
      ) {
        expect(stmt.expr.arms).toHaveLength(3)
      }
    }
  })

  test('trailing comma allowed', () => {
    const r = ProgramParser.parse('match { $a -> 1, _ -> 2, }')
    expect(r.success).toBe(true)
  })

  test('arm with guard', () => {
    const r = ProgramParser.parse('match { $a if $b -> 1, _ -> 2 }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'match-expr'
      ) {
        expect(stmt.expr.arms[0].guard).toBeDefined()
      }
    }
  })

  test('wildcard with guard', () => {
    const r = ProgramParser.parse('match { _ if $b -> 1, _ -> 2 }')
    expect(r.success).toBe(true)
  })

  test('empty match block is parse error', () => {
    const r = ProgramParser.parse('match { }')
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/program-parser.spec.ts -t "match expression"`
Expected: FAIL - parser doesn't recognize `match`

- [ ] **Step 3: Add `match` keyword to reserved set**

In `src/program-parser.ts`, find the `RESERVED` set and add `'match'`:

```ts
const RESERVED = new Set([
  'if',
  'then',
  'else',
  'true',
  'false',
  'and',
  'or',
  'not',
  'repeat',
  'is',
  'match', // NEW
])
```

Also add `_` to the record-key reserved check or handle it in `parseRecordField`.

- [ ] **Step 4: Add parseMatchExpr dispatch**

In `parsePrimary`, add a case for the `match` keyword. The check should be done before the identifier path so `match` is recognized as a keyword:

```ts
parsePrimary(): Expression {
  this.skipWhitespaceAndComments()

  // ...existing literal and parenthesis cases...

  if (this.matchKeyword('match')) {
    return this.parseMatchExpr()
  }

  // ...existing if/repeat/identifier dispatch...
}
```

- [ ] **Step 5: Implement parseMatchExpr (guard mode only for now)**

Add to the `Parser` class:

```ts
parseMatchExpr(): MatchExpr {
  this.skipWhitespaceAndComments()

  // Detect mode: if next char is '{', guard mode; else value mode (handled in next task)
  let value: Expression | undefined
  if (this.peek() !== '{') {
    value = this.parseExpression()
    this.skipWhitespaceAndComments()
  }

  this.expect('{')
  this.skipWhitespaceAndComments()

  const arms: MatchArm[] = []
  while (this.pos < this.input.length && this.peek() !== '}') {
    arms.push(this.parseMatchArm())
    this.skipWhitespaceAndComments()
    if (this.peek() === ',') {
      this.advance()
      this.skipWhitespaceAndComments()
    }
  }

  this.expect('}')

  if (arms.length === 0) {
    throw new Error(`match block cannot be empty at position ${this.pos}`)
  }

  return matchExpr(value, arms)
}

parseMatchArm(): MatchArm {
  // Parse pattern: '_' or expression
  let pattern: MatchPattern
  if (this.matchToken('_')) {
    pattern = wildcardPattern
  } else {
    const expr = this.parseExpression()
    pattern = expressionPattern(expr)
  }

  this.skipSpaces()

  // Optional 'if guard'
  let guard: Expression | undefined
  if (this.matchKeyword('if')) {
    this.skipSpaces()
    guard = this.parseExpression()
    this.skipSpaces()
  }

  // Required '->'
  this.expectToken('->')
  this.skipSpaces()

  const body = this.parseExpression()
  return matchArm(pattern, body, guard)
}
```

You'll need helpers:

```ts
matchToken(token: string): boolean {
  // Match an exact token (e.g., '_' or '->'); only succeeds if not followed by an identifier char (for word-like tokens)
  const saved = this.pos
  this.skipSpaces()
  if (this.input.startsWith(token, this.pos)) {
    const after = this.pos + token.length
    // For '_' specifically, check next char isn't an identifier char (so '_foo' doesn't match)
    if (token === '_' && after < this.input.length && /[a-zA-Z0-9_]/.test(this.input[after])) {
      this.pos = saved
      return false
    }
    this.pos = after
    return true
  }
  this.pos = saved
  return false
}

expectToken(token: string): void {
  if (!this.matchToken(token)) {
    throw new Error(`Expected '${token}' at position ${this.pos}`)
  }
}
```

For `'->'` matching, the simpler approach is to just check the literal characters since `->` doesn't have identifier-char concerns:

```ts
matchArrow(): boolean {
  this.skipSpaces()
  if (this.input.startsWith('->', this.pos)) {
    this.pos += 2
    return true
  }
  return false
}

expectArrow(): void {
  if (!this.matchArrow()) {
    throw new Error(`Expected '->' at position ${this.pos}`)
  }
}
```

Replace `this.expectToken('->')` with `this.expectArrow()`.

- [ ] **Step 6: Add imports**

At the top of `src/program-parser.ts`, ensure imports include:

```ts
import {
  // ...existing...
  matchExpr,
  matchArm,
  wildcardPattern,
  expressionPattern,
  type MatchExpr,
  type MatchArm,
  type MatchPattern,
} from './program'
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 8: Commit**

```bash
git add src/program-parser.ts test/program-parser.spec.ts
git commit -m "feat: parse match expression in guard mode"
```

---

### Task 3: Parser - value mode

**Files:**

- Modify: `test/program-parser.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/program-parser.spec.ts`:

```ts
describe('match expression - value mode', () => {
  test('basic value match', () => {
    const r = ProgramParser.parse('match $x { 1 -> "a", 2 -> "b", _ -> "c" }')
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'match-expr'
      ) {
        expect(stmt.expr.value).toBeDefined()
        expect(stmt.expr.arms).toHaveLength(3)
      }
    }
  })

  test('value match with guards', () => {
    const r = ProgramParser.parse(
      'match $weapon { "sword" if $crit -> 1, "sword" -> 2, _ -> 0 }',
    )
    expect(r.success).toBe(true)
    if (r.success) {
      const stmt = r.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'match-expr'
      ) {
        expect(stmt.expr.arms[0].guard).toBeDefined()
        expect(stmt.expr.arms[1].guard).toBeUndefined()
      }
    }
  })

  test('match with computed pattern', () => {
    const r = ProgramParser.parse('match $x { $base + 1 -> 1, _ -> 2 }')
    expect(r.success).toBe(true)
  })

  test('match value can be complex expression', () => {
    const r = ProgramParser.parse('match $a + $b { 5 -> "five", _ -> "other" }')
    expect(r.success).toBe(true)
  })

  test('match with dice pattern', () => {
    const r = ProgramParser.parse('match $x { `d6` -> 1, _ -> 2 }')
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/program-parser.spec.ts -t "match expression - value mode"`

These should already pass because `parseMatchExpr` already handles the value-mode case (parses an expression before `{`). If they don't, debug and fix.

- [ ] **Step 3: Commit**

```bash
git add test/program-parser.spec.ts
git commit -m "test: parse match expression in value mode"
```

---

### Task 4: Evaluator

**Files:**

- Modify: `src/evaluator.ts`
- Modify: `test/evaluator.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/evaluator.spec.ts`:

```ts
describe('match expression evaluation', () => {
  test('guard mode picks first true', () => {
    expect(run('match { false -> 1, true -> 2, _ -> 3 }')).toBe(2)
  })

  test('guard mode falls through to wildcard', () => {
    expect(run('match { false -> 1, false -> 2, _ -> 3 }')).toBe(3)
  })

  test('value mode picks matching pattern', () => {
    expect(run('match 2 { 1 -> "a", 2 -> "b", _ -> "c" }')).toBe('b')
  })

  test('value mode falls through', () => {
    expect(run('match 5 { 1 -> "a", 2 -> "b", _ -> "c" }')).toBe('c')
  })

  test('value mode with guard', () => {
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

  test('variable pattern', () => {
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/evaluator.spec.ts -t "match expression"`
Expected: FAIL - evaluator doesn't handle match-expr

- [ ] **Step 3: Add match-expr handling**

In `src/evaluator.ts`, add a case to `evalExpr`:

```ts
case 'match-expr': {
  const matched = expr.value !== undefined
    ? this.evalExpr(expr.value, env)
    : undefined

  for (const arm of expr.arms) {
    if (this.armFires(arm, matched, env)) {
      return this.evalExpr(arm.body, env)
    }
  }

  throw new Error('No match arm fired')
}
```

Add the helper method:

```ts
private armFires(
  arm: MatchArm,
  matched: Value | undefined,
  env: Environment,
): boolean {
  // Check pattern
  let patternMatches: boolean
  if (arm.pattern.kind === 'wildcard') {
    patternMatches = true
  } else {
    const patternValue = this.evalExpr(arm.pattern.expr, env)
    if (matched === undefined) {
      // guard mode: pattern is a boolean
      patternMatches = this.toBoolean(patternValue)
    } else {
      // value mode: equality check
      patternMatches = this.valuesEqual(matched, patternValue)
    }
  }

  if (!patternMatches) return false

  // Check optional guard
  if (arm.guard !== undefined) {
    const guardValue = this.evalExpr(arm.guard, env)
    if (!this.toBoolean(guardValue)) return false
  }

  return true
}

private valuesEqual(a: Value, b: Value): boolean {
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a === 'object') {
    // Records and arrays - structural equality not supported in == elsewhere
    // For match, just use reference equality (which won't match - acceptable)
    return false
  }
  return a === b
}

private toBoolean(value: Value): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.length > 0
  return true  // records and arrays are truthy
}
```

If `toBoolean` already exists in the evaluator (likely for if-expr), reuse it. Same for value equality (binary-op `==` handler).

Add imports:

```ts
import type { MatchArm } from './program'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/evaluator.ts test/evaluator.spec.ts
git commit -m "feat: evaluate match expressions"
```

---

### Task 5: Probability analysis via desugar

**Files:**

- Modify: `src/program-stats.ts`
- Modify: `test/program-stats.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/program-stats.spec.ts`:

```ts
describe('match expression analysis', () => {
  test('constant guard match is constant', () => {
    const prog = parseProgram('match { true -> 1, _ -> 2 }')
    expect(ProgramStats.classify(prog)).toBe('constant')
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'number') {
      expect(result.stats.mean).toBe(1)
    }
  })

  test('match on dice produces correct distribution', () => {
    const prog = parseProgram(`
match \`d6\` {
  1 -> "one"
  2 -> "two"
  _ -> "other"
}
`)
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('one')).toBeCloseTo(1 / 6, 2)
      expect(result.stats.frequencies.get('two')).toBeCloseTo(1 / 6, 2)
      expect(result.stats.frequencies.get('other')).toBeCloseTo(4 / 6, 2)
    }
  })

  test('match guard mode probability', () => {
    const prog = parseProgram(`
$x = \`d6\`
match {
  $x >= 5 -> "high"
  $x >= 3 -> "mid"
  _ -> "low"
}
`)
    const result = ProgramStats.analyze(prog)
    if (result.stats.type === 'string') {
      expect(result.stats.frequencies.get('high')).toBeCloseTo(2 / 6, 2)
      expect(result.stats.frequencies.get('mid')).toBeCloseTo(2 / 6, 2)
      expect(result.stats.frequencies.get('low')).toBeCloseTo(2 / 6, 2)
    }
  })

  test('match with discriminated record output', () => {
    const prog = parseProgram(`
$attack = \`d20\`
match {
  $attack >= 11 -> { kind: "hit", attack: $attack }
  _ -> { kind: "miss", attack: $attack }
}
`)
    const result = ProgramStats.analyze(prog)
    expect(result.stats.type).toBe('discriminated')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/program-stats.spec.ts -t "match expression analysis"`

- [ ] **Step 3: Add desugar helper**

In `src/program-stats.ts`, add a function that converts a `MatchExpr` to an equivalent `IfExpr` chain. This lets the existing if-expr machinery handle classification and analysis.

```ts
import type { MatchExpr, MatchArm, IfExpr, Expression } from './program'
import { ifExpr, binaryExpr, booleanLiteral } from './program'

function desugarMatch(expr: MatchExpr): Expression {
  // Build nested if-then-else from arms (right-to-left)
  // Last arm becomes the deepest else; earlier arms wrap it

  // Default fallthrough: throw at runtime
  // Represented as a synthetic "no-arm" expression
  // For analysis purposes, we use a placeholder; runtime evaluator handles the throw separately
  let elseBranch: Expression = {
    type: 'no-match-fallthrough' as any, // synthetic; never actually evaluated when wildcard exists
  } as Expression

  // Walk arms in reverse to build nested if-else
  for (let i = expr.arms.length - 1; i >= 0; i--) {
    const arm = expr.arms[i]
    const condition = buildArmCondition(arm, expr.value)
    elseBranch = ifExpr(condition, arm.body, elseBranch)
  }

  return elseBranch
}

function buildArmCondition(
  arm: MatchArm,
  matchValue: Expression | undefined,
): Expression {
  let cond: Expression
  if (arm.pattern.kind === 'wildcard') {
    cond = booleanLiteral(true)
  } else if (matchValue === undefined) {
    // Guard mode: pattern is a boolean
    cond = arm.pattern.expr
  } else {
    // Value mode: pattern == matchValue
    cond = binaryExpr('eq', matchValue, arm.pattern.expr)
  }

  if (arm.guard !== undefined) {
    cond = binaryExpr('and', cond, arm.guard)
  }

  return cond
}
```

Then in the classifier and analyzer, when encountering a `match-expr`, desugar it first and recursively classify/analyze the resulting if-expr chain:

```ts
case 'match-expr': {
  const desugared = desugarMatch(expr)
  return classifyExpression(desugared, ...) // or analyzeExpr(desugared, ...)
}
```

Add this case to:

- `classifyExpression` (or wherever expressions are classified)
- `analyzeExpr` (the symbolic interpreter)
- The Monte Carlo evaluator path (already works via the runtime evaluator, which now handles `match-expr` from Task 4)

Note: the synthetic "no-match-fallthrough" expression needs to be handled. Since most match expressions have a `_` catchall, the no-fallthrough case is rare. For exact analysis, treat it as having zero probability mass (so the chain effectively terminates at the last `_` branch). For Monte Carlo, the runtime evaluator already throws.

**Simpler approach**: instead of a synthetic node, find the last arm's index and treat that arm as the unconditional default if it's a wildcard without guard. Otherwise, the chain ends with `if cond then body else <error>`. For analysis purposes, the error path means the match isn't exhaustive; if the analyzer can't prove the wildcard exists, fall back to MC.

Actually the cleanest: in `desugarMatch`, check if the last arm is `_` without a guard. If so, that arm is the elseBranch directly (no wrapping condition). If not, the elseBranch is a synthetic error expression that signals "no exhaustive coverage".

```ts
function desugarMatch(expr: MatchExpr): Expression | null {
  if (expr.arms.length === 0) return null

  // Find the last unconditional wildcard arm; use it as the default
  const lastArm = expr.arms[expr.arms.length - 1]
  const hasUnconditionalDefault =
    lastArm.pattern.kind === 'wildcard' && lastArm.guard === undefined

  if (!hasUnconditionalDefault) {
    // No exhaustive coverage - fall back to MC for analysis
    return null
  }

  let elseBranch: Expression = lastArm.body

  // Walk preceding arms in reverse
  for (let i = expr.arms.length - 2; i >= 0; i--) {
    const arm = expr.arms[i]
    const condition = buildArmCondition(arm, expr.value)
    elseBranch = ifExpr(condition, arm.body, elseBranch)
  }

  return elseBranch
}
```

If `desugarMatch` returns null (no default), the classifier/analyzer falls back to MC.

- [ ] **Step 4: Wire desugar into classifier and analyzer**

In `classifyExpression`, add:

```ts
case 'match-expr': {
  const desugared = desugarMatch(expr)
  if (desugared === null) return 'monte-carlo'
  return classifyExpression(desugared, env, varUseCount, randomVars)
}
```

In `analyzeExpr`, add the same dispatch.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/program-stats.ts test/program-stats.spec.ts
git commit -m "feat: analyze match expressions via desugar to if-expr"
```

---

### Task 6: Final verification and README update

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Run all checks**

Run: `npm run verify`
Expected: All tests pass, no lint/format/type errors.

- [ ] **Step 2: Update README**

In `README.md`, find the "Language features" section and add:

```
- `match { pattern -> body, ... }` and `match VALUE { pattern -> body, ... }` for guard ladders and value dispatch
- Wildcard `_` and optional `if guard` clauses on match arms
```

Add a new subsection after "if/then/else" or alongside it:

```markdown
### Match expressions

Replace nested if-else chains with a flat form:
```

$damage = match {
$crit -> `4d6 + 1d4 + 4`
$hit -> `2d6 + 4`
\_ -> 0
}

$roll = match $roll*mode {
"advantage" -> `2d20 keep highest 1`
"disadvantage" -> `2d20 keep lowest 1`
* -> `d20`
}

$damage = match $weapon {
"sword" if $crit -> `4d6`
"sword" -> `2d6`
"dagger" if $crit -> `2d4`
"dagger" -> `1d4`
\_ -> 0
}

```

- Two modes: guard ladder (no value after `match`) or value dispatch (value after `match`)
- Each arm: `pattern -> body` or `pattern if guard -> body`
- `_` is the wildcard (matches anything)
- First matching arm wins
- A trailing `_ -> default` is recommended (otherwise non-matching trials throw)
```

- [ ] **Step 3: Run prettier and verify again**

Run: `npx prettier --write README.md && npm run verify`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document match expression"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```
