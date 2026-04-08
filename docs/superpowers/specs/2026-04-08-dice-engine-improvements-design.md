# Dice Expression Engine Improvements

## Overview

A set of improvements to the dice expression engine covering new features, bug fixes, code quality, and analysis capabilities. All work follows TDD: failing tests first, implementation after.

## 1. Fix Operator Precedence

**Problem**: Mul/div and add/sub aren't properly left-associative at the same precedence level. `150 / 25 * 3` evaluates to 2 instead of 18.

**Fix**: Standard two-tier precedence with left-to-right associativity within each tier:

- Tier 1 (high): `*`, `/`
- Tier 2 (low): `+`, `-`

Parser builds left-associative chains at each tier: `a / b * c` becomes `(a / b) * c`.

**Tests**: Fix the existing test expectation for `150 / 25 * 3` (should be 18). Add cases: `12 / 3 / 2` = 2, `10 - 3 - 2` = 5.

## 2. Custom-Faced Dice & Fate Dice

**New AST node** `CustomDie`:

```
type: 'custom-die'
faces: number[]
```

**Syntax**:

- `d{1,1,2,2,3,4}` - arbitrary face values
- `dF` / `4dF` - sugar for `d{-1,0,1}`
- Composable with all existing modifiers: `4dF keep 2`, `d{1,2,3} explode on 3`, etc.

**Roller**: Call `Roll(faces.length)` and index into the faces array. The `Roll` function signature stays `(max: number) => number`.

**Validation**: Empty faces `d{}` is invalid. `DE.validate()` catches it.

**toString**: Faces exactly matching `[-1,0,1]` render as `dF`. Otherwise render as `d{...}`.

## 3. Dice Pools / Success Counting

**New reducer** added to `DiceReducer`: `'count'` with a `Range` threshold.

**Syntax**:

- `8d10 count >= 6` - count values >= 6
- `8d10 count < 3` - count values < 3
- `8d10 count = 5` - count exact matches
- `8d10c6` - shorthand for count >= 6

Fits as a new `DiceReducer` variant alongside `sum`, `min`, `max`, `average`, `median`. The roller's `reduceRolls()` iterates results and counts matches against the range.

**Composable**: `8d10 explode on 10 count >= 6`, `10d10 drop 2 count >= 6`.

**toString**: Verbose form `count >= 6`. Shorthand `c6` accepted on parse, rendered as verbose.

## 4. Compound Exploding

**New functor** added to `DiceFunctor`:

```
type: 'compound'
times: Times
range: Range
```

Difference from regular explode: exploded values are summed into the original die result rather than producing separate dice. Example: `d6 compound on 6` - roll 6, roll again get 4, result is 10 (one die).

**Syntax**:

- `3d6 compound on 6` / `3d6 compound once on 6` / `3d6 compound 3 times on 6`
- `3d6ce6` - shorthand (compound-explode on 6 or more)

**Roll result**: New `DiceResultMapped` variant `compounded` storing the chain of rolls and their sum.

**toString**: Verbose form. Shorthand `ce6` parsed, rendered as verbose.

## 5. Configurable Iteration Limits

**Roller constructor** gains optional options:

```ts
interface RollerOptions {
  maxExplodeIterations?: number   // default 100
  maxRerollIterations?: number    // default 100
  maxEmphasisIterations?: number  // default 100
}

new Roller(rollFn)                                // unchanged
new Roller(rollFn, { maxExplodeIterations: 50 })  // override
```

Replaces hardcoded limits in `explodeRoll`, `rerollRoll`, and `emphasisRoll`. Compound exploding also respects `maxExplodeIterations`.

No AST or parser changes. Purely a Roller concern.

## 6. Probability Analysis

**New module** `dice-stats.ts` with namespace `DiceStats`, exported from `index.ts`.

### Exact Analysis

Computes full probability distribution by walking the AST (convolving distributions):

- `DiceStats.distribution(expr)` - `Map<number, number>` (value -> probability 0-1)
- `DiceStats.mean(expr)` - expected value
- `DiceStats.stddev(expr)` - standard deviation
- `DiceStats.percentile(expr, p)` - value at Pth percentile
- `DiceStats.min(expr)` / `DiceStats.max(expr)` - bounds

### Monte Carlo

For complex expressions or quick approximation:

- `DiceStats.monteCarlo(expr, { trials?: number })` - returns `{ mean, stddev, min, max, distribution, percentile(p) }`
- Default 10,000 trials
- Uses `Math.random` roller internally

### Summary

- `DiceStats.summary(expr)` - returns `{ min, max, mean, stddev, distribution, percentiles: {25, 50, 75} }`
- Tries exact first, falls back to Monte Carlo if complexity exceeds threshold (~20 total dice or deep nesting)

## 7. Parser Error Messages

Three layers:

### Better Contextual Messages

Wrap `partsing` failures with context:

- "Expected 'on' keyword after 'explode'"
- "Expected dice expression after '+'"
- "Unmatched parenthesis"
- "Empty custom die faces: d{} is not valid"

### Suggestions

On failure, fuzzy match against known patterns:

- "Unknown modifier 'explod'. Did you mean 'explode'?"
- "3d6 explode 6 - missing 'on' keyword. Did you mean '3d6 explode on 6'?"

### Position Tracking

Error result includes offset in input:

```ts
interface ParseError {
  message: string
  position: number
  suggestion?: string
  context: string
}
```

New method `DiceParser.parseWithErrors(input)` returns either the expression or `ParseError[]`. Existing `DiceParser.parse()` API unchanged.

## 8. Constant Folding

**New utility** `DE.simplify(expr)` in `dice-expression-domain.ts`:

- `Literal(2) + Literal(3)` -> `Literal(5)`
- `Literal(0) * Die(6)` -> `Literal(0)`
- `negate(Literal(3))` -> `Literal(-3)`
- `expr + Literal(0)` -> `expr` (identity elimination)
- `expr * Literal(1)` -> `expr`

Only folds when both sides are literals or identity/zero rules apply. Expressions with dice are left as-is. Optional to call - parser doesn't auto-simplify. The stats module uses it internally.

## Architecture

**Approach**: Hybrid - extend existing files for AST/parser/roller changes, new modules only for genuinely new responsibilities.

**New files**:

- `src/dice-stats.ts` - probability analysis module
- `src/parse-error.ts` - error types and suggestion logic

**Extended files**:

- `src/dice-expression.ts` - add `CustomDie`, `count` reducer, `compound` functor
- `src/dice-expression-domain.ts` - add `DE.simplify()`, update `toString`/`validate` for new types
- `src/dice-parser.ts` - fix precedence, add custom dice/Fate/pool/compound syntax, improve errors
- `src/roller.ts` - add options, compound rolling, count reducer, custom die rolling
- `src/roll-result.ts` - add `compounded` result variant

Split files if they grow past ~500 lines.

## Testing Strategy

**TDD**: Failing test first, implementation after.

**One test file per feature**:

- `test/precedence.spec.ts`
- `test/custom-dice.spec.ts`
- `test/dice-pool.spec.ts`
- `test/compound.spec.ts`
- `test/roller-options.spec.ts`
- `test/stats.spec.ts`
- `test/parse-errors.spec.ts`
- `test/simplify.spec.ts`

**Existing tests** (`test/parsing.spec.ts`, `test/roller.spec.ts`) stay unchanged except fixing the precedence expectation. All existing tests must pass throughout.

**Coverage**: All new code paths covered. Each test file tests the full cycle where applicable (parse -> validate -> roll -> result).
