# Dice Engine Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the dice expression engine with new features (custom dice, dice pools, compound exploding), bug fixes (precedence), quality improvements (constant folding, configurable limits, better errors), and probability analysis.

**Architecture:** Hybrid approach - extend existing AST/parser/roller files for new node types, create new modules for genuinely new responsibilities (stats, error reporting). TDD throughout: failing test first, then minimal implementation.

**Tech Stack:** TypeScript, Vitest, partsing (parser combinators)

**Task order:** 1 (precedence) → 2-3 (custom dice) → 4 (iteration limits) → 5-6 (compound) → 7-8 (dice pools) → 9 (constant folding) → 10 (parser errors) → 11-12 (stats) → 13 (verification). Iteration limits (Task 4) must precede compound (Task 5) since compound uses configurable limits.

---

### Task 1: Fix Operator Precedence

**Files:**

- Create: `test/precedence.spec.ts`
- Modify: `src/dice-parser.ts:213-239`
- Modify: `test/parsing.spec.ts:62`

- [ ] **Step 1: Write failing tests**

Create `test/precedence.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'
import { RR } from '../src/roll-result-domain'
import { maxRoller, minRoller } from './roller.spec'

describe('operator precedence', () => {
  const cases: { expr: string; expected: number }[] = [
    { expr: '150 / 25 * 3', expected: 18 },
    { expr: '12 / 3 / 2', expected: 2 },
    { expr: '10 - 3 - 2', expected: 5 },
    { expr: '2 * 3 + 4', expected: 10 },
    { expr: '4 + 2 * 3', expected: 10 },
    { expr: '10 / 2 + 3', expected: 8 },
    { expr: '3 + 10 / 2', expected: 8 },
    { expr: '2 * 3 * 4', expected: 24 },
    { expr: '100 / 5 / 4', expected: 5 },
    { expr: '2 + 3 + 4', expected: 9 },
    { expr: '10 - 3 + 2', expected: 9 },
  ]

  test.each(cases)('$expr = $expected', ({ expr, expected }) => {
    const parsed = DiceParser.parse(expr)
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      const result = RR.getResult(minRoller().roll(parsed.value))
      expect(result).toBe(expected)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/precedence.spec.ts`
Expected: FAIL - `150 / 25 * 3` returns 2 instead of 18, `12 / 3 / 2` returns 8 instead of 2

- [ ] **Step 3: Fix the parser precedence**

Replace the `binop` and `opRight` definitions in `src/dice-parser.ts` (lines 200-239) with proper two-tier precedence:

```ts
const addSubSymbol = oneOf(
  PLUS.withResult('sum' as const),
  MINUS.withResult('difference' as const),
)

const mulDivSymbol = oneOf(
  MULTIPLICATION.withResult('multiplication' as const),
  DIVISION.withResult('division' as const),
)

const mulDivRight = OWS.pickNext(
  mulDivSymbol.flatMap((op) => {
    return OWS.pickNext(termExpression.map((right) => ({ op, right })))
  }),
)

const mulDivExpr: Decoder<TextInput, DiceExpression, DecodeError> = lazy(() =>
  termExpression.flatMap((left) => {
    return mulDivRight.atLeast(1).map((a) => {
      return a.reduce(
        (acc: DiceExpression, item) => binaryOp(item.op, acc, item.right),
        left,
      )
    })
  }),
)

const addSubFactor: Decoder<TextInput, DiceExpression, DecodeError> = lazy(() =>
  oneOf(mulDivExpr, termExpression),
)

const addSubRight = OWS.pickNext(
  addSubSymbol.flatMap((op) => {
    return OWS.pickNext(addSubFactor.map((right) => ({ op, right })))
  }),
)

const binop = lazy(() => {
  return addSubFactor.flatMap((left) => {
    return addSubRight.atLeast(1).map((a) => {
      return a.reduce(
        (acc: DiceExpression, item) => binaryOp(item.op, acc, item.right),
        left,
      )
    })
  })
})
```

Remove the old `binOpSymbol` and `opRight` definitions.

- [ ] **Step 4: Fix the existing test expectation**

In `test/parsing.spec.ts` line 62, change:

```ts
  { min: 2, t: "150 / 25 * 3" }, // precedence might not be correct
```

to:

```ts
  { min: 18, t: "150 / 25 * 3" },
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add test/precedence.spec.ts src/dice-parser.ts test/parsing.spec.ts
git commit -m "fix: correct operator precedence for mul/div same-tier associativity"
```

---

### Task 2: Custom-Faced Dice & Fate Dice - Types and Roller

**Files:**

- Create: `test/custom-dice.spec.ts`
- Modify: `src/dice-expression.ts`
- Modify: `src/dice-expression-domain.ts`
- Modify: `src/roller.ts`
- Modify: `src/roll-result.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `test/custom-dice.spec.ts`:

```ts
import {
  customDie,
  diceReduce,
  diceExpressions,
  literal,
  binaryOp,
  diceListWithMap,
  explode,
  upTo,
  exact,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

describe('custom die types', () => {
  test('custom die with explicit faces', () => {
    const expr = customDie([1, 1, 2, 2, 3, 4])
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(1)
    expect(max).toBe(4)
  })

  test('fate die (-1, 0, 1)', () => {
    const expr = customDie([-1, 0, 1])
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(-1)
    expect(max).toBe(1)
  })

  test('custom die in expression', () => {
    const expr = binaryOp('sum', customDie([2, 4, 6]), literal(3))
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(5)
    expect(max).toBe(9)
  })

  test('multiple custom dice reduced', () => {
    const expr = diceReduce(
      diceExpressions(customDie([1, 2, 3]), customDie([1, 2, 3])),
      'sum',
    )
    const min = RR.getResult(minRoller().roll(expr))
    const max = RR.getResult(maxRoller().roll(expr))
    expect(min).toBe(2)
    expect(max).toBe(6)
  })
})

describe('custom die toString', () => {
  test('renders fate die as dF', () => {
    expect(DE.toString(customDie([-1, 0, 1]))).toBe('dF')
  })

  test('renders custom faces as d{...}', () => {
    expect(DE.toString(customDie([1, 1, 2, 2, 3, 4]))).toBe('d{1,1,2,2,3,4}')
  })
})

describe('custom die validation', () => {
  test('empty faces is invalid', () => {
    const result = DE.validate(customDie([]))
    expect(result).not.toBeNull()
    expect(result![0].type).toBe('empty-faces')
  })

  test('non-empty faces is valid', () => {
    expect(DE.validate(customDie([1, 2, 3]))).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/custom-dice.spec.ts`
Expected: FAIL - `customDie` is not exported

- [ ] **Step 3: Add CustomDie type to dice-expression.ts**

Add after the `Die` interface and factory (after line 15):

```ts
export interface CustomDie {
  type: 'custom-die'
  faces: number[]
}

export function customDie(faces: number[]): CustomDie {
  return {
    type: 'custom-die',
    faces,
  }
}
```

Update `DiceExpression` union (line 80):

```ts
export type DiceExpression =
  | Die
  | CustomDie
  | Literal
  | DiceReduce
  | BinaryOp
  | UnaryOp
```

Add `EmptyFaces` validation message after `DropOrKeepShouldBePositive`:

```ts
export interface EmptyFaces {
  type: 'empty-faces'
}

export function emptyFaces(): EmptyFaces {
  return {
    type: 'empty-faces',
  }
}
```

Add `EmptyFaces` to the `ValidationMessage` union:

```ts
export type ValidationMessage =
  | InsufficientSides
  | EmptySet
  | InfiniteReroll
  | TooManyDrops
  | TooManyKeeps
  | DropOrKeepShouldBePositive
  | EmptyFaces
```

- [ ] **Step 4: Add CustomDie support to roll-result.ts**

Add a new result type after `DieResult`:

```ts
export interface CustomDieResult {
  type: 'custom-die-result'
  result: number
  faces: number[]
}

export function customDieResult(
  result: number,
  faces: number[],
): CustomDieResult {
  return {
    type: 'custom-die-result',
    result,
    faces,
  }
}
```

Update `OneResult` to accept either:

```ts
export interface OneResult {
  type: 'one-result'
  die: DieResult | CustomDieResult
}

export function oneResult(die: DieResult | CustomDieResult): OneResult {
  return {
    type: 'one-result',
    die,
  }
}
```

- [ ] **Step 5: Add CustomDie rolling to roller.ts**

In the `roll` method, add a case for `custom-die` after the `die` case:

```ts
} else if (expr.type === 'custom-die') {
  const index = this.dieRoll(expr.faces.length)
  return oneResult(customDieResult(expr.faces[index - 1], expr.faces))
}
```

Add import for `customDieResult` from `./roll-result` and `type CustomDie` from `./dice-expression`.

- [ ] **Step 6: Add CustomDie support to dice-expression-domain.ts**

In `DE.toString`, add a case for `custom-die`:

```ts
} else if (expr.type === 'custom-die') {
  return DE.customDieToString(expr.faces)
}
```

Add the helper method:

```ts
customDieToString(faces: number[]): string {
  if (faces.length === 3 && faces[0] === -1 && faces[1] === 0 && faces[2] === 1) {
    return 'dF'
  }
  return `d{${faces.join(',')}}`
},
```

In `DE.validateExpr`, add a case for `custom-die`:

```ts
case 'custom-die':
  if (expr.faces.length === 0) {
    return [emptyFaces()]
  } else {
    return []
  }
```

In `DE.calculateBasicRolls`, add a case for `custom-die`:

```ts
case 'custom-die':
  return 1
```

- [ ] **Step 7: Update RR.getResult for CustomDieResult**

In `src/roll-result-domain.ts`, the `one-result` case already accesses `result.die.result`, and `CustomDieResult` also has a `result` field, so no change needed. Verify this.

- [ ] **Step 8: Update index.ts exports**

Add `customDie`, `emptyFaces`, `type CustomDie`, `type EmptyFaces` to the exports in `src/index.ts`. Add `type CustomDieResult`, `customDieResult` to the roll-result exports.

- [ ] **Step 9: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add src/ test/custom-dice.spec.ts
git commit -m "feat: add custom-faced dice type with Fate die support"
```

---

### Task 3: Custom Dice & Fate Dice - Parser

**Files:**

- Modify: `test/custom-dice.spec.ts`
- Modify: `src/dice-parser.ts`

- [ ] **Step 1: Add parser tests**

Append to `test/custom-dice.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'

describe('custom die parsing', () => {
  const cases: { input: string; rendered: string; min: number; max: number }[] =
    [
      { input: 'd{1,2,3}', rendered: 'd{1,2,3}', min: 1, max: 3 },
      { input: 'd{1,1,2,2,3,4}', rendered: 'd{1,1,2,2,3,4}', min: 1, max: 4 },
      { input: 'd{ 1 , 2 , 3 }', rendered: 'd{1,2,3}', min: 1, max: 3 },
      { input: 'dF', rendered: 'dF', min: -1, max: 1 },
      { input: '4dF', rendered: '4dF', min: -4, max: 4 },
      { input: 'dF + 3', rendered: 'dF + 3', min: 2, max: 4 },
      { input: 'd{2,4,6} + 1', rendered: 'd{2,4,6} + 1', min: 3, max: 7 },
    ]

  test.each(cases)('parses $input', ({ input, rendered, min, max }) => {
    const parsed = DiceParser.parse(input)
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe(rendered)
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(min)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(max)
    }
  })

  test('rejects empty faces d{}', () => {
    const parsed = DiceParser.parse('d{}')
    expect(parsed.isSuccess()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/custom-dice.spec.ts`
Expected: FAIL - parser doesn't recognize `d{...}` or `dF`

- [ ] **Step 3: Add custom die and Fate parsing**

In `src/dice-parser.ts`, add after the `die` definition (around line 193):

```ts
const customDieFaces = D.skipNext(matchChar('{'))
  .skipNext(OWS)
  .pickNext(whole.atLeastWithSeparator(1, OWS.skipNext(COMMA).skipNext(OWS)))
  .skipNext(OWS.skipNext(matchChar('}')))

const fateDie = oneOf(
  positive.flatMap((count) => {
    return matchChar('d')
      .skipNext(matchChar('F'))
      .withResult(
        Array.from({ length: count }, () =>
          makeCustomDie([-1, 0, 1]),
        ) as DiceExpression[],
      )
  }),
  matchChar('d')
    .skipNext(matchChar('F'))
    .withResult([makeCustomDie([-1, 0, 1])] as DiceExpression[]),
)

const customDieExpression: Decoder<TextInput, DiceExpression, DecodeError> =
  oneOf(customDieFaces.map(makeCustomDie))

const fateDieExpression: Decoder<TextInput, DiceExpression, DecodeError> =
  oneOf(
    positive.flatMap((count) => {
      return matchChar('d')
        .skipNext(matchChar('F'))
        .withResult(
          count === 1
            ? makeCustomDie([-1, 0, 1])
            : makeDiceReduce(
                makeDiceExpressions(
                  ...Array.from({ length: count }, () =>
                    makeCustomDie([-1, 0, 1]),
                  ),
                ),
                'sum' as DiceReducer,
              ),
        )
    }),
    matchChar('d')
      .skipNext(matchChar('F'))
      .withResult(makeCustomDie([-1, 0, 1])),
  )
```

Add `customDie as makeCustomDie` to the imports from `./dice-expression`.

Update `termExpression` to include the new parsers before `dieExpression`:

```ts
const termExpression = lazy(
  (): Decoder<TextInput, DiceExpression, DecodeError> => {
    return oneOf(
      diceReduce(diceMapeable),
      diceReduce(diceFilterable),
      diceReduce(diceExpressions),
      fateDieExpression,
      customDieExpression,
      dieExpression,
      literalExpression,
      unary,
    )
  },
)
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dice-parser.ts test/custom-dice.spec.ts
git commit -m "feat: add parser support for custom dice d{...} and Fate dice dF"
```

---

### Task 4: Configurable Iteration Limits

**Files:**

- Create: `test/roller-options.spec.ts`
- Modify: `src/roller.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `test/roller-options.spec.ts`:

```ts
import {
  diceReduce,
  diceListWithMap,
  explode,
  reroll,
  always,
  exact,
} from '../src/dice-expression'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

describe('configurable iteration limits', () => {
  test('default Roller constructor still works', () => {
    const roller = new Roller((max) => max)
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    // With default limit of 100, max roller would explode 100 times
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(6 * 101)
  })

  test('maxExplodeIterations limits explosion count', () => {
    const roller = new Roller((max) => max, { maxExplodeIterations: 3 })
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    // max roller: rolls 6, explodes 3 more = 4 * 6 = 24
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(24)
  })

  test('maxRerollIterations limits reroll count', () => {
    const roller = new Roller(() => 1, { maxRerollIterations: 3 })
    const expr = diceReduce(
      diceListWithMap([6], reroll(always(), exact(1))),
      'sum',
    )
    // min roller: rolls 1, rerolls 3 more times getting 1 each time, keeps last = 1
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(1)
  })

  test('maxEmphasisIterations limits emphasis reroll ties', () => {
    // This is harder to test directly; verify the option is accepted
    const roller = new Roller((max) => max, { maxEmphasisIterations: 5 })
    expect(roller).toBeInstanceOf(Roller)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/roller-options.spec.ts`
Expected: FAIL - Roller constructor doesn't accept options

- [ ] **Step 3: Add RollerOptions to roller.ts**

Add at the top of `roller.ts`:

```ts
export interface RollerOptions {
  maxExplodeIterations: number
  maxRerollIterations: number
  maxEmphasisIterations: number
}

const DEFAULT_OPTIONS: RollerOptions = {
  maxExplodeIterations: 100,
  maxRerollIterations: 100,
  maxEmphasisIterations: 100,
}
```

Update the `Roller` class constructor:

```ts
readonly options: RollerOptions

constructor(
  private readonly dieRoll: Roll,
  options?: Partial<RollerOptions>,
) {
  this.options = { ...DEFAULT_OPTIONS, ...options }
}
```

In `explodeRoll`, use options:

```ts
explodeRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
  const limit = times === -1 ? this.options.maxExplodeIterations : times
  const acc = this.rollRange(roll, limit, range)
  return acc.length === 1 ? normal(acc[0]) : exploded(acc)
}
```

In `rerollRoll`:

```ts
rerollRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
  const limit = times === -1 ? this.options.maxRerollIterations : times
  const acc = this.rollRange(roll, limit, range)
  return acc.length === 1 ? normal(acc[0]) : rerolled(acc)
}
```

In `emphasisRoll`, replace `100` with `this.options.maxEmphasisIterations`:

```ts
for (let i = 0; i < this.options.maxEmphasisIterations; i++) {
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Update index.ts exports**

Add `type RollerOptions` to exports.

- [ ] **Step 6: Commit**

```bash
git add src/roller.ts test/roller-options.spec.ts src/index.ts
git commit -m "feat: add configurable iteration limits to Roller"
```

---

### Task 5: Compound Exploding - Types and Roller

**Files:**

- Create: `test/compound.spec.ts`
- Modify: `src/dice-expression.ts`
- Modify: `src/dice-expression-domain.ts`
- Modify: `src/roll-result.ts`
- Modify: `src/roller.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `test/compound.spec.ts`:

```ts
import {
  diceReduce,
  diceListWithMap,
  compound,
  upTo,
  always,
  valueOrMore,
  exact,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

describe('compound exploding', () => {
  test('compound once on max value sums into single die', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    // max roller: rolls 6, then explodes once rolling 6 again = 12
    const max = RR.getResult(maxRoller().roll(expr))
    expect(max).toBe(12)
    // min roller: rolls 1, no compound triggered = 1
    const min = RR.getResult(minRoller().roll(expr))
    expect(min).toBe(1)
  })

  test('compound always on 6 with max roller produces compound chain', () => {
    // With maxRoller, always rolls max. Compound always on 6 would loop forever,
    // but iteration limit stops it. With limit 100: 6 * 101 = 606
    const roller = new Roller((max) => max, { maxExplodeIterations: 5 })
    const expr = diceReduce(
      diceListWithMap([6], compound(always(), exact(6))),
      'sum',
    )
    // rolls 6, compounds 5 more times: 6 * 6 = 36
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(36)
  })

  test('compound result type is compounded', () => {
    const roller = maxRoller()
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    const result = roller.roll(expr)
    expect(result.type).toBe('dice-reduce-result')
    if (result.type === 'dice-reduce-result') {
      expect(result.reduceables.type).toBe('dice-mapeable-result')
      if (result.reduceables.type === 'dice-mapeable-result') {
        expect(result.reduceables.rolls[0].type).toBe('compounded')
      }
    }
  })

  test('toString renders compound', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(upTo(1), exact(6))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 compound once on 6')
  })

  test('toString renders compound always', () => {
    const expr = diceReduce(
      diceListWithMap([6], compound(always(), valueOrMore(5))),
      'sum',
    )
    expect(DE.toString(expr)).toBe('d6 compound on 5 or more')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/compound.spec.ts`
Expected: FAIL - `compound` is not exported

- [ ] **Step 3: Add Compound type to dice-expression.ts**

Add after the `Reroll` interface:

```ts
export interface Compound {
  type: 'compound'
  times: Times
  range: Range
}

export function compound(times: Times, range: Range): Compound {
  return {
    type: 'compound',
    times,
    range,
  }
}
```

Update `DiceFunctor`:

```ts
export type DiceFunctor = Explode | Reroll | Emphasis | Compound
```

- [ ] **Step 4: Add Compounded result type to roll-result.ts**

Add after `Exploded`:

```ts
export interface Compounded {
  type: 'compounded'
  rolls: DieResult[]
  total: number
}

export function compounded(rolls: DieResult[], total: number): Compounded {
  return {
    type: 'compounded',
    rolls,
    total,
  }
}
```

Update `DiceResultMapped`:

```ts
export type DiceResultMapped = Rerolled | Exploded | Normal | Compounded
```

- [ ] **Step 5: Add compound rolling to roller.ts**

In the `mapRolls` method, add a case for `compound` before the `switch`:

```ts
if (functor.type === 'compound') {
  const times = functor.times
  const maxIter = times.type === 'always' ? -1 : times.value
  return rolls.map((roll) => this.compoundRoll(roll, maxIter, functor.range))
}
```

Add the `compoundRoll` method:

```ts
compoundRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
  const rolls = [roll]
  let total = roll.result
  let curr = roll
  let remaining = times
  while (remaining !== 0 && Roller.matchRange(curr.result, range)) {
    if (this.options.maxExplodeIterations > 0 && rolls.length > this.options.maxExplodeIterations) {
      break
    }
    curr = dieResult(this.dieRoll(curr.sides), curr.sides)
    rolls.push(curr)
    total += curr.result
    remaining--
  }
  if (rolls.length === 1) {
    return normal(rolls[0])
  }
  return compounded(rolls, total)
}
```

Update `keepMappedRolls` to handle `compounded`:

```ts
case 'compounded':
  return [dieResult(roll.total, roll.rolls[0].sides)]
```

Add import for `compounded` from `./roll-result`.

- [ ] **Step 6: Add compound to dice-expression-domain.ts**

In `DE.diceBagToString`, update the suffix switch to include `compound`:

```ts
case 'compound':
  return ['compound']
```

In `DE.checkFunctor`, add `compound` to the condition:

```ts
if (
  (df.type === 'explode' || df.type === 'reroll' || df.type === 'compound') &&
  DE.alwaysInRange(sides, df.range)
) {
```

- [ ] **Step 7: Update index.ts exports**

Add `compound`, `type Compound` to dice-expression exports. Add `compounded`, `type Compounded` to roll-result exports.

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/ test/compound.spec.ts
git commit -m "feat: add compound exploding dice type"
```

---

### Task 6: Compound Exploding - Parser

**Files:**

- Modify: `test/compound.spec.ts`
- Modify: `src/dice-parser.ts`

- [ ] **Step 1: Add parser tests**

Append to `test/compound.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'

describe('compound parsing', () => {
  const cases: { input: string; rendered: string; min: number; max: number }[] =
    [
      {
        input: 'd6 compound once on 6',
        rendered: 'd6 compound once on 6',
        min: 1,
        max: 12,
      },
      {
        input: '3d6 compound once on 6',
        rendered: '3d6 compound once on 6',
        min: 3,
        max: 36,
      },
      {
        input: 'd6 compound on 7',
        rendered: 'd6 compound on 7',
        min: 1,
        max: 6,
      },
      {
        input: '3d6ce6',
        rendered: '3d6 compound on 6 or more',
        min: 3,
        max: undefined,
      },
    ]

  test.each(cases.filter((c) => c.max !== undefined))(
    'parses $input',
    ({ input, rendered, min, max }) => {
      const parsed = DiceParser.parse(input)
      expect(parsed.isSuccess()).toBe(true)
      if (parsed.isSuccess()) {
        expect(DE.toString(parsed.value)).toBe(rendered)
        expect(RR.getResult(minRoller().roll(parsed.value))).toBe(min)
        if (max !== undefined) {
          expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(max)
        }
      }
    },
  )

  test('parses ce shorthand', () => {
    const parsed = DiceParser.parse('3d6ce6')
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe('3d6 compound on 6 or more')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/compound.spec.ts`
Expected: FAIL - parser doesn't recognize `compound` or `ce`

- [ ] **Step 3: Add compound parsing**

In `src/dice-parser.ts`, add `compound` to imports from `./dice-expression`.

Add compound to `diceFunctor`:

```ts
const diceFunctor = lazy(() =>
  oneOf(
    emphasisConst,
    diceFunctorConst('compound', compound),
    diceFunctorConst('explode', explode),
    diceFunctorConst('reroll', reroll),
    match('ce')
      .skipNext(OWS)
      .pickNext(positive.map((v) => compound(always(), valueOrMore(v)))),
    matchChar('e')
      .skipNext(OWS)
      .pickNext(positive.map((v) => explode(always(), valueOrMore(v)))),
    matchChar('r')
      .skipNext(OWS)
      .pickNext(positive.map((v) => reroll(always(), valueOrLess(v)))),
  ),
)
```

Note: `compound` must come before `explode` in the verbose list, and `ce` must come before `e` in the shorthand list, to avoid prefix ambiguity.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dice-parser.ts test/compound.spec.ts
git commit -m "feat: add parser support for compound exploding"
```

---

### Task 7: Dice Pools / Success Counting - Types and Roller

**Files:**

- Create: `test/dice-pool.spec.ts`
- Modify: `src/dice-expression.ts`
- Modify: `src/dice-expression-domain.ts`
- Modify: `src/roller.ts`

- [ ] **Step 1: Write failing tests**

Create `test/dice-pool.spec.ts`:

```ts
import {
  diceReduce,
  diceExpressions,
  die,
  literal,
  diceListWithFilter,
  filterableDiceArray,
  drop,
  diceListWithMap,
  explode,
  upTo,
  exact,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'
import type { CountReducer } from '../src/dice-expression'
import type { Range } from '../src/dice-expression'
import { valueOrMore, valueOrLess } from '../src/dice-expression'

function maxRoller() {
  return new Roller((max) => max)
}

function minRoller() {
  return new Roller(() => 1)
}

function countReducer(range: Range): CountReducer {
  return { type: 'count', threshold: range }
}

describe('dice pool / success counting', () => {
  test('count successes >= 6 on 4d10, all max', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    // max roller: all roll 10, all >= 6, count = 4
    expect(RR.getResult(maxRoller().roll(expr))).toBe(4)
  })

  test('count successes >= 6 on 4d10, all min', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    // min roller: all roll 1, none >= 6, count = 0
    expect(RR.getResult(minRoller().roll(expr))).toBe(0)
  })

  test('count exact matches', () => {
    // 3 literals: 5, 3, 5 - count exact 5 = 2
    const expr = diceReduce(
      diceExpressions(literal(5), literal(3), literal(5)),
      countReducer(exact(5)),
    )
    expect(RR.getResult(minRoller().roll(expr))).toBe(2)
  })

  test('count with value or less', () => {
    // 3 literals: 1, 2, 3 - count <= 2 = 2
    const expr = diceReduce(
      diceExpressions(literal(1), literal(2), literal(3)),
      countReducer(valueOrLess(2)),
    )
    expect(RR.getResult(minRoller().roll(expr))).toBe(2)
  })

  test('toString renders count', () => {
    const expr = diceReduce(
      diceExpressions(die(10), die(10), die(10), die(10)),
      countReducer(valueOrMore(6)),
    )
    expect(DE.toString(expr)).toBe('4d10 count >= 6')
  })

  test('toString renders count exact', () => {
    const expr = diceReduce(
      diceExpressions(literal(5), literal(3)),
      countReducer(exact(5)),
    )
    expect(DE.toString(expr)).toBe('(5,3) count = 5')
  })

  test('toString renders count or less', () => {
    const expr = diceReduce(
      diceExpressions(die(6), die(6), die(6)),
      countReducer(valueOrLess(2)),
    )
    expect(DE.toString(expr)).toBe('3d6 count <= 2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dice-pool.spec.ts`
Expected: FAIL - `CountReducer` doesn't exist

- [ ] **Step 3: Change DiceReducer from string union to discriminated union**

In `src/dice-expression.ts`, replace:

```ts
export type DiceReducer = 'sum' | 'min' | 'max' | 'average' | 'median'
```

with:

```ts
export type SimpleReducer = 'sum' | 'min' | 'max' | 'average' | 'median'

export interface CountReducer {
  type: 'count'
  threshold: Range
}

export type DiceReducer = SimpleReducer | CountReducer
```

- [ ] **Step 4: Update roller.ts to handle CountReducer**

In `reduceResults`, add handling for the count reducer:

```ts
reduceResults(results: number[], reducer: DiceReducer): number {
  if (typeof reducer === 'object' && reducer.type === 'count') {
    return results.filter((r) => Roller.matchRange(r, reducer.threshold)).length
  }
  switch (reducer) {
    case 'average':
      return Math.round(results.reduce((a, b) => a + b, 0) / results.length)
    case 'median':
      return median(results)
    case 'sum':
      return results.reduce((a, b) => a + b, 0)
    case 'min':
      return Math.min(...results)
    case 'max':
      return Math.max(...results)
  }
}
```

- [ ] **Step 5: Update dice-expression-domain.ts for count toString**

In `DE.expressionExtractorToString`, handle the count reducer:

```ts
expressionExtractorToString(reducer: DiceReducer): string {
  if (typeof reducer === 'object' && reducer.type === 'count') {
    return ` count ${DE.countThresholdToString(reducer.threshold)}`
  }
  switch (reducer) {
    case 'sum':
      return ''
    case 'min':
      return ' min'
    case 'max':
      return ' max'
    case 'average':
      return ' average'
    case 'median':
      return ' median'
  }
},
```

Add the helper:

```ts
countThresholdToString(range: Range): string {
  switch (range.type) {
    case 'exact':
      return `= ${range.value}`
    case 'value-or-more':
      return `>= ${range.value}`
    case 'value-or-less':
      return `<= ${range.value}`
    case 'between':
      return `${range.minInclusive}..${range.maxInclusive}`
    case 'composite':
      return range.ranges.map(DE.countThresholdToString).join(',')
  }
},
```

- [ ] **Step 6: Update index.ts exports**

Add `type CountReducer`, `type SimpleReducer` to the exports.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing tests should still pass since `'sum'` etc. are still valid `DiceReducer` values)

- [ ] **Step 8: Commit**

```bash
git add src/ test/dice-pool.spec.ts
git commit -m "feat: add dice pool success counting reducer"
```

---

### Task 8: Dice Pools - Parser

**Files:**

- Modify: `test/dice-pool.spec.ts`
- Modify: `src/dice-parser.ts`

- [ ] **Step 1: Add parser tests**

Append to `test/dice-pool.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'

describe('dice pool parsing', () => {
  const cases: { input: string; rendered: string; min: number; max: number }[] =
    [
      { input: '4d10 count >= 6', rendered: '4d10 count >= 6', min: 0, max: 4 },
      { input: '8d10 count >= 6', rendered: '8d10 count >= 6', min: 0, max: 8 },
      { input: '3d6 count = 6', rendered: '3d6 count = 6', min: 0, max: 3 },
      { input: '3d6 count <= 2', rendered: '3d6 count <= 2', min: 3, max: 0 },
      { input: '4d10c6', rendered: '4d10 count >= 6', min: 0, max: 4 },
      {
        input: '(1,2,3) count >= 2',
        rendered: '(1,2,3) count >= 2',
        min: 2,
        max: 2,
      },
    ]

  test.each(cases)('parses $input', ({ input, rendered, min, max }) => {
    const parsed = DiceParser.parse(input)
    expect(parsed.isSuccess()).toBe(true)
    if (parsed.isSuccess()) {
      expect(DE.toString(parsed.value)).toBe(rendered)
      expect(RR.getResult(minRoller().roll(parsed.value))).toBe(min)
      expect(RR.getResult(maxRoller().roll(parsed.value))).toBe(max)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dice-pool.spec.ts`
Expected: FAIL - parser doesn't recognize `count`

- [ ] **Step 3: Add count parsing**

In `src/dice-parser.ts`, update the `diceReduce` function to handle count reducers. Add `type CountReducer` to imports from `./dice-expression`.

Update the `diceReduce` function:

```ts
const COUNT = match('count')
const GTE = match('>=')
const LTE = match('<=')
const EQ = matchChar('=')

const countThreshold: Decoder<TextInput, CountReducer, DecodeError> =
  COUNT.skipNext(WS).pickNext(
    oneOf(
      GTE.skipNext(OWS).pickNext(
        positive.map((v) => ({
          type: 'count' as const,
          threshold: valueOrMore(v),
        })),
      ),
      LTE.skipNext(OWS).pickNext(
        positive.map((v) => ({
          type: 'count' as const,
          threshold: valueOrLess(v),
        })),
      ),
      EQ.skipNext(OWS).pickNext(
        positive.map((v) => ({ type: 'count' as const, threshold: exact(v) })),
      ),
    ),
  )
```

Update the `diceReduce` function to also try count:

```ts
const diceReduce = (
  reduceable: Decoder<TextInput, DiceReduceable, DecodeError>,
): Decoder<TextInput, DiceReduce, DecodeError> => {
  return oneOf(
    reduceable.flatMap((red) => {
      return OWS.pickNext(countThreshold).map((reducer) =>
        makeDiceReduce(red, reducer),
      )
    }),
    reduceable.flatMap((red) => {
      return OWS.pickNext(
        oneOf(
          SUM.withResult('sum'),
          AVERAGE.withResult('average'),
          MEDIAN.withResult('median'),
          MIN.withResult('min'),
          MAX.withResult('max'),
        ),
      ).map((reducer) => makeDiceReduce(red, reducer as DiceReducer))
    }),
    reduceable.map((v) => makeDiceReduce(v, 'sum')),
  )
}
```

Add `c` shorthand for count in the `diceExpressions` or as a separate parser. The `c` shorthand needs to work like `4d10c6`. Add it to the `diceMapeable`-like pattern or create a new decoder:

```ts
const diceCountShorthand = lazy(
  (): Decoder<TextInput, DiceReduce, DecodeError> => {
    return oneOf(
      positive.flatMap((rolls) => {
        return die.flatMap((sides) => {
          return matchChar('c')
            .skipNext(OWS)
            .pickNext(positive)
            .map((v) => {
              const dice = Array.from({ length: rolls }, () => makeDie(sides))
              return makeDiceReduce(makeDiceExpressions(...dice), {
                type: 'count' as const,
                threshold: valueOrMore(v),
              })
            })
        })
      }),
    )
  },
)
```

Add `diceCountShorthand` to `termExpression` before `diceReduce(diceExpressions)`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dice-parser.ts test/dice-pool.spec.ts
git commit -m "feat: add parser support for dice pool count syntax"
```

---

### Task 9: Constant Folding

**Files:**

- Create: `test/simplify.spec.ts`
- Modify: `src/dice-expression-domain.ts`

- [ ] **Step 1: Write failing tests**

Create `test/simplify.spec.ts`:

```ts
import {
  binaryOp,
  die,
  literal,
  unaryOp,
  diceReduce,
  diceExpressions,
} from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'

describe('constant folding / simplify', () => {
  test('folds literal + literal', () => {
    const expr = binaryOp('sum', literal(2), literal(3))
    const simplified = DE.simplify(expr)
    expect(simplified).toEqual(literal(5))
  })

  test('folds literal - literal', () => {
    const expr = binaryOp('difference', literal(10), literal(3))
    expect(DE.simplify(expr)).toEqual(literal(7))
  })

  test('folds literal * literal', () => {
    const expr = binaryOp('multiplication', literal(4), literal(5))
    expect(DE.simplify(expr)).toEqual(literal(20))
  })

  test('folds literal / literal', () => {
    const expr = binaryOp('division', literal(10), literal(3))
    expect(DE.simplify(expr)).toEqual(literal(3))
  })

  test('folds negate literal', () => {
    const expr = unaryOp('negate', literal(5))
    expect(DE.simplify(expr)).toEqual(literal(-5))
  })

  test('folds double negate', () => {
    const expr = unaryOp('negate', unaryOp('negate', literal(5)))
    expect(DE.simplify(expr)).toEqual(literal(5))
  })

  test('eliminates add zero', () => {
    const expr = binaryOp('sum', die(6), literal(0))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates zero + expr', () => {
    const expr = binaryOp('sum', literal(0), die(6))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates multiply by 1', () => {
    const expr = binaryOp('multiplication', die(6), literal(1))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('eliminates 1 * expr', () => {
    const expr = binaryOp('multiplication', literal(1), die(6))
    expect(DE.simplify(expr)).toEqual(die(6))
  })

  test('multiply by 0 becomes 0', () => {
    const expr = binaryOp('multiplication', die(6), literal(0))
    expect(DE.simplify(expr)).toEqual(literal(0))
  })

  test('0 * expr becomes 0', () => {
    const expr = binaryOp('multiplication', literal(0), die(6))
    expect(DE.simplify(expr)).toEqual(literal(0))
  })

  test('does not fold expressions with dice', () => {
    const expr = binaryOp('sum', die(6), die(8))
    expect(DE.simplify(expr)).toEqual(binaryOp('sum', die(6), die(8)))
  })

  test('recursively simplifies nested expressions', () => {
    // (2 + 3) + d6 -> 5 + d6
    const expr = binaryOp(
      'sum',
      binaryOp('sum', literal(2), literal(3)),
      die(6),
    )
    expect(DE.simplify(expr)).toEqual(binaryOp('sum', literal(5), die(6)))
  })

  test('does not modify dice-reduce', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6)), 'sum')
    expect(DE.simplify(expr)).toEqual(expr)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/simplify.spec.ts`
Expected: FAIL - `DE.simplify` is not a function

- [ ] **Step 3: Implement DE.simplify**

Add to the `DE` object in `src/dice-expression-domain.ts`:

```ts
simplify(expr: DiceExpression): DiceExpression {
  switch (expr.type) {
    case 'literal':
    case 'die':
    case 'custom-die':
      return expr
    case 'unary-op': {
      const inner = DE.simplify(expr.expr)
      if (expr.op === 'negate' && inner.type === 'literal') {
        return literal(-inner.value)
      }
      return unaryOp(expr.op, inner)
    }
    case 'binary-op': {
      const left = DE.simplify(expr.left)
      const right = DE.simplify(expr.right)
      // Both literals: fold
      if (left.type === 'literal' && right.type === 'literal') {
        switch (expr.op) {
          case 'sum':
            return literal(left.value + right.value)
          case 'difference':
            return literal(left.value - right.value)
          case 'multiplication':
            return literal(left.value * right.value)
          case 'division':
            return literal(Math.trunc(left.value / right.value))
        }
      }
      // Identity elimination
      if (expr.op === 'sum') {
        if (left.type === 'literal' && left.value === 0) return right
        if (right.type === 'literal' && right.value === 0) return left
      }
      if (expr.op === 'multiplication') {
        if (left.type === 'literal' && left.value === 1) return right
        if (right.type === 'literal' && right.value === 1) return left
        if (left.type === 'literal' && left.value === 0) return literal(0)
        if (right.type === 'literal' && right.value === 0) return literal(0)
      }
      return binaryOp(expr.op, left, right)
    }
    case 'dice-reduce':
      return expr
  }
},
```

Add `literal`, `unaryOp`, `binaryOp` to imports from `./dice-expression` if not already present.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/dice-expression-domain.ts test/simplify.spec.ts
git commit -m "feat: add constant folding via DE.simplify()"
```

---

### Task 10: Parser Error Messages

**Files:**

- Create: `src/parse-error.ts`
- Create: `test/parse-errors.spec.ts`
- Modify: `src/dice-parser.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `test/parse-errors.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'
import type { ParseError } from '../src/parse-error'

describe('parser error messages', () => {
  test('parseWithErrors returns success for valid input', () => {
    const result = DiceParser.parseWithErrors('3d6')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value.type).toBe('dice-reduce')
    }
  })

  test('parseWithErrors returns errors for invalid input', () => {
    const result = DiceParser.parseWithErrors('???')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].message).toBeTruthy()
      expect(typeof result.errors[0].position).toBe('number')
    }
  })

  test('provides position information', () => {
    const result = DiceParser.parseWithErrors('3d6 +')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].position).toBeGreaterThanOrEqual(0)
    }
  })

  test('provides context string', () => {
    const result = DiceParser.parseWithErrors('3d6 explod on 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].context).toBeTruthy()
    }
  })

  test('suggests corrections for misspelled keywords', () => {
    const result = DiceParser.parseWithErrors('3d6 explod on 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasSuggestion = result.errors.some((e) => e.suggestion)
      expect(hasSuggestion).toBe(true)
    }
  })

  test('suggests missing on keyword', () => {
    const result = DiceParser.parseWithErrors('3d6 explode 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasSuggestion = result.errors.some((e) =>
        e.suggestion?.includes('on'),
      )
      expect(hasSuggestion).toBe(true)
    }
  })

  test('empty input returns error', () => {
    const result = DiceParser.parseWithErrors('')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parse-errors.spec.ts`
Expected: FAIL - `parseWithErrors` doesn't exist, `ParseError` type doesn't exist

- [ ] **Step 3: Create parse-error.ts**

Create `src/parse-error.ts`:

```ts
export interface ParseError {
  message: string
  position: number
  suggestion?: string
  context: string
}

export type ParseWithErrorsResult<T> =
  | { success: true; value: T }
  | { success: false; errors: ParseError[] }

const KEYWORDS = [
  'explode',
  'reroll',
  'compound',
  'drop',
  'keep',
  'lowest',
  'highest',
  'average',
  'median',
  'minimum',
  'maximum',
  'emphasis',
  'furthest',
  'count',
  'sum',
  'once',
  'twice',
  'always',
  'on',
  'or',
  'more',
  'less',
  'high',
  'low',
  'times',
]

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  )
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function suggestKeyword(word: string): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const kw of KEYWORDS) {
    const dist = levenshtein(word.toLowerCase(), kw)
    if (dist < bestDist && dist <= 2) {
      bestDist = dist
      best = kw
    }
  }
  return best
}

export function buildParseErrors(
  input: string,
  failureIndex: number,
  rawMessages: string[],
): ParseError[] {
  const position = failureIndex
  const contextStart = Math.max(0, position - 10)
  const contextEnd = Math.min(input.length, position + 10)
  const context = input.substring(contextStart, contextEnd)

  // Try to extract a word at the failure position for suggestion
  const remaining = input.substring(position)
  const wordMatch = remaining.match(/^([a-zA-Z]+)/)
  const suggestion = wordMatch ? suggestKeyword(wordMatch[1]) : undefined

  // Check for common patterns
  const errors: ParseError[] = []

  if (input.trim() === '') {
    errors.push({
      message: 'Empty input: expected a dice expression',
      position: 0,
      context: '',
    })
    return errors
  }

  // Check for "explode <number>" without "on"
  const explodeWithoutOn = input.match(
    /\b(explode|reroll|compound)\s+(\d+)\s*$/,
  )
  if (explodeWithoutOn) {
    errors.push({
      message: `Expected 'on' keyword after '${explodeWithoutOn[1]}'`,
      position: input.indexOf(explodeWithoutOn[0]) + explodeWithoutOn[1].length,
      suggestion: `${explodeWithoutOn[1]} on ${explodeWithoutOn[2]}`,
      context,
    })
    return errors
  }

  const message =
    rawMessages.length > 0
      ? rawMessages.join('; ')
      : `Unexpected input at position ${position}`

  errors.push({
    message,
    position,
    suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
    context,
  })

  return errors
}
```

- [ ] **Step 4: Add parseWithErrors to dice-parser.ts**

Add import at top of `src/dice-parser.ts`:

```ts
import { buildParseErrors, type ParseWithErrorsResult } from './parse-error'
```

Add to the `DiceParser` object:

```ts
parseWithErrors(input: string): ParseWithErrorsResult<DiceExpression> {
  const result = decode(input)
  if (result.isSuccess()) {
    return { success: true, value: result.value }
  }
  const failures = result.getUnsafeFailures()
  const messages = failures.map((f) => {
    if (f instanceof CustomError) {
      return f.message
    }
    return String(f)
  })
  const index = (result as { input?: { index?: number } }).input?.index ?? 0
  const errors = buildParseErrors(input, index, messages)
  return { success: false, errors }
},
```

Note: The exact way to get the failure index from `partsing` results may vary. Check the `partsing` library's result type. If `result` exposes an `input` with `index`, use that. Otherwise use the raw failure position from `DecodeResult`. You may need to adapt based on the actual `partsing` API - inspect the failure result shape.

- [ ] **Step 5: Update index.ts exports**

Add:

```ts
export type { ParseError, ParseWithErrorsResult } from './parse-error'
export { suggestKeyword } from './parse-error'
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/parse-error.ts src/dice-parser.ts test/parse-errors.spec.ts src/index.ts
git commit -m "feat: add parseWithErrors with contextual messages and suggestions"
```

---

### Task 11: Probability Analysis - Exact Distribution

**Files:**

- Create: `src/dice-stats.ts`
- Create: `test/stats.spec.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests for exact analysis**

Create `test/stats.spec.ts`:

```ts
import {
  die,
  literal,
  binaryOp,
  diceReduce,
  diceExpressions,
  customDie,
} from '../src/dice-expression'
import { DiceStats } from '../src/dice-stats'

describe('exact probability analysis', () => {
  test('d6 distribution', () => {
    const dist = DiceStats.distribution(die(6))
    expect(dist.size).toBe(6)
    for (let i = 1; i <= 6; i++) {
      expect(dist.get(i)).toBeCloseTo(1 / 6)
    }
  })

  test('literal distribution', () => {
    const dist = DiceStats.distribution(literal(5))
    expect(dist.size).toBe(1)
    expect(dist.get(5)).toBe(1)
  })

  test('d6 + d6 distribution', () => {
    const dist = DiceStats.distribution(binaryOp('sum', die(6), die(6)))
    expect(dist.size).toBe(11) // 2 through 12
    expect(dist.get(7)).toBeCloseTo(6 / 36) // most likely
    expect(dist.get(2)).toBeCloseTo(1 / 36)
    expect(dist.get(12)).toBeCloseTo(1 / 36)
  })

  test('d6 mean', () => {
    expect(DiceStats.mean(die(6))).toBeCloseTo(3.5)
  })

  test('2d6 mean', () => {
    const expr = binaryOp('sum', die(6), die(6))
    expect(DiceStats.mean(expr)).toBeCloseTo(7)
  })

  test('d6 stddev', () => {
    const sd = DiceStats.stddev(die(6))
    expect(sd).toBeCloseTo(1.7078, 3)
  })

  test('d6 min/max', () => {
    expect(DiceStats.min(die(6))).toBe(1)
    expect(DiceStats.max(die(6))).toBe(6)
  })

  test('literal min/max', () => {
    expect(DiceStats.min(literal(5))).toBe(5)
    expect(DiceStats.max(literal(5))).toBe(5)
  })

  test('d6 + 3 distribution', () => {
    const dist = DiceStats.distribution(binaryOp('sum', die(6), literal(3)))
    expect(dist.size).toBe(6) // 4 through 9
    expect(dist.get(4)).toBeCloseTo(1 / 6)
    expect(dist.get(9)).toBeCloseTo(1 / 6)
  })

  test('negate distribution', () => {
    const dist = DiceStats.distribution({
      type: 'unary-op',
      op: 'negate',
      expr: die(6),
    })
    expect(dist.size).toBe(6)
    expect(dist.get(-1)).toBeCloseTo(1 / 6)
    expect(dist.get(-6)).toBeCloseTo(1 / 6)
  })

  test('d6 * 2 distribution', () => {
    const dist = DiceStats.distribution(
      binaryOp('multiplication', die(6), literal(2)),
    )
    expect(dist.size).toBe(6) // 2,4,6,8,10,12
    expect(dist.get(2)).toBeCloseTo(1 / 6)
  })

  test('custom die distribution', () => {
    const dist = DiceStats.distribution(customDie([-1, 0, 1]))
    expect(dist.size).toBe(3)
    expect(dist.get(-1)).toBeCloseTo(1 / 3)
    expect(dist.get(0)).toBeCloseTo(1 / 3)
    expect(dist.get(1)).toBeCloseTo(1 / 3)
  })

  test('3d6 sum distribution has correct mean', () => {
    const expr = diceReduce(diceExpressions(die(6), die(6), die(6)), 'sum')
    expect(DiceStats.mean(expr)).toBeCloseTo(10.5)
  })

  test('percentile', () => {
    // d6: 50th percentile should be 3 or 4
    const p50 = DiceStats.percentile(die(6), 50)
    expect(p50).toBeGreaterThanOrEqual(3)
    expect(p50).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/stats.spec.ts`
Expected: FAIL - `DiceStats` doesn't exist

- [ ] **Step 3: Implement dice-stats.ts - exact analysis**

Create `src/dice-stats.ts`:

```ts
import type { DiceExpression, DiceReduceable, Range } from './dice-expression'
import { Roller } from './roller'

type Distribution = Map<number, number>

function singleDieDistribution(sides: number): Distribution {
  const dist: Distribution = new Map()
  const prob = 1 / sides
  for (let i = 1; i <= sides; i++) {
    dist.set(i, prob)
  }
  return dist
}

function customDieDistribution(faces: number[]): Distribution {
  const dist: Distribution = new Map()
  const prob = 1 / faces.length
  for (const face of faces) {
    dist.set(face, (dist.get(face) ?? 0) + prob)
  }
  return dist
}

function literalDistribution(value: number): Distribution {
  return new Map([[value, 1]])
}

function combineBinaryOp(
  left: Distribution,
  right: Distribution,
  op: (a: number, b: number) => number,
): Distribution {
  const result: Distribution = new Map()
  for (const [lv, lp] of left) {
    for (const [rv, rp] of right) {
      const value = op(lv, rv)
      result.set(value, (result.get(value) ?? 0) + lp * rp)
    }
  }
  return result
}

function negateDistribution(dist: Distribution): Distribution {
  const result: Distribution = new Map()
  for (const [v, p] of dist) {
    result.set(-v, p)
  }
  return result
}

function reduceDistributions(
  distributions: Distribution[],
  reducer: 'sum' | 'min' | 'max' | 'average' | 'median',
): Distribution {
  if (distributions.length === 0) return new Map()
  if (distributions.length === 1) {
    if (reducer === 'sum') return distributions[0]
    return distributions[0]
  }

  // For sum, convolve all distributions
  if (reducer === 'sum') {
    let result = distributions[0]
    for (let i = 1; i < distributions.length; i++) {
      result = combineBinaryOp(result, distributions[i], (a, b) => a + b)
    }
    return result
  }

  // For min/max/average/median, enumerate all combinations
  return enumerateReduce(distributions, reducer)
}

function enumerateReduce(
  distributions: Distribution[],
  reducer: 'min' | 'max' | 'average' | 'median',
): Distribution {
  // Convert each distribution to array of [value, prob] pairs
  const distArrays = distributions.map((d) => [...d.entries()])

  // Generate all combinations
  const result: Distribution = new Map()

  function enumerate(index: number, values: number[], prob: number) {
    if (index === distArrays.length) {
      let reduced: number
      switch (reducer) {
        case 'min':
          reduced = Math.min(...values)
          break
        case 'max':
          reduced = Math.max(...values)
          break
        case 'average':
          reduced = Math.round(
            values.reduce((a, b) => a + b, 0) / values.length,
          )
          break
        case 'median': {
          const sorted = values.slice().sort((a, b) => a - b)
          const mid = Math.floor(sorted.length / 2)
          reduced =
            sorted.length % 2 === 0
              ? (sorted[mid] + sorted[mid - 1]) / 2
              : sorted[mid]
          break
        }
      }
      result.set(reduced, (result.get(reduced) ?? 0) + prob)
      return
    }
    for (const [value, p] of distArrays[index]) {
      values.push(value)
      enumerate(index + 1, values, prob * p)
      values.pop()
    }
  }

  enumerate(0, [], 1)
  return result
}

function computeDistribution(expr: DiceExpression): Distribution {
  switch (expr.type) {
    case 'die':
      return singleDieDistribution(expr.sides)
    case 'custom-die':
      return customDieDistribution(expr.faces)
    case 'literal':
      return literalDistribution(expr.value)
    case 'unary-op':
      if (expr.op === 'negate') {
        return negateDistribution(computeDistribution(expr.expr))
      }
      throw new Error(`Unknown unary op: ${expr.op}`)
    case 'binary-op': {
      const left = computeDistribution(expr.left)
      const right = computeDistribution(expr.right)
      switch (expr.op) {
        case 'sum':
          return combineBinaryOp(left, right, (a, b) => a + b)
        case 'difference':
          return combineBinaryOp(left, right, (a, b) => a - b)
        case 'multiplication':
          return combineBinaryOp(left, right, (a, b) => a * b)
        case 'division':
          return combineBinaryOp(left, right, (a, b) => Math.trunc(a / b))
      }
      break
    }
    case 'dice-reduce': {
      const reducer = expr.reducer
      if (typeof reducer === 'object' && reducer.type === 'count') {
        return computeCountDistribution(expr.reduceable, reducer.threshold)
      }
      return computeReduceableDistribution(
        expr.reduceable,
        typeof reducer === 'string' ? reducer : 'sum',
      )
    }
  }
}

function computeReduceableDistribution(
  reduceable: DiceReduceable,
  reducer: 'sum' | 'min' | 'max' | 'average' | 'median',
): Distribution {
  switch (reduceable.type) {
    case 'dice-expressions': {
      const dists = reduceable.exprs.map(computeDistribution)
      return reduceDistributions(dists, reducer)
    }
    case 'dice-list-with-filter':
      // Complex: would need to enumerate all combinations and apply filter
      // Fall back to simplified approach for now
      return computeFilteredDistribution(reduceable, reducer)
    case 'dice-list-with-map':
      // Complex: explode/reroll/compound distributions are hard to compute exactly
      // Fall back to Monte Carlo for these
      throw new Error('exact-not-supported')
  }
}

function computeFilteredDistribution(
  reduceable: import('./dice-expression').DiceListWithFilter,
  reducer: 'sum' | 'min' | 'max' | 'average' | 'median',
): Distribution {
  const dice =
    reduceable.list.type === 'filterable-dice-array'
      ? reduceable.list.dice.map(singleDieDistribution)
      : reduceable.list.exprs.map(computeDistribution)

  const distArrays = dice.map((d) => [...d.entries()])
  const result: Distribution = new Map()
  const filter = reduceable.filter

  function enumerate(index: number, values: number[], prob: number) {
    if (index === distArrays.length) {
      const sorted = values.slice().sort((a, b) => a - b)
      let kept: number[]
      if (filter.type === 'drop') {
        if (filter.dir === 'low') {
          kept = sorted.slice(filter.value)
        } else {
          kept = sorted.slice(0, sorted.length - filter.value)
        }
      } else {
        if (filter.dir === 'high') {
          kept = sorted.slice(sorted.length - filter.value)
        } else {
          kept = sorted.slice(0, filter.value)
        }
      }

      let reduced: number
      switch (reducer) {
        case 'sum':
          reduced = kept.reduce((a, b) => a + b, 0)
          break
        case 'min':
          reduced = Math.min(...kept)
          break
        case 'max':
          reduced = Math.max(...kept)
          break
        case 'average':
          reduced = Math.round(kept.reduce((a, b) => a + b, 0) / kept.length)
          break
        case 'median': {
          const mid = Math.floor(kept.length / 2)
          reduced =
            kept.length % 2 === 0 ? (kept[mid] + kept[mid - 1]) / 2 : kept[mid]
          break
        }
      }
      result.set(reduced, (result.get(reduced) ?? 0) + prob)
      return
    }
    for (const [value, p] of distArrays[index]) {
      values.push(value)
      enumerate(index + 1, values, prob * p)
      values.pop()
    }
  }

  enumerate(0, [], 1)
  return result
}

function computeCountDistribution(
  reduceable: DiceReduceable,
  threshold: Range,
): Distribution {
  if (reduceable.type !== 'dice-expressions') {
    throw new Error('exact-not-supported')
  }

  const dists = reduceable.exprs.map(computeDistribution)
  const distArrays = dists.map((d) => [...d.entries()])
  const result: Distribution = new Map()

  function enumerate(index: number, count: number, prob: number) {
    if (index === distArrays.length) {
      result.set(count, (result.get(count) ?? 0) + prob)
      return
    }
    for (const [value, p] of distArrays[index]) {
      const matches = Roller.matchRange(value, threshold) ? 1 : 0
      enumerate(index + 1, count + matches, prob * p)
    }
  }

  enumerate(0, 0, 1)
  return result
}

function meanFromDist(dist: Distribution): number {
  let sum = 0
  for (const [v, p] of dist) {
    sum += v * p
  }
  return sum
}

function stddevFromDist(dist: Distribution): number {
  const m = meanFromDist(dist)
  let variance = 0
  for (const [v, p] of dist) {
    variance += (v - m) ** 2 * p
  }
  return Math.sqrt(variance)
}

function percentileFromDist(dist: Distribution, percentile: number): number {
  const entries = [...dist.entries()].sort((a, b) => a[0] - b[0])
  const target = percentile / 100
  let cumulative = 0
  for (const [value, prob] of entries) {
    cumulative += prob
    if (cumulative >= target) {
      return value
    }
  }
  return entries[entries.length - 1][0]
}

export const DiceStats = {
  distribution(expr: DiceExpression): Distribution {
    return computeDistribution(expr)
  },

  mean(expr: DiceExpression): number {
    return meanFromDist(computeDistribution(expr))
  },

  stddev(expr: DiceExpression): number {
    return stddevFromDist(computeDistribution(expr))
  },

  min(expr: DiceExpression): number {
    const dist = computeDistribution(expr)
    return Math.min(...dist.keys())
  },

  max(expr: DiceExpression): number {
    const dist = computeDistribution(expr)
    return Math.max(...dist.keys())
  },

  percentile(expr: DiceExpression, p: number): number {
    return percentileFromDist(computeDistribution(expr), p)
  },
}
```

- [ ] **Step 4: Update index.ts exports**

Add:

```ts
export { DiceStats } from './dice-stats'
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/dice-stats.ts test/stats.spec.ts src/index.ts
git commit -m "feat: add exact probability distribution analysis"
```

---

### Task 12: Probability Analysis - Monte Carlo & Summary

**Files:**

- Modify: `test/stats.spec.ts`
- Modify: `src/dice-stats.ts`

- [ ] **Step 1: Add Monte Carlo and summary tests**

Append to `test/stats.spec.ts`:

```ts
describe('Monte Carlo analysis', () => {
  test('d6 Monte Carlo approximates uniform distribution', () => {
    const result = DiceStats.monteCarlo(die(6), { trials: 50000 })
    expect(result.mean).toBeCloseTo(3.5, 0)
    expect(result.min).toBe(1)
    expect(result.max).toBe(6)
    expect(result.distribution.size).toBe(6)
  })

  test('2d6 Monte Carlo approximates correct mean', () => {
    const expr = binaryOp('sum', die(6), die(6))
    const result = DiceStats.monteCarlo(expr, { trials: 50000 })
    expect(result.mean).toBeCloseTo(7, 0)
  })

  test('Monte Carlo default trials', () => {
    const result = DiceStats.monteCarlo(die(6))
    expect(result.mean).toBeCloseTo(3.5, 0)
  })

  test('Monte Carlo percentile function', () => {
    const result = DiceStats.monteCarlo(die(6), { trials: 50000 })
    const p50 = result.percentile(50)
    expect(p50).toBeGreaterThanOrEqual(3)
    expect(p50).toBeLessThanOrEqual(4)
  })
})

describe('summary', () => {
  test('d6 summary uses exact analysis', () => {
    const result = DiceStats.summary(die(6))
    expect(result.min).toBe(1)
    expect(result.max).toBe(6)
    expect(result.mean).toBeCloseTo(3.5)
    expect(result.distribution.size).toBe(6)
    expect(result.percentiles[50]).toBeGreaterThanOrEqual(3)
  })

  test('summary falls back to Monte Carlo for complex expressions', () => {
    // Exploding dice require Monte Carlo
    const expr = diceReduce(
      diceListWithMap([6], explode(always(), exact(6))),
      'sum',
    )
    const result = DiceStats.summary(expr)
    expect(result.min).toBeGreaterThanOrEqual(1)
    expect(result.mean).toBeGreaterThan(0)
  })
})
```

Add required imports at top:

```ts
import { diceListWithMap, explode, always, exact } from '../src/dice-expression'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/stats.spec.ts`
Expected: FAIL - `DiceStats.monteCarlo` and `DiceStats.summary` don't exist

- [ ] **Step 3: Add Monte Carlo and summary to dice-stats.ts**

Add to `src/dice-stats.ts`:

```ts
interface MonteCarloResult {
  mean: number
  stddev: number
  min: number
  max: number
  distribution: Distribution
  percentile: (p: number) => number
}

interface SummaryResult {
  min: number
  max: number
  mean: number
  stddev: number
  distribution: Distribution
  percentiles: Record<number, number>
}

interface MonteCarloOptions {
  trials?: number
}

const COMPLEXITY_THRESHOLD = 20
```

Add to the `DiceStats` object:

```ts
monteCarlo(
  expr: DiceExpression,
  options?: MonteCarloOptions,
): MonteCarloResult {
  const trials = options?.trials ?? 10000
  const roller = new Roller((max) => Math.floor(Math.random() * max) + 1)
  const results: number[] = []
  const dist: Distribution = new Map()

  for (let i = 0; i < trials; i++) {
    const value = RR.getResult(roller.roll(expr))
    results.push(value)
    dist.set(value, (dist.get(value) ?? 0) + 1)
  }

  // Normalize distribution
  for (const [k, v] of dist) {
    dist.set(k, v / trials)
  }

  const mean = results.reduce((a, b) => a + b, 0) / results.length
  const variance =
    results.reduce((a, b) => a + (b - mean) ** 2, 0) / results.length
  const sorted = results.slice().sort((a, b) => a - b)

  return {
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    distribution: dist,
    percentile: (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)]
    },
  }
},

summary(expr: DiceExpression): SummaryResult {
  try {
    const dist = computeDistribution(expr)
    const mean = meanFromDist(dist)
    return {
      min: Math.min(...dist.keys()),
      max: Math.max(...dist.keys()),
      mean,
      stddev: stddevFromDist(dist),
      distribution: dist,
      percentiles: {
        25: percentileFromDist(dist, 25),
        50: percentileFromDist(dist, 50),
        75: percentileFromDist(dist, 75),
      },
    }
  } catch {
    // Falls back to Monte Carlo for unsupported expressions
    const mc = DiceStats.monteCarlo(expr, { trials: 50000 })
    return {
      min: mc.min,
      max: mc.max,
      mean: mc.mean,
      stddev: mc.stddev,
      distribution: mc.distribution,
      percentiles: {
        25: mc.percentile(25),
        50: mc.percentile(50),
        75: mc.percentile(75),
      },
    }
  }
},
```

Add import for `RR` from `./roll-result-domain`.

- [ ] **Step 4: Export new types from index.ts**

No additional exports needed beyond what Task 11 added (DiceStats is already exported).

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/dice-stats.ts test/stats.spec.ts
git commit -m "feat: add Monte Carlo simulation and summary to DiceStats"
```

---

### Task 13: Final Integration & Verification

**Files:**

- All source and test files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `npx eslint .`
Expected: No errors

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run formatter check**

Run: `npx prettier --check .`
Expected: All files formatted

- [ ] **Step 5: Run full verify**

Run: `npm run verify`
Expected: All checks pass

- [ ] **Step 6: Run coverage**

Run: `npx vitest run --coverage`
Expected: Good coverage across all new code

- [ ] **Step 7: Final commit if any formatting fixes needed**

```bash
npx prettier --write .
git add -A
git commit -m "chore: formatting cleanup"
```
