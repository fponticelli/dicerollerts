# Parameter Declarations Design Spec

## Overview

Add a parameter declaration syntax (`$name is { ... }`) to the dice scripting language. Parameters are variables with a default value and optional metadata that can be overridden at runtime. Tooling can introspect parameters to render UI inputs.

The existing single-expression API and program assignment syntax remain unchanged. Annotations on regular assignments are out of scope for this spec.

## Example

```
$str_mod is {
  default: 5,
  min: 0,
  max: 30,
  label: "STR Modifier",
  description: "Your strength bonus",
}

$ac is {
  default: 15,
  label: "Target AC",
}

$weapon is {
  default: "longsword",
  enum: ["longsword", "dagger", "greataxe"],
  label: "Weapon",
}

$advantage is {
  default: false,
  label: "Has Advantage?",
}

$attack_die is {
  default: `d20`,
  label: "Attack Die",
  description: "Override with 2d20 keep 1 for advantage, etc.",
}

$attack = $attack_die + $str_mod
$hit = $attack >= $ac
$damage = if $hit then `2d6 + $str_mod` else 0
{ attack: $attack, hit: $hit, damage: $damage }
```

A UI can render five form inputs (slider, number, dropdown, toggle, text), pre-filled with defaults, and pass user-edited values back as overrides.

## Syntax

### Parameter declaration

```
$NAME is { FIELD : EXPR , FIELD : EXPR , ... }
```

- `$NAME` follows the existing variable rules: `$[a-z_][a-z0-9_]*`
- `is` is a reserved keyword
- The body is a record-like block of comma-separated `key: value` pairs
- Trailing commas are allowed
- Statements are still newline-separated

### Field grammar

| Field         | Required | Value type                                | Notes                                                                                                   |
| ------------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `default`     | Yes      | literal value or backtick dice expression | The fallback value used when no override is provided                                                    |
| `label`       | No       | string literal                            | Display name for UI                                                                                     |
| `description` | No       | string literal                            | Tooltip / help text                                                                                     |
| `min`         | No       | number literal                            | Only valid when `default` is a number                                                                   |
| `max`         | No       | number literal                            | Only valid when `default` is a number                                                                   |
| `enum`        | No       | array literal of literal values           | Only valid when `default` is non-number; values must match default's type; default must be in the array |

Unknown fields are a parse error.

### Default value forms

The `default` field accepts:

- A number literal: `5`, `-3`, `0`
- A boolean literal: `true`, `false`
- A string literal: `"longsword"`
- A backtick dice expression: `` `d20` ``, `` `2d6 + 1` ``

Other forms (variable references, arithmetic, records, arrays, conditionals) are not allowed in `default`. Defaults are constant or stochastic; they cannot depend on other variables in the program.

### Reserved words

Add `is` to the reserved word list. Cannot be used as a record key or variable name.

## Validation (parse time)

The parser enforces:

1. `default` field is present
2. All field names are recognized (one of: `default`, `label`, `description`, `min`, `max`, `enum`)
3. `label` and `description` are string literals
4. `min` and `max` are number literals
5. `enum` is an array literal of literal values
6. `min`, `max` only appear when `default` is a number literal
7. `enum` only appears when `default` is a non-number literal
8. All `enum` entries are the same kind as `default`
9. The `default` value is a member of `enum` (when `enum` is present)
10. `min <= default <= max` (when both bounds present)
11. `min <= max` (when both present)

Violations produce `ParseError` with position and message.

## Runtime semantics

### Default evaluation

When the program is executed (single roll, Monte Carlo trial, or exact analysis), each parameter's value is determined as follows:

1. If an override is provided in the parameters dict, use the override value
2. Otherwise, evaluate the default expression:
   - Literal values resolve to themselves
   - Backtick dice expressions are rolled (one fresh roll per execution)

Parameters appear in the environment just like assignments; they can be referenced from any subsequent expression.

### Parameter overrides

```ts
evaluator.run(program, {
  parameters: { str_mod: 7, weapon: 'dagger' },
})

ProgramStats.analyze(program, {
  parameters: { str_mod: 7 },
})

ProgramStats.analyzeAsync(program, {
  parameters: { str_mod: 7 },
  signal,
})
```

Overrides are a `Record<string, Value>`. Validation at runtime:

- Each override key must correspond to a declared parameter; unknown keys throw a runtime error
- Each override value's type must match the parameter's default kind:
  - Number default → override must be `number`
  - Boolean default → override must be `boolean`
  - String default → override must be `string`
  - Dice expression default → override must be `number` (the UI is responsible for rolling/evaluating any user-entered dice expression first)
- For numbers with `min`/`max`: override must be in range
- For values with `enum`: override must be a member of the enum

Validation errors throw `RuntimeError` with a clear message.

### Probability analysis with overrides

When `analyze()` is called with `parameters`, the override values are treated as constants for the duration of the analysis. This means:

- A parameter that was a dice expression default becomes a constant when overridden, narrowing the analysis
- The classifier and exact-tier analysis re-run with the parameters bound

Without overrides, dice expression defaults contribute their full distribution to the analysis. Other defaults are constants.

## AST changes

### New statement type

```ts
interface ParameterDeclaration {
  type: 'parameter-declaration'
  name: string
  spec: ParameterSpec
}

interface ParameterSpec {
  default: ParameterDefault
  label?: string
  description?: string
  min?: number
  max?: number
  enum?: Value[]
}

type ParameterDefault =
  | { kind: 'value'; value: Value }
  | { kind: 'dice'; expr: DiceExpression; source: string }

type Statement = Assignment | ExpressionStatement | ParameterDeclaration
```

### Factory function

```ts
export function parameterDeclaration(
  name: string,
  spec: ParameterSpec,
): ParameterDeclaration
```

## Public API

### Extracting parameters

```ts
ProgramParameters.list(program: Program): Parameter[]

interface Parameter {
  name: string                    // without $
  default: Value                  // resolved literal value (or NaN-style sentinel for dice exprs)
  defaultExpr?: DiceExpression    // present only when default is a dice expression
  defaultSource?: string          // original backtick content (when dice expression)
  label?: string
  description?: string
  min?: number
  max?: number
  enum?: Value[]
}
```

For dice-expression defaults, `default` is `undefined` and `defaultExpr` / `defaultSource` are populated. For literal defaults, `default` is set and `defaultExpr` is undefined.

Tooling can determine the input kind by inspecting the parameter:

```ts
function inputKind(p: Parameter): string {
  if (p.defaultExpr) return 'expression'
  if (typeof p.default === 'boolean') return 'toggle'
  if (typeof p.default === 'string') {
    return p.enum ? 'dropdown' : 'text'
  }
  if (typeof p.default === 'number') {
    if (p.min !== undefined && p.max !== undefined) return 'bounded'
    if (p.min !== undefined || p.max !== undefined) return 'bounded'
    return 'number'
  }
  return 'unknown'
}
```

This logic lives in the consumer, not the library. The library exposes the data; the UI decides how to render.

### Updated execution APIs

All three entry points accept `parameters`:

```ts
interface RunOptions {
  parameters?: Record<string, Value>
}

evaluator.run(program: Program, options?: RunOptions): Value

interface AnalyzeOptions {
  // ... existing fields ...
  parameters?: Record<string, Value>
}

interface AnalyzeAsyncOptions extends AnalyzeOptions {
  signal?: AbortSignal
  yieldEvery?: number
}

ProgramStats.analyze(program, options?): AnalyzeResult
ProgramStats.analyzeAsync(program, options?): AsyncGenerator<AsyncProgress>
```

Existing call sites without `parameters` continue to work unchanged. Programs without parameter declarations also work unchanged (overrides for non-existent parameters error as before).

## Error types

New `RuntimeError` cases:

- `Unknown parameter: $name`
- `Type mismatch for parameter $name: expected number, got string`
- `Parameter $name out of range: 50 not in [0, 30]`
- `Parameter $name not in allowed values: "katana" not in ["longsword", "dagger", "greataxe"]`

New `ParseError` cases:

- `Parameter $name missing required field 'default'`
- `Unknown field 'foo' in parameter $name (allowed: default, label, description, min, max, enum)`
- `Field 'min' is only valid for number defaults`
- `Field 'enum' is only valid for non-number defaults`
- `Field 'label' must be a string literal`
- `Default value 5 is not a member of enum [1, 2, 3]`
- `min (10) must be <= max (5)`
- `default (50) is out of range [0, 30]`

## File structure

| File                                    | Responsibility                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/program.ts`                        | Add `ParameterDeclaration`, `ParameterSpec`, `ParameterDefault` types and factories; update `Statement` union |
| `src/program-parser.ts`                 | Add `parseParameterDeclaration`, `is` keyword, validation logic                                               |
| `src/evaluator.ts`                      | Handle `parameter-declaration` statement; accept `parameters` option; validate overrides                      |
| `src/program-stats.ts`                  | Thread `parameters` through analyze/analyzeAsync/classify; treat parameters as bound values during analysis   |
| `src/program-annotations.ts` (NEW)      | Public `ProgramParameters.list()` API                                                                         |
| `src/index.ts`                          | Export new types and module                                                                                   |
| `test/program-parser.spec.ts`           | Parsing and validation tests                                                                                  |
| `test/program-parameters.spec.ts` (NEW) | API tests                                                                                                     |
| `test/evaluator.spec.ts`                | Override execution tests                                                                                      |
| `test/program-stats.spec.ts`            | Override analysis tests                                                                                       |

## Backward compatibility

All changes are additive:

- `is` is a new reserved keyword; programs that use `is` as a variable name (impossible since it's not a valid `$name` form) or record key are unaffected
- Programs without parameter declarations work exactly as before
- Existing call signatures (no `parameters` option) work unchanged
- Existing AST consumers handle `parameter-declaration` by ignoring it (or fail at type-check time, which is informative)

## Testing strategy

TDD throughout. Test areas:

1. **Parser**: each validation rule produces the right error; valid declarations parse to expected AST
2. **AST**: factories produce well-formed nodes
3. **Evaluator**: defaults are evaluated correctly; overrides replace defaults; validation errors at runtime
4. **Analysis**: parameters become bound values during analysis; classifier handles parameter declarations; analyze/analyzeAsync accept parameters
5. **API**: `ProgramParameters.list()` returns expected shape; dice expression defaults expose `defaultExpr`/`defaultSource`
6. **Integration**: a complete program with parameters parses, runs with and without overrides, and analyzes correctly

## Out of scope

- `@key value` annotations on assignments (deferred)
- Dice expression overrides at runtime (`parameters: { x: "d6" }`); UI must roll first
- Parameters that depend on other variables (defaults are constants only)
- Computed parameters (no `is { compute: ..., ... }`)
- Type coercion in overrides (booleans don't auto-convert to 0/1, etc.)
