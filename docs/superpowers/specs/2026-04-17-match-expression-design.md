# Match Expression Design Spec

## Overview

Add a `match` expression to the dice scripting language. Replaces nested `if/then/else if/then/else` chains with a flat, readable form. Supports both guard-based dispatch (boolean conditions) and value-based dispatch (matching a value against patterns), with optional guards on each arm.

`if/then/else` remains unchanged.

## Examples

### Guard mode (no value to match)

```
$damage = match {
  $crit -> `4d6 + 1d4 + 4`
  $hit  -> `2d6 + 4`
  _     -> 0
}
```

### Value mode (match a single value)

```
$roll = match $roll_mode {
  "advantage"    -> `2d20 keep highest 1`
  "disadvantage" -> `2d20 keep lowest 1`
  _              -> `d20`
}
```

### Value mode with guards

```
$damage = match $weapon {
  "sword" if $crit  -> `4d6`
  "sword"           -> `2d6`
  "dagger" if $crit -> `2d4`
  "dagger"          -> `1d4`
  _                 -> 0
}
```

### Guarded catch-all

```
$tier = match $score {
  20 -> "natural twenty"
  1  -> "natural one"
  _ if $score >= 18 -> "high"
  _ if $score >= 10 -> "mid"
  _                  -> "low"
}
```

## Syntax

```
match-expr   = "match" [ value-expr ] "{" arm { sep arm } "}"
arm          = arm-pattern [ "if" guard-expr ] "->" body-expr
arm-pattern  = expression | "_"
sep          = newline | ","
```

- `match` is a new reserved keyword
- `_` is a new reserved token (wildcard pattern)
- `->` is a new arrow token (used only inside match arms)
- Arms are separated by newlines or commas; trailing separator allowed
- Each arm is `pattern -> body` or `pattern if guard -> body`

`else` is NOT used inside match. The catch-all is `_`.

## Modes

Mode is determined by whether a `value-expr` appears between `match` and `{`:

- **Guard mode**: `match { ... }` (no value)
- **Value mode**: `match VALUE { ... }`

The mode determines how each arm's pattern is interpreted.

## Semantics

Arms are evaluated top-to-bottom. The first arm that fires wins; subsequent arms are not evaluated.

### Guard mode

Pattern is a boolean expression directly. The arm fires when the pattern evaluates to true.

- `EXPR -> RESULT` -- fires if `EXPR` is truthy
- `_ -> RESULT` -- always fires (catchall)
- `_ if GUARD -> RESULT` -- fires if `GUARD` is true (`_` is a placeholder)
- `EXPR if GUARD -> RESULT` -- fires if `EXPR and GUARD` are both true (`if` clause is redundant in guard mode but allowed for symmetry)

### Value mode

Pattern is any expression. The arm fires when `value == pattern` (using the same equality semantics as the `==` operator).

- `EXPR -> RESULT` -- fires if `value == EXPR`
- `EXPR if GUARD -> RESULT` -- fires if `value == EXPR` AND `GUARD` is true
- `_ -> RESULT` -- always fires (catchall, ignores value)
- `_ if GUARD -> RESULT` -- fires if `GUARD` is true (catchall with extra check)

### Truthy semantics

Same as elsewhere in the language:

- `true` is truthy; `false` is falsy
- Numbers: `0` is falsy, all others truthy (existing convention from `if/then/else`)
- Strings: empty string is falsy, all others truthy
- Records, arrays: always truthy

### Pattern evaluation

In value mode, patterns are arbitrary expressions evaluated independently per arm-check:

- `match $x { 5 -> ... }` -- pattern is the literal 5
- `match $x { $y -> ... }` -- pattern is the current value of `$y`
- `match $x { $base + 1 -> ... }` -- pattern is computed
- `match $x { `d6` -> ... }` -- pattern rolls a fresh d6 each time the arm is checked

Random patterns are well-defined: each arm-check evaluates the pattern fresh, contributing its randomness to the joint distribution for analysis purposes.

### Exhaustiveness

A `match` expression is **not required** to be exhaustive. If no arm fires, the result is undefined behavior at runtime (a `RuntimeError` is thrown). Most programs will end with a `_` catchall.

For probability analysis, a non-exhaustive match where the analyzer can prove some path leads to no firing arm is a hard error. For Monte Carlo trials that hit a no-arm case, the trial fails with a runtime error.

The parser does not enforce a final `_` arm, but a linter could.

### Empty match block

`match { }` is a parse error.

## AST

### New expression type

```ts
export interface MatchExpr {
  type: 'match-expr'
  value?: Expression // present in value mode
  arms: MatchArm[]
}

export interface MatchArm {
  pattern: MatchPattern
  guard?: Expression // optional `if guard` clause
  body: Expression
}

export type MatchPattern =
  | { kind: 'wildcard' } // `_`
  | { kind: 'expression'; expr: Expression } // any expression

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

Update the `Expression` union to include `MatchExpr`.

## Reserved words

Add to the reserved word set:

- `match` -- new keyword
- `_` -- new token (wildcard)

`_` cannot appear as a variable name (variable names are `$[a-z_][a-z0-9_]*` -- `_` alone isn't a valid `$name`, so this is naturally exclusive). However, we should also disallow `_` as a record key.

## Evaluator

Add a `match-expr` case to `execExpression`:

```ts
case 'match-expr': {
  const matched = expr.value !== undefined
    ? this.evalExpr(expr.value, env)
    : undefined

  for (const arm of expr.arms) {
    const armFires = this.checkArm(arm, matched, env)
    if (armFires) {
      return this.evalExpr(arm.body, env)
    }
  }

  throw new RuntimeError('No match arm fired')
}
```

Where `checkArm` evaluates the pattern (skipping if wildcard), compares with `matched` (in value mode), then checks the guard (if present).

## Probability analysis

### Monte Carlo

Straightforward: evaluate `match-expr` like any other expression, top-to-bottom. Each trial contributes one value to the output distribution.

### Exact tier (symbolic interpreter)

A `match-expr` can be desugared into nested `if-then-else` for the symbolic interpreter:

```
match VALUE { p1 -> r1; p2 if g2 -> r2; _ -> r3 }
```

becomes

```
if VALUE == p1 then r1
else if VALUE == p2 and g2 then r2
else r3
```

For guard mode:

```
match { e1 -> r1; e2 -> r2; _ -> r3 }
```

becomes

```
if e1 then r1
else if e2 then r2
else r3
```

The existing if-expr handling (including discriminated output detection from earlier work) handles the rest. No new symbolic machinery needed.

If a match has no `_` catchall, the desugar adds a synthetic `else throw`, which the analyzer represents as a runtime error path. For exact analysis, paths that lead to runtime errors are treated as having zero probability mass (and a warning could be surfaced via diagnostics).

## Parser

Add to `parsePrimary` (or wherever new expressions are dispatched):

```ts
if (this.matchKeyword('match')) {
  return this.parseMatchExpr()
}
```

`parseMatchExpr`:

1. After consuming `match`, check whether the next token is `{` (guard mode) or an expression (value mode)
2. Parse the value-expr if value mode
3. Expect `{`
4. Parse arms separated by newlines or commas
5. Expect `}`
6. Return `MatchExpr`

Each arm:

1. Parse the pattern: `_` keyword or any expression
2. Check for optional `if` keyword followed by guard expression
3. Expect `->`
4. Parse the body expression

Arms separated by newlines (skipped via `skipWhitespaceAndComments`) or commas. A trailing separator before `}` is allowed.

The pattern in value mode and guard expression in guard mode are both parsed as full expressions. Disambiguation between value mode and guard mode happens at parse time based on what follows `match`.

## Public API

No new public API beyond the AST exports. Existing `evaluator.run`, `ProgramStats.analyze`, etc. continue to work.

Add to `src/index.ts`:

```ts
export type { MatchExpr, MatchArm, MatchPattern } from './program'
export {
  matchExpr,
  matchArm,
  wildcardPattern,
  expressionPattern,
} from './program'
```

## File structure

| File                          | Change                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `src/program.ts`              | Add `MatchExpr`, `MatchArm`, `MatchPattern` types and factories; update `Expression` union |
| `src/program-parser.ts`       | Add `match` keyword, `_` token, `->` arrow; implement `parseMatchExpr`                     |
| `src/evaluator.ts`            | Handle `match-expr` in `evalExpr`                                                          |
| `src/program-stats.ts`        | Handle `match-expr` in classifier and symbolic interpreter (likely via desugar to if-expr) |
| `src/index.ts`                | Export new types and factories                                                             |
| `test/program-parser.spec.ts` | Parsing tests                                                                              |
| `test/evaluator.spec.ts`      | Evaluation tests                                                                           |
| `test/program-stats.spec.ts`  | Analysis tests                                                                             |

## Tests

### Parser

- Guard mode with multiple arms
- Value mode with multiple arms
- Value mode with `if` guards on arms
- Wildcard `_` arm
- `_ if guard -> ...` arm
- Comma vs newline separators
- Trailing separator allowed
- Empty match is parse error
- `match` cannot be used as a variable or record key
- `_` cannot be used as a record key

### Evaluator

- Guard mode picks first true arm
- Value mode picks first matching pattern
- Value mode with guard picks pattern + guard match
- Wildcard arm always fires (after non-matching specific arms)
- Wildcard with guard checks the guard
- No matching arm throws runtime error
- Patterns can be variables, computed expressions, or dice expressions
- Random patterns are evaluated per arm-check

### Program-stats

- Guard mode classification (constant/exact/MC depending on contents)
- Value mode classification
- Match desugars to nested ifs for analysis
- Discriminated output detection works on match arms returning different record shapes

## Backward compatibility

All changes are additive:

- `match` and `_` are new reserved words; programs not using them are unaffected
- Existing `if/then/else` is unchanged
- AST consumers handle `match-expr` by ignoring it (or fail at type-check time)

## Out of scope

- Or-patterns (`"sword" | "dagger" -> ...`) -- could be added later as a low-cost extension
- Range patterns (`1..5 -> ...`) -- requires range syntax we don't have elsewhere
- Destructuring patterns (`{kind: "hit"} -> ...`) -- requires a real pattern language
- Pattern bindings (`n if n > 0 -> ...`) -- requires a way to bind to the matched value
- Exhaustiveness checking -- could be added as a linter feature
