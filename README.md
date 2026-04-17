# dicerollerts

A TypeScript library for parsing, rolling, and analyzing dice expressions. Supports standard notation, custom dice, dice pools, exploding/rerolling/compound mechanics, and probability analysis.

## Install

```bash
npm install dicerollerts
```

## Quick Start

```ts
import { DiceParser, Roller, RR, DE } from 'dicerollerts'

// Parse a dice expression
const result = DiceParser.parse('4d6 drop 1')
if (result.isSuccess()) {
  // Roll it
  const roller = new Roller((sides) => Math.floor(Math.random() * sides) + 1)
  const roll = roller.roll(result.value)
  console.log(RR.getResult(roll)) // e.g. 14

  // Normalize to canonical string
  console.log(DE.toString(result.value)) // "4d6 drop 1"
}
```

## Dice Notation

### Basic

| Notation       | Description                  |
| -------------- | ---------------------------- |
| `d6`           | One six-sided die            |
| `3d6`          | Three six-sided dice, summed |
| `d20`          | Twenty-sided die             |
| `d%` or `d100` | Percent die                  |
| `42`           | Literal number               |
| `-d6`          | Negated die                  |

### Custom Dice

| Notation         | Description                 |
| ---------------- | --------------------------- |
| `d{1,1,2,2,3,4}` | Die with custom face values |
| `dF`             | Fate/Fudge die (-1, 0, 1)   |
| `4dF`            | Four Fate dice              |

### Arithmetic

Standard precedence (multiplication/division before addition/subtraction), left-to-right within each tier.

| Notation    | Description                     |
| ----------- | ------------------------------- |
| `3d6 + 4`   | Addition                        |
| `2d8 - 1`   | Subtraction                     |
| `d6 * 2`    | Multiplication                  |
| `d100 / 10` | Division (truncates to integer) |

Alternative symbols: `×`, `⋅`, `x` for multiplication; `÷`, `:` for division.

### Expression Sets and Reducers

Group expressions with parentheses. Default reducer is `sum`.

| Notation            | Description          |
| ------------------- | -------------------- |
| `(2d6,3d8,d10)`     | Sum of all (default) |
| `(2d6,3d8) min`     | Lowest result        |
| `(2d6,3d8) max`     | Highest result       |
| `(2d6,3d8) average` | Mean (rounded)       |
| `(2d6,3d8) median`  | Median value         |

### Drop and Keep

| Notation             | Shorthand | Description    |
| -------------------- | --------- | -------------- |
| `4d6 drop 1`         | `4d6d1`   | Drop lowest 1  |
| `4d6 drop lowest 1`  |           | Same, explicit |
| `4d6 drop highest 1` |           | Drop highest 1 |
| `4d6 keep 3`         | `4d6k3`   | Keep highest 3 |
| `4d6 keep lowest 1`  |           | Keep lowest 1  |

### Exploding

Roll again when a trigger condition is met. Extra rolls are added as separate dice.

| Notation                   | Shorthand | Description                  |
| -------------------------- | --------- | ---------------------------- |
| `3d6 explode on 6`         |           | Explode on exact 6, no limit |
| `3d6 explode once on 6`    |           | Explode at most once         |
| `3d6 explode on 5 or more` | `3d6e5`   | Explode on 5+                |
| `3d6 explode on 2 or less` |           | Explode on 1-2               |
| `3d6 explode 3 times on 6` |           | At most 3 explosions         |

### Rerolling

Roll again when triggered, but only the last roll counts.

| Notation                  | Shorthand | Description         |
| ------------------------- | --------- | ------------------- |
| `3d6 reroll on 1`         |           | Reroll 1s, no limit |
| `d6 reroll once on 1`     |           | Reroll at most once |
| `3d6 reroll on 2 or less` | `3d6r2`   | Reroll 1s and 2s    |

### Compound Exploding

Like exploding, but extra rolls are summed into the original die (one die, higher value).

| Notation                    | Shorthand | Description    |
| --------------------------- | --------- | -------------- |
| `d6 compound on 6`          |           | Compound on 6  |
| `d6 compound once on 6`     |           | At most once   |
| `3d6 compound on 6 or more` | `3d6ce6`  | Compound on 6+ |

### Emphasis

Roll two dice, keep the result furthest from a center point.

| Notation                    | Description                        |
| --------------------------- | ---------------------------------- |
| `d20 emphasis`              | Furthest from average, reroll ties |
| `d20 emphasis high`         | Ties go to higher value            |
| `d20 emphasis low`          | Ties go to lower value             |
| `d20 furthest from 10`      | Custom center point                |
| `d20 furthest from 10 high` | Custom center, high tie-break      |

### Dice Pools / Success Counting

Count how many dice meet a threshold.

| Notation          | Shorthand | Description          |
| ----------------- | --------- | -------------------- |
| `8d10 count >= 6` | `8d10c6`  | Count successes >= 6 |
| `3d6 count = 5`   |           | Count exact 5s       |
| `4d6 count <= 2`  |           | Count values <= 2    |
| `4d6 count > 4`   |           | Count values > 4     |
| `4d6 count < 3`   |           | Count values < 3     |

## API

### DiceParser

```ts
import { DiceParser } from 'dicerollerts'

// Parse and get a Result (success/failure)
const result = DiceParser.parse('3d6 + 5')

// Parse or get null
const expr = DiceParser.parseOrNull('3d6 + 5')

// Normalize a string expression
DiceParser.normalize('2D6 + 1d6') // "2d6 + d6"

// Parse with structured error messages
const r = DiceParser.parseWithErrors('3d6 explod on 6')
if (!r.success) {
  r.errors[0].message // error description
  r.errors[0].position // character offset
  r.errors[0].suggestion // e.g. "Did you mean 'explode'?"
  r.errors[0].context // surrounding input text
}
```

### Roller

```ts
import { Roller, RR } from 'dicerollerts'

// Create with a random function (sides => 1..sides)
const roller = new Roller((sides) => Math.floor(Math.random() * sides) + 1)

// With configurable limits
const roller2 = new Roller(rollFn, {
  maxExplodeIterations: 100, // default 100
  maxRerollIterations: 100,
  maxEmphasisIterations: 100,
})

// Roll an expression
const roll = roller.roll(expr)
const value = RR.getResult(roll) // numeric result
```

### DE (Expression Utilities)

```ts
import { DE } from 'dicerollerts'

DE.toString(expr) // canonical string representation
DE.validate(expr) // null if valid, ValidationMessage[] if not
DE.calculateBasicRolls(expr) // count of dice in expression
DE.simplify(expr) // constant folding (2 + 3 => 5)
```

### DiceStats (Probability Analysis)

```ts
import { DiceStats } from 'dicerollerts'

// Exact distribution (for expressions without explode/reroll/compound)
const dist = DiceStats.distribution(expr) // Map<number, number>
DiceStats.mean(expr) // expected value
DiceStats.stddev(expr) // standard deviation
DiceStats.min(expr) // minimum possible value
DiceStats.max(expr) // maximum possible value
DiceStats.percentile(expr, 50) // value at 50th percentile

// Monte Carlo (for any expression)
const mc = DiceStats.monteCarlo(expr, { trials: 50000 })
mc.mean
mc.stddev
mc.min
mc.max
mc.distribution // Map<number, number>
mc.percentile(75) // value at 75th percentile

// Summary (exact when possible, Monte Carlo fallback)
const s = DiceStats.summary(expr)
;(s.min, s.max, s.mean, s.stddev)
s.distribution
s.percentiles // { 25, 50, 75 }
```

## Dice Language

A scripting language for tabletop RPG automation, with variables, conditionals, records, arrays, and loops. Dice expressions live in backticks.

```ts
import { DiceParser, Evaluator, ProgramStats } from 'dicerollerts'

const source = `
$str_mod = 5
$ac = 15
$attack = \`d20 + $str_mod\`
$hit = $attack >= $ac
$damage = if $hit then \`2d6 + $str_mod\` else 0
{ attack: $attack, hit: $hit, damage: $damage }
`

// Parse
const parsed = DiceParser.parseProgram(source)
if (!parsed.success) {
  console.error(parsed.errors)
} else {
  // Roll once
  const evaluator = new Evaluator(
    (sides) => Math.floor(Math.random() * sides) + 1,
  )
  const result = evaluator.run(parsed.program)
  // result is e.g. { attack: 18, hit: true, damage: 14 }

  // Probability analysis (auto-detects best strategy)
  const analysis = ProgramStats.analyze(parsed.program)
  // analysis.strategy.tier: 'constant' | 'exact' | 'monte-carlo'
  // analysis.stats: per-field distributions
}
```

### Language features

- Variables: `$name = expr` (immutable, `$[a-z_][a-z0-9_]*`)
- Dice in backticks: `` `d20 + $mod` ``, `` `4d6 drop 1` ``, `` `8d10 count >= 6` ``
- Variables in dice expressions: `$var` works in additive positions (`` `d20 + $mod` ``), count positions (`` `$rollsD6` ``), and sides positions (`` `1d$sides` ``). Parametric forms use uppercase `D` by convention but lowercase also works. Dice count is capped at 10000 per expression at evaluation time.
- Arithmetic: `+`, `-`, `*`, `/` (integer division)
- Comparison: `==`, `!=`, `>`, `<`, `>=`, `<=`
- Boolean: `and`, `or`, `not`
- `if cond then a else b` (else required)
- `match { pattern -> body, ... }` and `match VALUE { pattern -> body, ... }` for guard ladders and value dispatch
- Wildcard `_` and optional `if guard` clauses on match arms
- Records: `{ key: value, ... }`, shorthand `{ $var }`
- Field access: `$rec.field`
- Arrays: `[1, 2, 3]`, indexing: `$arr[0]`
- `repeat N { body }` (returns array)
- Parameters: `$name is { default: ..., min, max, enum, label, description }`
- Comments: `# line comment`
- Statements separated by newlines

### Match expressions

Replace nested if-else chains with a flat form. Two modes are supported: a guard ladder (no value after `match`) and value dispatch (value after `match`).

Guard mode picks the first arm whose pattern is truthy:

```
$damage = match {
  $crit -> `4d6 + 1d4 + 4`
  $hit  -> `2d6 + 4`
  _     -> 0
}
```

Value mode compares the matched value against each arm's pattern using `==`:

```
$roll = match $roll_mode {
  "advantage"    -> `2d20 keep highest 1`
  "disadvantage" -> `2d20 keep lowest 1`
  _              -> `d20`
}
```

Arms can carry an optional `if guard` clause, evaluated only when the pattern matches:

```
$damage = match $weapon {
  "sword" if $crit  -> `4d6`
  "sword"           -> `2d6`
  "dagger" if $crit -> `2d4`
  "dagger"          -> `1d4`
  _                 -> 0
}
```

- `_` is the wildcard (matches anything; use it as a catch-all)
- Arms are separated by newlines or commas; a trailing separator is allowed
- The first matching arm wins; remaining arms are not evaluated
- A trailing `_ -> default` is recommended (otherwise non-matching trials throw a runtime error)

### Parameters

Declare a variable as a parameter with `is { ... }` to give it a default value plus optional metadata. Tools can introspect the program to render UI inputs; callers can override defaults at runtime.

```
$str_mod is {
  default: 5,
  min: 0,
  max: 30,
  label: "STR Modifier",
  description: "Your strength bonus",
}

$weapon is {
  default: "longsword",
  enum: ["longsword", "dagger", "greataxe"],
}

$advantage is { default: false }

$attack_die is { default: `d20` }

$attack = $attack_die + $str_mod
$hit = $attack >= 15
{ attack: $attack, hit: $hit }
```

Field rules:

- `default` (required): a literal value or backtick dice expression
- `label`, `description`: string literals
- `min`, `max`: only valid when `default` is a number
- `enum`: only valid when `default` is non-number; entries must match default's type; default must be in enum

Override at runtime:

```ts
evaluator.run(program, { parameters: { str_mod: 7, weapon: 'dagger' } })
ProgramStats.analyze(program, { parameters: { str_mod: 7 } })
```

Overrides are validated (unknown name, type mismatch, out of range, not in enum) and throw clear errors. Without overrides, literal defaults act as constants and dice-expression defaults are rolled per execution (or analyzed exactly).

Introspect parameters for UI:

```ts
import { ProgramParameters } from 'dicerollerts'

const params = ProgramParameters.list(program)
// [{ name, default, defaultExpr?, defaultSource?, label?, description?, min?, max?, enum? }, ...]
```

The input kind is inferred by the consumer from the data: number with `min` and `max` → bounded slider, string with `enum` → dropdown, boolean → toggle, dice expression default → free-form expression input, etc.

### Probability analysis

`ProgramStats.analyze()` picks one of three strategies:

- **`constant`** - no randomness, single evaluation
- **`exact`** - covers single dice expressions, comparisons, conditionals, arithmetic on independent distributions, shared variables (via joint enumeration), boolean ops, categorical conditionals, and discriminated outputs (per-variant conditional stats)
- **`monte-carlo`** - adaptive batched simulation, stops when per-bin frequencies stabilize

```ts
const result = ProgramStats.analyze(program, {
  minTrials: 1000, // initial batch
  maxTrials: 100000, // cap
  batchSize: 1000, // batch increment
  targetRelativeError: 0.01, // 1% convergence target
})

result.strategy.tier // 'constant' | 'exact' | 'monte-carlo'
result.strategy.trials // actual trials run (monte-carlo)
result.strategy.converged // hit target before maxTrials
result.stats // FieldStats (per-field for records/arrays)

// Manual classification
const tier = ProgramStats.classify(program)
```

`FieldStats` is a discriminated union:

- **`number`**: `mean`, `stddev`, `min`, `max`, `distribution`, `cdf`, `percentiles` (p5/p10/p25/p50/p75/p90/p95), `skewness`, `kurtosis`, optional `standardError` (Monte Carlo only)
- **`boolean`**: `truePercent`, optional `standardError`
- **`string`**: `frequencies`, optional per-bucket `standardErrors`
- **`array`**: `elements: FieldStats[]`, optional `aggregate` (pooled stats when all elements are numeric)
- **`record`**: `fields: Record<string, FieldStats>`
- **`discriminated`**: `discriminator: 'kind' | 'shape'`, `variants: DiscriminatedVariant[]` (see below)

### Discriminated outputs

When a program's output can take on multiple record shapes, use a `kind`
field to discriminate variants. The analyzer detects this and produces
per-variant statistics:

```
$hit = `d20 + 5` >= 15
if $hit
  then { kind: "hit", damage: `2d6 + 3` }
  else { kind: "miss", margin: 0 }
```

The result is a `discriminated` `FieldStats` with one entry per kind value,
each containing the probability of that variant and the marginal stats
for its fields. The `kind` field itself is a constant within each variant
and is not included in the per-variant stats.

If trials produce records with different keys but no `kind` field,
the analyzer falls back to grouping by key set (`discriminator: 'shape'`).
For consistent UI rendering, prefer the `kind` convention.

### Conditional field stats

When a variant's field references the same dice as the discriminating
condition, the field's stats are computed _conditional on that variant
being chosen_:

```
$attack = `d20`
if $attack >= 11
  then { kind: "hit", attack: $attack }
  else { kind: "miss", attack: $attack }
```

The `hit` variant's `attack` field has distribution {11..20} (each 1/10),
not the unconditional {1..20}. Same for the `miss` variant: {1..10}.

This works for arbitrary if-then-else ladders and is computed exactly
when feasible. Very large joint distributions (cap: 100,000 entries)
fall back to Monte Carlo with the same shape.

`DiscriminatedVariant` shape:

```ts
interface DiscriminatedVariant {
  tag: string // kind value or shape signature
  probability: number // share of trials matching this variant
  standardError?: number // stderr (Monte Carlo only)
  keys: string[] // field names in this variant (excluding kind)
  fields: Record<string, FieldStats> // marginal stats per field, conditional on variant
}
```

Helpers for charting:

```ts
import { suggestBucketSize, binDistribution } from 'dicerollerts'

const bucketSize = suggestBucketSize(stats.min, stats.max, 100)
const binned = binDistribution(stats.distribution, bucketSize)
```

### Async analysis with cancellation

```ts
const controller = new AbortController()

for await (const progress of ProgramStats.analyzeAsync(program, {
  signal: controller.signal,
  yieldEvery: 1000,
})) {
  // progress.stats, progress.trials, progress.converged
  updateUI(progress)
}
```

### Stats utilities

```ts
import {
  fieldStatsToJSON,
  fieldStatsFromJSON, // JSON round-trip (Maps preserved)
  totalVariationDistance,
  klDivergence, // distribution comparison
  probabilityGreaterThan, // P(X > Y) for independent X, Y
  sampleFromDistribution, // sample from a distribution
  fieldFromRecord,
  elementFromArray, // accessor helpers
} from 'dicerollerts'
```

### Distribution algebra (lower-level API)

For building custom analysis pipelines without the program language:

```ts
import { Distribution } from 'dicerollerts'

const d6 = Distribution.uniform([1, 2, 3, 4, 5, 6])
const sum2d6 = Distribution.add(d6, d6)
const hit = Distribution.greaterOrEqualConst(sum2d6, 8)
// Distribution.{singleton, uniform, from, fromWeights, map, combine,
//  conditional, add, subtract, multiply, negate, and, or, not,
//  greaterThan/Equal..., repeat, mean, variance, fromDiceExpression}
```

## Building Expressions Programmatically

```ts
import {
  die,
  literal,
  binaryOp,
  diceReduce,
  diceExpressions,
  customDie,
  drop,
  keep,
  explode,
  reroll,
  compound,
  emphasis,
  diceListWithFilter,
  diceListWithMap,
  filterableDiceArray,
  upTo,
  always,
  exact,
  valueOrMore,
  valueOrLess,
} from 'dicerollerts'

// 3d6 + 5
const expr = binaryOp(
  'sum',
  diceReduce(diceExpressions(die(6), die(6), die(6)), 'sum'),
  literal(5),
)

// 4d6 drop lowest 1
const abilityScore = diceReduce(
  diceListWithFilter(filterableDiceArray([6, 6, 6, 6]), drop('low', 1)),
  'sum',
)

// d6 explode once on 6
const exploding = diceReduce(
  diceListWithMap([6], explode(upTo(1), exact(6))),
  'sum',
)

// 4dF
const fateDice = diceReduce(
  diceExpressions(
    customDie([-1, 0, 1]),
    customDie([-1, 0, 1]),
    customDie([-1, 0, 1]),
    customDie([-1, 0, 1]),
  ),
  'sum',
)

// 8d10 count >= 6
const dicePool = diceReduce(
  diceExpressions(...Array.from({ length: 8 }, () => die(10))),
  { type: 'count', threshold: valueOrMore(6) },
)
```

## License

Apache-2.0
