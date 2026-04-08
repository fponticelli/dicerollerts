# Dice Language Design Spec

## Overview

Extend dicerollerts from a single-expression parser to a full scripting language for tabletop RPG automation. The language supports variables, conditionals, records, arrays, and loops, with dice expressions embedded in backtick-delimited blocks.

The existing single-expression parser (`DiceParser.parse()`) remains unchanged. A new `DiceParser.parseProgram()` entry point parses the full language.

## Example

```
$str_mod = 5
$ac = 15

$attack = `d20 + $str_mod`
$hit = $attack >= $ac
$crit = $attack >= 20

$damage = if $crit
  then `4d6 + $str_mod`
  else if $hit
    then `2d6 + $str_mod`
    else 0

{ attack: $attack, hit: $hit, crit: $crit, damage: $damage }
```

## Variables

Variables are prefixed with `$` and contain only lowercase letters and underscores: `$[a-z_]+`.

```
$str_mod = 5
$name = "Fireball"
$hit = true
```

Variables are **immutable**. Reassignment is an error:

```
$x = 5
$x = 10  # error: $x is already defined
```

Variables are scoped: variables defined inside a `repeat` block are local to each iteration. Variables defined at the top level are global.

## Types

| Type    | Literal syntax       | Examples                          |
| ------- | -------------------- | --------------------------------- |
| number  | integer literals     | `5`, `-3`, `0`                    |
| boolean | `true`, `false`      | `$hit = $roll >= 15`              |
| string  | double-quoted        | `"Fireball"`, `"missed"`          |
| array   | `[expr, ...]`        | `[1, 2, 3]`, `repeat 6 { ... }`   |
| record  | `{ key: expr, ... }` | `{ attack: $roll, damage: $dmg }` |

Boolean coercion: `true` = 1, `false` = 0 in arithmetic contexts.

## Dice Expressions

Dice expressions are delimited by backticks and use the existing dice notation grammar unchanged:

```
$roll = `d20 + 5`
$damage = `4d6 drop 1`
$hits = `8d10 count >= 6`
```

Inside backticks, `$variables` are substituted as numbers before evaluation:

```
$mod = 5
$roll = `d20 + $mod`
```

Parametric dice use uppercase `D` to avoid ambiguity (since variable names are lowercase-only, the parser knows `D` starts the die specification):

```
$num = 3
$sides = 8
$roll = `$numD$sides`      # equivalent to 3d8
$roll2 = `$numD6`           # equivalent to 3d6
$roll3 = `3D$sides`         # equivalent to 3d8
```

Standard lowercase `d` notation continues to work for literal values: `` `3d6` ``, `` `dF` ``, `` `d{1,2,3}` ``.

## Operators

### Arithmetic (number -> number)

`+`, `-`, `*`, `/` (truncating integer division). Standard precedence.

### Comparison (number -> boolean)

`==`, `!=`, `>`, `<`, `>=`, `<=`

These only exist outside backticks. Inside backticks, `>=` etc. are part of dice notation (e.g., `count >= 6`).

### Boolean (boolean -> boolean)

`and`, `or`, `not`

```
$hit = $roll >= $ac
$flanking = true
$sneak_attack = $hit and $flanking
```

### String concatenation

`+` between strings concatenates:

```
$label = "Rolled " + "damage"
```

## Conditionals

`if/then/else` is an expression. `else` is required.

```
$damage = if $crit then `4d6 + 3` else `2d6 + 3`

$result = if $roll >= 20
  then "critical hit"
  else if $roll >= $ac
    then "hit"
    else "miss"
```

## Records

Records are key-value pairs. Keys are unquoted identifiers.

```
$result = { attack: $roll, damage: $damage, hit: $hit }
```

Field access via dot notation:

```
$atk = { roll: `d20 + 5`, hit: false }
$value = $atk.roll
```

Shorthand when variable name matches key:

```
$attack = `d20 + 5`
$damage = `2d6 + 3`
{ $attack, $damage }
# equivalent to { attack: $attack, damage: $damage }
```

## Arrays

Array literals use brackets:

```
$dice = [6, 8, 10, 12]
```

Indexing with brackets (zero-based):

```
$first = $dice[0]
```

Arrays are also produced by `repeat`.

## Repeat

`repeat` evaluates a block N times and returns an array:

```
$scores = repeat 6 { `4d6 drop 1` }
# e.g. [14, 12, 16, 9, 13, 11]
```

The block can contain multiple statements. Variables inside are scoped to each iteration. The last expression in the block is the iteration's value:

```
$attacks = repeat 3 {
  $roll = `d20 + 5`
  $hit = $roll >= 15
  { roll: $roll, hit: $hit }
}
# e.g. [{ roll: 18, hit: true }, { roll: 9, hit: false }, { roll: 22, hit: true }]
```

The count can be a variable:

```
$n = 4
$rolls = repeat $n { `d6` }
```

## Comments

Line comments with `#`:

```
# This is a comment
$roll = `d20 + 5`  # inline comment
```

## Statements

Statements are newline-separated. A program is a sequence of statements. The last expression is the program's output value.

```
$mod = 5              # assignment statement
$roll = `d20 + $mod`  # assignment statement
$roll                  # expression statement (this is the output)
```

## Reserved Words

`if`, `then`, `else`, `true`, `false`, `and`, `or`, `not`, `repeat`

These cannot be used as record keys.

## Program Output and Probability Analysis

The last expression in a program is its output. This can be any type: number, boolean, string, array, or record.

For probability analysis, the entire program is executed N times via Monte Carlo. Each execution uses fresh random rolls. Distributions are collected for each output field:

- **Number output**: one distribution (same as today's single-expression behavior)
- **Record output**: one distribution per numeric field, displayed side by side
- **Array output**: one distribution per element, or aggregate statistics
- **Boolean output**: percentage true/false
- **String output**: frequency table

This means the program must be **re-executable** with different random outcomes. All dice expressions (backtick blocks) roll independently on each execution. Variables derived from dice results will naturally vary across executions.

## Parser API

```ts
// Existing - unchanged
DiceParser.parse(input: string): DecodeResult<DiceExpression>
DiceParser.parseOrNull(input: string): DiceExpression | null
DiceParser.parseWithErrors(input: string): ParseWithErrorsResult<DiceExpression>

// New
DiceParser.parseProgram(input: string): ParseProgramResult
```

Where `ParseProgramResult` is:

```ts
type ParseProgramResult =
  | { success: true; program: Program }
  | { success: false; errors: ParseError[] }
```

## AST Types

```ts
interface Program {
  statements: Statement[]
}

type Statement = Assignment | ExpressionStatement

interface Assignment {
  type: 'assignment'
  name: string // variable name without $
  value: Expression
}

interface ExpressionStatement {
  type: 'expression'
  expr: Expression
}

type Expression =
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

interface DiceExpr {
  type: 'dice'
  expr: DiceExpression // existing AST type, with variable refs for $substitution
  source: string // original backtick content for display
}

interface VariableRef {
  type: 'variable-ref'
  name: string // without $
}
```

`VariableRef` is used both as a top-level `Expression` (for `$x` in algebra context) and as a `DiceExpression` node (for `$mod` inside backticks). It is added to the `DiceExpression` union so the existing dice parser can produce it when it encounters `$name` inside backtick content.

```ts

```

## Evaluator

A new `Evaluator` class executes a `Program`:

```ts
class Evaluator {
  constructor(roller: Roller)
  run(program: Program): Value
}

type Value = number | boolean | string | Value[] | Record<string, Value>
```

The evaluator walks statements in order, maintains an environment (variable bindings), evaluates dice expressions via the Roller, and returns the final expression's value.

## Error Handling

### Parse errors

Same `ParseError` type with message, position, suggestion, context.

### Runtime errors

```ts
interface RuntimeError {
  message: string
  location?: { line: number; column: number }
}
```

Runtime errors include:

- Reassigning an immutable variable
- Undefined variable reference
- Type mismatch (e.g., `"hello" >= 5`)
- Index out of bounds
- Field access on non-record
- Division by zero

## Scope

This spec covers the **library** (`dicerollerts`) only: parser, AST, evaluator, and probability analysis. The UI changes to `dicerun-ts` (multi-line editor, multiple probability charts, record display) are a separate spec.

## Testing Strategy

TDD throughout. Test files:

- `test/program-parser.spec.ts` -- parsing programs to AST
- `test/evaluator.spec.ts` -- evaluating programs to values
- `test/program-stats.spec.ts` -- Monte Carlo probability analysis on programs

## Architecture

New files:

- `src/program.ts` -- Program AST types
- `src/program-parser.ts` -- Program parser (uses existing dice parser for backtick content)
- `src/evaluator.ts` -- Program evaluator
- `src/program-stats.ts` -- Probability analysis for programs

Extended files:

- `src/dice-parser.ts` -- add `parseProgram` to `DiceParser`
- `src/dice-expression.ts` -- add `VariableRef` node for `$var` inside dice expressions
- `src/index.ts` -- export new types and modules
