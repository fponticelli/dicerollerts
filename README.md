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
