# Dice Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scripting language to dicerollerts with variables, conditionals, records, arrays, loops, and backtick-delimited dice expressions.

**Architecture:** Layer the implementation bottom-up: AST types first, then program parser (reusing the existing dice parser for backtick content), then evaluator, then program-level probability analysis. The existing single-expression API remains unchanged.

**Tech Stack:** TypeScript, Vitest, partsing (parser combinators)

---

## File Structure

| File                            | Responsibility                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `src/program.ts`                | Program AST types (Statement, Expression, etc.)                       |
| `src/program-parser.ts`         | Parses program text to Program AST                                    |
| `src/evaluator.ts`              | Executes a Program, returns Value                                     |
| `src/program-stats.ts`          | Monte Carlo on full programs, per-field distributions                 |
| `src/dice-expression.ts`        | Add `VariableRef` to DiceExpression union                             |
| `src/roller.ts`                 | Update roll() to handle VariableRef (resolve from env)                |
| `src/dice-expression-domain.ts` | Update toString/validate/simplify/calculateBasicRolls for VariableRef |
| `src/index.ts`                  | Export new modules and types                                          |
| `test/program-parser.spec.ts`   | Parser tests                                                          |
| `test/evaluator.spec.ts`        | Evaluator tests                                                       |
| `test/program-stats.spec.ts`    | Program probability analysis tests                                    |

---

### Task 1: Program AST Types

**Files:**

- Create: `src/program.ts`
- Test: `test/evaluator.spec.ts` (type-checking only, no logic yet)

- [ ] **Step 1: Create the AST types file**

Create `src/program.ts`:

```ts
import type { DiceExpression } from './dice-expression'

export interface Program {
  type: 'program'
  statements: Statement[]
}

export function program(statements: Statement[]): Program {
  return { type: 'program', statements }
}

export type Statement = Assignment | ExpressionStatement

export interface Assignment {
  type: 'assignment'
  name: string
  value: Expression
}

export function assignment(name: string, value: Expression): Assignment {
  return { type: 'assignment', name, value }
}

export interface ExpressionStatement {
  type: 'expression-statement'
  expr: Expression
}

export function expressionStatement(expr: Expression): ExpressionStatement {
  return { type: 'expression-statement', expr }
}

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

export interface NumberLiteral {
  type: 'number-literal'
  value: number
}

export function numberLiteral(value: number): NumberLiteral {
  return { type: 'number-literal', value }
}

export interface BooleanLiteral {
  type: 'boolean-literal'
  value: boolean
}

export function booleanLiteral(value: boolean): BooleanLiteral {
  return { type: 'boolean-literal', value }
}

export interface StringLiteral {
  type: 'string-literal'
  value: string
}

export function stringLiteral(value: string): StringLiteral {
  return { type: 'string-literal', value }
}

export interface VariableRef {
  type: 'variable-ref'
  name: string
}

export function variableRef(name: string): VariableRef {
  return { type: 'variable-ref', name }
}

export interface DiceExpr {
  type: 'dice-expr'
  expr: DiceExpression
  source: string
}

export function diceExpr(expr: DiceExpression, source: string): DiceExpr {
  return { type: 'dice-expr', expr, source }
}

export type BinaryOper =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'and'
  | 'or'
  | 'concat'

export interface BinaryExpr {
  type: 'binary-expr'
  op: BinaryOper
  left: Expression
  right: Expression
}

export function binaryExpr(
  op: BinaryOper,
  left: Expression,
  right: Expression,
): BinaryExpr {
  return { type: 'binary-expr', op, left, right }
}

export interface UnaryExpr {
  type: 'unary-expr'
  op: 'negate' | 'not'
  expr: Expression
}

export function unaryExpr(op: 'negate' | 'not', expr: Expression): UnaryExpr {
  return { type: 'unary-expr', op, expr }
}

export interface IfExpr {
  type: 'if-expr'
  condition: Expression
  then: Expression
  else: Expression
}

export function ifExpr(
  condition: Expression,
  then: Expression,
  else_: Expression,
): IfExpr {
  return { type: 'if-expr', condition, then, else: else_ }
}

export interface RecordField {
  key: string
  value: Expression
}

export interface RecordExpr {
  type: 'record-expr'
  fields: RecordField[]
}

export function recordExpr(fields: RecordField[]): RecordExpr {
  return { type: 'record-expr', fields }
}

export interface ArrayExpr {
  type: 'array-expr'
  elements: Expression[]
}

export function arrayExpr(elements: Expression[]): ArrayExpr {
  return { type: 'array-expr', elements }
}

export interface RepeatExpr {
  type: 'repeat-expr'
  count: Expression
  body: Statement[]
}

export function repeatExpr(count: Expression, body: Statement[]): RepeatExpr {
  return { type: 'repeat-expr', count, body }
}

export interface FieldAccess {
  type: 'field-access'
  object: Expression
  field: string
}

export function fieldAccess(object: Expression, field: string): FieldAccess {
  return { type: 'field-access', object, field }
}

export interface IndexAccess {
  type: 'index-access'
  object: Expression
  index: Expression
}

export function indexAccess(
  object: Expression,
  index: Expression,
): IndexAccess {
  return { type: 'index-access', object, index }
}

export type Value =
  | number
  | boolean
  | string
  | Value[]
  | { [key: string]: Value }

export interface RuntimeError {
  type: 'runtime-error'
  message: string
  line?: number
}

export function runtimeError(message: string, line?: number): RuntimeError {
  return { type: 'runtime-error', message, line }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/program.ts
git commit -m "feat: add program AST types"
```

---

### Task 2: Add VariableRef to DiceExpression

**Files:**

- Modify: `src/dice-expression.ts`
- Modify: `src/dice-expression-domain.ts`
- Modify: `src/roller.ts`
- Modify: `src/index.ts`
- Create: `test/variable-ref.spec.ts`

The dice expression AST needs a `VariableRef` node so that `$var` can appear inside backtick dice expressions. The roller resolves these from an environment at roll time.

- [ ] **Step 1: Write failing tests**

Create `test/variable-ref.spec.ts`:

```ts
import { die, literal, binaryOp } from '../src/dice-expression'
import { diceVariableRef } from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

describe('VariableRef in DiceExpression', () => {
  test('toString renders $name', () => {
    const expr = binaryOp('sum', die(20), diceVariableRef('mod'))
    expect(DE.toString(expr)).toBe('d20 + $mod')
  })

  test('roller resolves variable from environment', () => {
    const expr = binaryOp('sum', die(20), diceVariableRef('mod'))
    const roller = new Roller(() => 1, undefined, { mod: 5 })
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(6) // d20 rolls 1, + $mod (5)
  })

  test('roller throws on undefined variable', () => {
    const expr = diceVariableRef('missing')
    const roller = new Roller(() => 1)
    expect(() => roller.roll(expr)).toThrow('Undefined variable: $missing')
  })

  test('calculateBasicRolls counts variable as 1', () => {
    expect(DE.calculateBasicRolls(diceVariableRef('x'))).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/variable-ref.spec.ts`
Expected: FAIL - `diceVariableRef` doesn't exist

- [ ] **Step 3: Add DiceVariableRef to dice-expression.ts**

Add after `CustomDie`:

```ts
export interface DiceVariableRef {
  type: 'dice-variable-ref'
  name: string
}

export function diceVariableRef(name: string): DiceVariableRef {
  return {
    type: 'dice-variable-ref',
    name,
  }
}
```

Add to `DiceExpression` union:

```ts
export type DiceExpression =
  | Die
  | Literal
  | DiceReduce
  | BinaryOp
  | UnaryOp
  | CustomDie
  | DiceVariableRef
```

- [ ] **Step 4: Update dice-expression-domain.ts**

In `DE.toString`, add case:

```ts
} else if (expr.type === 'dice-variable-ref') {
  return `$${expr.name}`
}
```

In `DE.validateExpr`, add case:

```ts
case 'dice-variable-ref':
  return []
```

In `DE.calculateBasicRolls`, add case:

```ts
case 'dice-variable-ref':
  return 0
```

In `DE.simplify`, add case:

```ts
case 'dice-variable-ref':
  return expr
```

- [ ] **Step 5: Update roller.ts**

Add a `variables` parameter to the Roller constructor:

```ts
constructor(
  private readonly dieRoll: Roll,
  options?: Partial<RollerOptions>,
  private readonly variables?: Record<string, number>,
) {
  this.options = { ...DEFAULT_OPTIONS, ...options }
}
```

In the `roll` method, add case for `dice-variable-ref`:

```ts
} else if (expr.type === 'dice-variable-ref') {
  const value = this.variables?.[expr.name]
  if (value === undefined) {
    throw new Error(`Undefined variable: $${expr.name}`)
  }
  return literalResult(value, value)
}
```

- [ ] **Step 6: Update index.ts exports**

Add `diceVariableRef`, `type DiceVariableRef` to the exports.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/ test/variable-ref.spec.ts
git commit -m "feat: add VariableRef to DiceExpression for variable substitution in dice"
```

---

### Task 3: Program Parser - Literals and Variables

**Files:**

- Create: `src/program-parser.ts`
- Create: `test/program-parser.spec.ts`

Build the program parser incrementally. Start with literals, variables, and assignment.

- [ ] **Step 1: Write failing tests**

Create `test/program-parser.spec.ts`:

```ts
import { ProgramParser } from '../src/program-parser'

describe('program parser - literals', () => {
  test('number literal', () => {
    const result = ProgramParser.parse('42')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(1)
      expect(result.program.statements[0].type).toBe('expression-statement')
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr).toEqual({ type: 'number-literal', value: 42 })
      }
    }
  })

  test('negative number', () => {
    const result = ProgramParser.parse('-5')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('unary-expr')
      }
    }
  })

  test('boolean true', () => {
    const result = ProgramParser.parse('true')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr).toEqual({ type: 'boolean-literal', value: true })
      }
    }
  })

  test('boolean false', () => {
    const result = ProgramParser.parse('false')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr).toEqual({ type: 'boolean-literal', value: false })
      }
    }
  })

  test('string literal', () => {
    const result = ProgramParser.parse('"hello world"')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr).toEqual({
          type: 'string-literal',
          value: 'hello world',
        })
      }
    }
  })
})

describe('program parser - variables', () => {
  test('variable reference', () => {
    const result = ProgramParser.parse('$foo')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr).toEqual({ type: 'variable-ref', name: 'foo' })
      }
    }
  })

  test('variable assignment', () => {
    const result = ProgramParser.parse('$x = 5')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements[0]).toEqual({
        type: 'assignment',
        name: 'x',
        value: { type: 'number-literal', value: 5 },
      })
    }
  })

  test('multiple statements', () => {
    const result = ProgramParser.parse('$x = 5\n$x')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(2)
      expect(result.program.statements[0].type).toBe('assignment')
      expect(result.program.statements[1].type).toBe('expression-statement')
    }
  })

  test('comments are ignored', () => {
    const result = ProgramParser.parse(
      '# this is a comment\n$x = 5\n$x # inline',
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(2)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/program-parser.spec.ts`
Expected: FAIL - `ProgramParser` doesn't exist

- [ ] **Step 3: Implement the base parser**

Create `src/program-parser.ts`:

```ts
import type { ParseError } from './parse-error'
import {
  type Program,
  type Statement,
  type Expression,
  program,
  assignment,
  expressionStatement,
  numberLiteral,
  booleanLiteral,
  stringLiteral,
  variableRef,
  unaryExpr,
} from './program'

export type ParseProgramResult =
  | { success: true; program: Program }
  | { success: false; errors: ParseError[] }

export const ProgramParser = {
  parse(input: string): ParseProgramResult {
    const parser = new Parser(input)
    try {
      const stmts = parser.parseStatements()
      return { success: true, program: program(stmts) }
    } catch (e) {
      return {
        success: false,
        errors: [
          {
            message: e instanceof Error ? e.message : String(e),
            position: parser.pos,
            context: input.substring(
              Math.max(0, parser.pos - 10),
              Math.min(input.length, parser.pos + 10),
            ),
          },
        ],
      }
    }
  },
}

class Parser {
  pos = 0
  private readonly input: string

  constructor(input: string) {
    this.input = input
  }

  parseStatements(): Statement[] {
    const stmts: Statement[] = []
    this.skipWhitespaceAndComments()
    while (this.pos < this.input.length) {
      stmts.push(this.parseStatement())
      this.skipWhitespaceAndComments()
    }
    return stmts
  }

  parseStatement(): Statement {
    if (this.peek() === '$') {
      const saved = this.pos
      const name = this.parseVariableName()
      this.skipSpaces()
      if (this.peek() === '=' && this.peekAt(1) !== '=') {
        this.advance() // skip =
        this.skipSpaces()
        const value = this.parseExpression()
        return assignment(name, value)
      }
      // Not an assignment, backtrack and parse as expression
      this.pos = saved
    }
    return expressionStatement(this.parseExpression())
  }

  parseExpression(): Expression {
    return this.parseOr()
  }

  parseOr(): Expression {
    let left = this.parseAnd()
    while (this.matchKeyword('or')) {
      this.skipSpaces()
      const right = this.parseAnd()
      left = { type: 'binary-expr', op: 'or', left, right }
    }
    return left
  }

  parseAnd(): Expression {
    let left = this.parseComparison()
    while (this.matchKeyword('and')) {
      this.skipSpaces()
      const right = this.parseComparison()
      left = { type: 'binary-expr', op: 'and', left, right }
    }
    return left
  }

  parseComparison(): Expression {
    let left = this.parseAddSub()
    const ops: Record<
      string,
      Expression['type'] extends 'binary-expr' ? never : string
    > = {}
    while (true) {
      this.skipSpaces()
      const op = this.matchComparisonOp()
      if (!op) break
      this.skipSpaces()
      const right = this.parseAddSub()
      left = { type: 'binary-expr', op, left, right }
    }
    return left
  }

  parseAddSub(): Expression {
    let left = this.parseMulDiv()
    while (true) {
      this.skipSpaces()
      if (this.peek() === '+') {
        this.advance()
        this.skipSpaces()
        const right = this.parseMulDiv()
        left = { type: 'binary-expr', op: 'add', left, right }
      } else if (this.peek() === '-' && !this.isDigitAt(1)) {
        this.advance()
        this.skipSpaces()
        const right = this.parseMulDiv()
        left = { type: 'binary-expr', op: 'subtract', left, right }
      } else {
        break
      }
    }
    return left
  }

  parseMulDiv(): Expression {
    let left = this.parseUnary()
    while (true) {
      this.skipSpaces()
      if (this.peek() === '*') {
        this.advance()
        this.skipSpaces()
        const right = this.parseUnary()
        left = { type: 'binary-expr', op: 'multiply', left, right }
      } else if (this.peek() === '/') {
        this.advance()
        this.skipSpaces()
        const right = this.parseUnary()
        left = { type: 'binary-expr', op: 'divide', left, right }
      } else {
        break
      }
    }
    return left
  }

  parseUnary(): Expression {
    this.skipSpaces()
    if (this.peek() === '-') {
      this.advance()
      this.skipSpaces()
      const expr = this.parsePostfix()
      return unaryExpr('negate', expr)
    }
    if (this.matchKeyword('not')) {
      this.skipSpaces()
      const expr = this.parsePostfix()
      return unaryExpr('not', expr)
    }
    return this.parsePostfix()
  }

  parsePostfix(): Expression {
    let expr = this.parsePrimary()
    while (true) {
      if (this.peek() === '.') {
        this.advance()
        const field = this.parseIdentifier()
        expr = { type: 'field-access', object: expr, field }
      } else if (this.peek() === '[') {
        this.advance()
        this.skipSpaces()
        const index = this.parseExpression()
        this.skipSpaces()
        this.expect(']')
        expr = { type: 'index-access', object: expr, index }
      } else {
        break
      }
    }
    return expr
  }

  parsePrimary(): Expression {
    this.skipSpaces()
    const ch = this.peek()

    // Number
    if (ch >= '0' && ch <= '9') {
      return numberLiteral(this.parseNumber())
    }

    // String
    if (ch === '"') {
      return stringLiteral(this.parseString())
    }

    // Variable
    if (ch === '$') {
      return variableRef(this.parseVariableName())
    }

    // Backtick dice expression
    if (ch === '`') {
      return this.parseDiceExpr()
    }

    // Array literal
    if (ch === '[') {
      return this.parseArrayExpr()
    }

    // Record literal
    if (ch === '{') {
      return this.parseRecordExpr()
    }

    // Parenthesized expression
    if (ch === '(') {
      this.advance()
      this.skipSpaces()
      const expr = this.parseExpression()
      this.skipSpaces()
      this.expect(')')
      return expr
    }

    // Keywords
    if (this.matchKeyword('true')) return booleanLiteral(true)
    if (this.matchKeyword('false')) return booleanLiteral(false)
    if (this.matchKeyword('if')) return this.parseIf()
    if (this.matchKeyword('repeat')) return this.parseRepeat()

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`)
  }

  // Placeholder methods - implemented in subsequent tasks
  parseDiceExpr(): Expression {
    throw new Error('Dice expressions not yet implemented')
  }

  parseArrayExpr(): Expression {
    throw new Error('Arrays not yet implemented')
  }

  parseRecordExpr(): Expression {
    throw new Error('Records not yet implemented')
  }

  parseIf(): Expression {
    throw new Error('If expressions not yet implemented')
  }

  parseRepeat(): Expression {
    throw new Error('Repeat not yet implemented')
  }

  // --- Helpers ---

  parseVariableName(): string {
    this.expect('$')
    const start = this.pos
    while (
      this.pos < this.input.length &&
      /[a-z_]/.test(this.input[this.pos])
    ) {
      this.pos++
    }
    if (this.pos === start)
      throw new Error(`Expected variable name at position ${this.pos}`)
    return this.input.substring(start, this.pos)
  }

  parseIdentifier(): string {
    const start = this.pos
    while (
      this.pos < this.input.length &&
      /[a-z_A-Z0-9]/.test(this.input[this.pos])
    ) {
      this.pos++
    }
    if (this.pos === start)
      throw new Error(`Expected identifier at position ${this.pos}`)
    return this.input.substring(start, this.pos)
  }

  parseNumber(): number {
    const start = this.pos
    while (
      this.pos < this.input.length &&
      this.input[this.pos] >= '0' &&
      this.input[this.pos] <= '9'
    ) {
      this.pos++
    }
    return parseInt(this.input.substring(start, this.pos), 10)
  }

  parseString(): string {
    this.expect('"')
    const start = this.pos
    while (this.pos < this.input.length && this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\\') this.pos++ // skip escaped char
      this.pos++
    }
    const value = this.input.substring(start, this.pos)
    this.expect('"')
    return value
  }

  matchKeyword(keyword: string): boolean {
    const saved = this.pos
    this.skipSpaces()
    if (this.input.startsWith(keyword, this.pos)) {
      const afterKeyword = this.pos + keyword.length
      if (
        afterKeyword >= this.input.length ||
        !/[a-z_A-Z0-9]/.test(this.input[afterKeyword])
      ) {
        this.pos = afterKeyword
        return true
      }
    }
    this.pos = saved
    return false
  }

  matchComparisonOp(): string | null {
    if (this.input.startsWith('>=', this.pos)) {
      this.pos += 2
      return 'gte'
    }
    if (this.input.startsWith('<=', this.pos)) {
      this.pos += 2
      return 'lte'
    }
    if (this.input.startsWith('==', this.pos)) {
      this.pos += 2
      return 'eq'
    }
    if (this.input.startsWith('!=', this.pos)) {
      this.pos += 2
      return 'neq'
    }
    if (this.input[this.pos] === '>' && this.input[this.pos + 1] !== '=') {
      this.pos++
      return 'gt'
    }
    if (this.input[this.pos] === '<' && this.input[this.pos + 1] !== '=') {
      this.pos++
      return 'lt'
    }
    return null
  }

  peek(): string {
    return this.input[this.pos] ?? ''
  }

  peekAt(offset: number): string {
    return this.input[this.pos + offset] ?? ''
  }

  advance(): void {
    this.pos++
  }

  expect(ch: string): void {
    if (this.input[this.pos] !== ch) {
      throw new Error(
        `Expected '${ch}' at position ${this.pos}, got '${this.peek()}'`,
      )
    }
    this.pos++
  }

  isDigitAt(offset: number): boolean {
    const ch = this.input[this.pos + offset]
    return ch >= '0' && ch <= '9'
  }

  skipSpaces(): void {
    while (
      this.pos < this.input.length &&
      (this.input[this.pos] === ' ' || this.input[this.pos] === '\t')
    ) {
      this.pos++
    }
  }

  skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.pos++
      } else if (ch === '#') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
      } else {
        break
      }
    }
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/program-parser.ts test/program-parser.spec.ts
git commit -m "feat: add program parser with literals, variables, and arithmetic"
```

---

### Task 4: Program Parser - Dice Expressions, Arrays, Records, If, Repeat

**Files:**

- Modify: `src/program-parser.ts`
- Modify: `test/program-parser.spec.ts`

- [ ] **Step 1: Add tests for remaining expression types**

Append to `test/program-parser.spec.ts`:

```ts
import { DiceParser } from '../src/dice-parser'

describe('program parser - dice expressions', () => {
  test('backtick dice expression', () => {
    const result = ProgramParser.parse('`3d6 + 5`')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('dice-expr')
        if (stmt.expr.type === 'dice-expr') {
          expect(stmt.expr.source).toBe('3d6 + 5')
        }
      }
    }
  })

  test('dice expression with variable', () => {
    const result = ProgramParser.parse('`d20 + $mod`')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'dice-expr'
      ) {
        expect(stmt.expr.source).toBe('d20 + $mod')
      }
    }
  })

  test('parametric dice with uppercase D', () => {
    const result = ProgramParser.parse('`$numD$sides`')
    expect(result.success).toBe(true)
  })
})

describe('program parser - arrays', () => {
  test('array literal', () => {
    const result = ProgramParser.parse('[1, 2, 3]')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('array-expr')
        if (stmt.expr.type === 'array-expr') {
          expect(stmt.expr.elements).toHaveLength(3)
        }
      }
    }
  })

  test('empty array', () => {
    const result = ProgramParser.parse('[]')
    expect(result.success).toBe(true)
  })

  test('array indexing', () => {
    const result = ProgramParser.parse('$arr[0]')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('index-access')
      }
    }
  })
})

describe('program parser - records', () => {
  test('record literal', () => {
    const result = ProgramParser.parse('{ name: "test", value: 42 }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'record-expr'
      ) {
        expect(stmt.expr.fields).toHaveLength(2)
        expect(stmt.expr.fields[0].key).toBe('name')
        expect(stmt.expr.fields[1].key).toBe('value')
      }
    }
  })

  test('record shorthand with variables', () => {
    const result = ProgramParser.parse('{ $attack, $damage }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'record-expr'
      ) {
        expect(stmt.expr.fields[0].key).toBe('attack')
        expect(stmt.expr.fields[0].value).toEqual({
          type: 'variable-ref',
          name: 'attack',
        })
      }
    }
  })

  test('field access', () => {
    const result = ProgramParser.parse('$obj.name')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('field-access')
      }
    }
  })
})

describe('program parser - if', () => {
  test('if then else', () => {
    const result = ProgramParser.parse('if true then 1 else 0')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (stmt.type === 'expression-statement') {
        expect(stmt.expr.type).toBe('if-expr')
        if (stmt.expr.type === 'if-expr') {
          expect(stmt.expr.condition).toEqual({
            type: 'boolean-literal',
            value: true,
          })
          expect(stmt.expr.then).toEqual({ type: 'number-literal', value: 1 })
          expect(stmt.expr.else).toEqual({ type: 'number-literal', value: 0 })
        }
      }
    }
  })

  test('nested if', () => {
    const result = ProgramParser.parse(
      'if true then 1 else if false then 2 else 3',
    )
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'if-expr'
      ) {
        expect(stmt.expr.else.type).toBe('if-expr')
      }
    }
  })
})

describe('program parser - repeat', () => {
  test('repeat block', () => {
    const result = ProgramParser.parse('repeat 3 { 42 }')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'repeat-expr'
      ) {
        expect(stmt.expr.count).toEqual({ type: 'number-literal', value: 3 })
        expect(stmt.expr.body).toHaveLength(1)
      }
    }
  })

  test('repeat with variable count', () => {
    const result = ProgramParser.parse('$n = 4\nrepeat $n { `d6` }')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(2)
    }
  })

  test('repeat with multiple statements in body', () => {
    const result = ProgramParser.parse('repeat 3 {\n$x = `d6`\n$x\n}')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'repeat-expr'
      ) {
        expect(stmt.expr.body).toHaveLength(2)
      }
    }
  })
})

describe('program parser - full programs', () => {
  test('attack roll program', () => {
    const input = `$str_mod = 5
$ac = 15
$attack = \`d20 + $str_mod\`
$hit = $attack >= $ac
$damage = if $hit then \`2d6 + $str_mod\` else 0
{ attack: $attack, damage: $damage }`
    const result = ProgramParser.parse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.program.statements).toHaveLength(6)
    }
  })

  test('arithmetic operators', () => {
    const result = ProgramParser.parse('2 + 3 * 4')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      ) {
        // Should be add(2, mul(3, 4)) due to precedence
        expect(stmt.expr.op).toBe('add')
        if (stmt.expr.right.type === 'binary-expr') {
          expect(stmt.expr.right.op).toBe('multiply')
        }
      }
    }
  })

  test('comparison operators', () => {
    const result = ProgramParser.parse('$x >= 5')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      ) {
        expect(stmt.expr.op).toBe('gte')
      }
    }
  })

  test('boolean operators', () => {
    const result = ProgramParser.parse('$a and $b or $c')
    expect(result.success).toBe(true)
    if (result.success) {
      const stmt = result.program.statements[0]
      if (
        stmt.type === 'expression-statement' &&
        stmt.expr.type === 'binary-expr'
      ) {
        // or has lower precedence than and: or(and(a, b), c)
        expect(stmt.expr.op).toBe('or')
      }
    }
  })

  test('parse error', () => {
    const result = ProgramParser.parse('$x = ')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/program-parser.spec.ts`
Expected: FAIL on dice, array, record, if, and repeat tests

- [ ] **Step 3: Implement parseDiceExpr**

In the `Parser` class, replace the `parseDiceExpr` stub:

```ts
parseDiceExpr(): Expression {
  this.expect('`')
  const start = this.pos
  while (this.pos < this.input.length && this.input[this.pos] !== '`') {
    this.pos++
  }
  const source = this.input.substring(start, this.pos)
  this.expect('`')

  // Parse the dice content using the existing dice parser,
  // but first substitute $var patterns with a placeholder for parsing.
  // We need to handle $var inside the dice expression.
  const diceInput = source.replace(/\$([a-z_]+)/g, '0')
  const parsed = DiceParser.parseOrNull(diceInput)
  if (parsed === null) {
    throw new Error(`Invalid dice expression: ${source}`)
  }

  // Re-parse with variable refs: walk the source and build the real AST
  // For now, use a simpler approach: parse with placeholders, then
  // reconstruct with variable refs by re-parsing the source
  const realParsed = this.parseDiceWithVars(source)
  return { type: 'dice-expr', expr: realParsed, source }
}
```

The `parseDiceWithVars` method needs to handle `$var` inside dice notation. This is complex because we need to integrate with the existing `partsing`-based parser. A simpler approach for the initial implementation:

```ts
parseDiceWithVars(source: string): import('./dice-expression').DiceExpression {
  // Replace $var with placeholder numbers, parse, then walk the AST
  // and swap Literal nodes back to DiceVariableRef where they came from $vars
  const varPositions: { name: string; placeholder: number }[] = []
  let counter = 99990 // unlikely to appear in real dice expressions
  const substituted = source.replace(/\$([a-z_]+)/g, (_, name) => {
    const placeholder = counter++
    varPositions.push({ name, placeholder })
    return String(placeholder)
  })

  const { DiceParser: DP } = require('./dice-parser')
  const parsed = DP.parseOrNull(substituted)
  if (parsed === null) {
    throw new Error(`Invalid dice expression: ${source}`)
  }

  // Walk AST and replace placeholder literals with variable refs
  return this.replaceVarPlaceholders(parsed, varPositions)
}

replaceVarPlaceholders(
  expr: import('./dice-expression').DiceExpression,
  vars: { name: string; placeholder: number }[],
): import('./dice-expression').DiceExpression {
  const { diceVariableRef } = require('./dice-expression')

  switch (expr.type) {
    case 'literal': {
      const v = vars.find((v) => v.placeholder === expr.value)
      if (v) return diceVariableRef(v.name)
      return expr
    }
    case 'binary-op':
      return {
        ...expr,
        left: this.replaceVarPlaceholders(expr.left, vars),
        right: this.replaceVarPlaceholders(expr.right, vars),
      }
    case 'unary-op':
      return {
        ...expr,
        expr: this.replaceVarPlaceholders(expr.expr, vars),
      }
    case 'dice-reduce':
      return expr // Variables in reduce positions handled by substitution
    default:
      return expr
  }
}
```

Note: This approach has limitations (variables in dice count/sides positions won't work with placeholder substitution since the parser interprets the placeholder number as dice count). The parametric `$numD$sides` support needs the dice parser to handle `$` natively. This is acceptable for the initial implementation; full parametric dice support can be refined in a follow-up.

Import `DiceParser` at the top of the file and use it instead of `require`.

- [ ] **Step 4: Implement parseArrayExpr**

```ts
parseArrayExpr(): Expression {
  this.expect('[')
  this.skipSpaces()
  const elements: Expression[] = []
  if (this.peek() !== ']') {
    elements.push(this.parseExpression())
    while (true) {
      this.skipSpaces()
      if (this.peek() !== ',') break
      this.advance()
      this.skipSpaces()
      elements.push(this.parseExpression())
    }
  }
  this.skipSpaces()
  this.expect(']')
  return { type: 'array-expr', elements }
}
```

- [ ] **Step 5: Implement parseRecordExpr**

```ts
parseRecordExpr(): Expression {
  this.expect('{')
  this.skipWhitespaceAndComments()
  const fields: { key: string; value: Expression }[] = []
  if (this.peek() !== '}') {
    fields.push(this.parseRecordField())
    while (true) {
      this.skipWhitespaceAndComments()
      if (this.peek() !== ',') break
      this.advance()
      this.skipWhitespaceAndComments()
      fields.push(this.parseRecordField())
    }
  }
  this.skipWhitespaceAndComments()
  this.expect('}')
  return { type: 'record-expr', fields }
}

parseRecordField(): { key: string; value: Expression } {
  // Shorthand: { $attack } -> { attack: $attack }
  if (this.peek() === '$') {
    const saved = this.pos
    const name = this.parseVariableName()
    this.skipSpaces()
    if (this.peek() !== ':') {
      return { key: name, value: { type: 'variable-ref', name } }
    }
    this.pos = saved
    // Fall through to key: value parsing
  }
  // key: value
  const key = this.parseIdentifier()
  this.skipSpaces()
  this.expect(':')
  this.skipSpaces()
  const value = this.parseExpression()
  return { key, value }
}
```

- [ ] **Step 6: Implement parseIf**

```ts
parseIf(): Expression {
  this.skipSpaces()
  const condition = this.parseExpression()
  this.skipWhitespaceAndComments()
  if (!this.matchKeyword('then')) {
    throw new Error(`Expected 'then' at position ${this.pos}`)
  }
  this.skipWhitespaceAndComments()
  const then = this.parseExpression()
  this.skipWhitespaceAndComments()
  if (!this.matchKeyword('else')) {
    throw new Error(`Expected 'else' at position ${this.pos}`)
  }
  this.skipWhitespaceAndComments()
  const else_ = this.parseExpression()
  return { type: 'if-expr', condition, then, else: else_ }
}
```

- [ ] **Step 7: Implement parseRepeat**

```ts
parseRepeat(): Expression {
  this.skipSpaces()
  const count = this.parseExpression()
  this.skipWhitespaceAndComments()
  this.expect('{')
  const body = this.parseBlockStatements()
  this.skipWhitespaceAndComments()
  this.expect('}')
  return { type: 'repeat-expr', count, body }
}

parseBlockStatements(): Statement[] {
  const stmts: Statement[] = []
  this.skipWhitespaceAndComments()
  while (this.pos < this.input.length && this.peek() !== '}') {
    stmts.push(this.parseStatement())
    this.skipWhitespaceAndComments()
  }
  return stmts
}
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/program-parser.ts test/program-parser.spec.ts
git commit -m "feat: complete program parser with dice, arrays, records, if, repeat"
```

---

### Task 5: Evaluator

**Files:**

- Create: `src/evaluator.ts`
- Create: `test/evaluator.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `test/evaluator.spec.ts`:

```ts
import { ProgramParser } from '../src/program-parser'
import { Evaluator } from '../src/evaluator'
import { Roller } from '../src/roller'
import type { Value } from '../src/program'

function run(input: string, rollFn?: (max: number) => number): Value {
  const result = ProgramParser.parse(input)
  if (!result.success)
    throw new Error('Parse failed: ' + result.errors[0].message)
  const roller = new Roller(rollFn ?? ((max) => max))
  const evaluator = new Evaluator(roller)
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
    const result = run('{ a: 1, b: 2 }')
    expect(result).toEqual({ a: 1, b: 2 })
  })
  test('field access', () => {
    expect(run('$r = { x: 42 }\n$r.x')).toBe(42)
  })
  test('record shorthand', () => {
    const result = run('$a = 1\n$b = 2\n{ $a, $b }')
    expect(result).toEqual({ a: 1, b: 2 })
  })
})

describe('evaluator - arrays', () => {
  test('array creation', () => {
    const result = run('[1, 2, 3]')
    expect(result).toEqual([1, 2, 3])
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
    const result = run('repeat 3 { 42 }')
    expect(result).toEqual([42, 42, 42])
  })
  test('repeat with dice', () => {
    const result = run('repeat 4 { `d6` }', () => 3) as number[]
    expect(result).toEqual([3, 3, 3, 3])
  })
  test('repeat with multi-statement body', () => {
    const result = run('repeat 2 {\n$x = 10\n$x + 1\n}')
    expect(result).toEqual([11, 11])
  })
  test('repeat scoping', () => {
    // $x inside repeat doesn't leak
    const result = run('repeat 2 { $x = 5\n$x }\n')
    expect(result).toEqual([5, 5])
  })
  test('repeat with variable count', () => {
    const result = run('$n = 3\nrepeat $n { 1 }')
    expect(result).toEqual([1, 1, 1])
  })
})

describe('evaluator - dice expressions', () => {
  test('simple dice roll', () => {
    const result = run('`d6`', () => 4)
    expect(result).toBe(4)
  })
  test('dice with variable substitution', () => {
    const result = run('$mod = 5\n`d20 + $mod`', () => 10)
    expect(result).toBe(15)
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
    expect(result.attack).toBe(20) // d20 rolls 15, + 5
    expect(result.hit).toBe(true)
    expect(typeof result.damage).toBe('number')
    expect(result.damage).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/evaluator.spec.ts`
Expected: FAIL - `Evaluator` doesn't exist

- [ ] **Step 3: Implement the evaluator**

Create `src/evaluator.ts`:

```ts
import type { Program, Statement, Expression, Value } from './program'
import { runtimeError } from './program'
import { Roller } from './roller'
import { RR } from './roll-result-domain'

export class Evaluator {
  constructor(private readonly roller: Roller) {}

  run(program: Program): Value {
    const env = new Environment()
    let result: Value = 0
    for (const stmt of program.statements) {
      result = this.execStatement(stmt, env)
    }
    return result
  }

  private execStatement(stmt: Statement, env: Environment): Value {
    switch (stmt.type) {
      case 'assignment': {
        if (env.has(stmt.name)) {
          throw new Error(`Cannot reassign immutable variable: $${stmt.name}`)
        }
        const value = this.evalExpr(stmt.value, env)
        env.set(stmt.name, value)
        return value
      }
      case 'expression-statement':
        return this.evalExpr(stmt.expr, env)
    }
  }

  private evalExpr(expr: Expression, env: Environment): Value {
    switch (expr.type) {
      case 'number-literal':
        return expr.value
      case 'boolean-literal':
        return expr.value
      case 'string-literal':
        return expr.value
      case 'variable-ref': {
        const value = env.get(expr.name)
        if (value === undefined) {
          throw new Error(`Undefined variable: $${expr.name}`)
        }
        return value
      }
      case 'dice-expr': {
        const vars = this.collectDiceVars(env)
        const roller = new Roller((this.roller as any).dieRoll, undefined, vars)
        const result = roller.roll(expr.expr)
        return RR.getResult(result)
      }
      case 'binary-expr':
        return this.evalBinary(expr.op, expr.left, expr.right, env)
      case 'unary-expr':
        return this.evalUnary(expr.op, expr.expr, env)
      case 'if-expr': {
        const cond = this.evalExpr(expr.condition, env)
        return cond
          ? this.evalExpr(expr.then, env)
          : this.evalExpr(expr.else, env)
      }
      case 'record-expr': {
        const record: Record<string, Value> = {}
        for (const field of expr.fields) {
          record[field.key] = this.evalExpr(field.value, env)
        }
        return record
      }
      case 'array-expr':
        return expr.elements.map((e) => this.evalExpr(e, env))
      case 'repeat-expr': {
        const count = this.toNumber(this.evalExpr(expr.count, env))
        const results: Value[] = []
        for (let i = 0; i < count; i++) {
          const childEnv = env.child()
          let last: Value = 0
          for (const stmt of expr.body) {
            last = this.execStatement(stmt, childEnv)
          }
          results.push(last)
        }
        return results
      }
      case 'field-access': {
        const obj = this.evalExpr(expr.object, env)
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          throw new Error('Field access on non-record')
        }
        const value = (obj as Record<string, Value>)[expr.field]
        if (value === undefined) {
          throw new Error(`Unknown field: ${expr.field}`)
        }
        return value
      }
      case 'index-access': {
        const obj = this.evalExpr(expr.object, env)
        const idx = this.toNumber(this.evalExpr(expr.index, env))
        if (!Array.isArray(obj)) {
          throw new Error('Index access on non-array')
        }
        if (idx < 0 || idx >= obj.length) {
          throw new Error(`Index out of bounds: ${idx}`)
        }
        return obj[idx]
      }
    }
  }

  private evalBinary(
    op: string,
    leftExpr: Expression,
    rightExpr: Expression,
    env: Environment,
  ): Value {
    const left = this.evalExpr(leftExpr, env)
    const right = this.evalExpr(rightExpr, env)

    // String concatenation
    if (
      op === 'add' &&
      (typeof left === 'string' || typeof right === 'string')
    ) {
      return String(left) + String(right)
    }

    const l = this.toNumber(left)
    const r = this.toNumber(right)

    switch (op) {
      case 'add':
        return l + r
      case 'subtract':
        return l - r
      case 'multiply':
        return l * r
      case 'divide':
        if (r === 0) throw new Error('Division by zero')
        return Math.trunc(l / r)
      case 'eq':
        return left === right
      case 'neq':
        return left !== right
      case 'gt':
        return l > r
      case 'lt':
        return l < r
      case 'gte':
        return l >= r
      case 'lte':
        return l <= r
      case 'and':
        return !!left && !!right
      case 'or':
        return !!left || !!right
      default:
        throw new Error(`Unknown operator: ${op}`)
    }
  }

  private evalUnary(op: string, expr: Expression, env: Environment): Value {
    const value = this.evalExpr(expr, env)
    switch (op) {
      case 'negate':
        return -this.toNumber(value)
      case 'not':
        return !value
      default:
        throw new Error(`Unknown unary operator: ${op}`)
    }
  }

  private toNumber(value: Value): number {
    if (typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    throw new Error(`Expected number, got ${typeof value}`)
  }

  private collectDiceVars(env: Environment): Record<string, number> {
    const vars: Record<string, number> = {}
    for (const [name, value] of env.entries()) {
      if (typeof value === 'number') {
        vars[name] = value
      } else if (typeof value === 'boolean') {
        vars[name] = value ? 1 : 0
      }
    }
    return vars
  }
}

class Environment {
  private readonly vars = new Map<string, Value>()
  private readonly parent: Environment | null

  constructor(parent: Environment | null = null) {
    this.parent = parent
  }

  has(name: string): boolean {
    return this.vars.has(name)
  }

  get(name: string): Value | undefined {
    const value = this.vars.get(name)
    if (value !== undefined) return value
    return this.parent?.get(name)
  }

  set(name: string, value: Value): void {
    this.vars.set(name, value)
  }

  child(): Environment {
    return new Environment(this)
  }

  entries(): IterableIterator<[string, Value]> {
    const all = new Map<string, Value>()
    if (this.parent) {
      for (const [k, v] of this.parent.entries()) {
        all.set(k, v)
      }
    }
    for (const [k, v] of this.vars) {
      all.set(k, v)
    }
    return all.entries()
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/evaluator.ts test/evaluator.spec.ts
git commit -m "feat: add program evaluator with full expression support"
```

---

### Task 6: Program Probability Analysis

**Files:**

- Create: `src/program-stats.ts`
- Create: `test/program-stats.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `test/program-stats.spec.ts`:

```ts
import { ProgramParser } from '../src/program-parser'
import { ProgramStats } from '../src/program-stats'
import type { Program } from '../src/program'

function parseProgram(input: string): Program {
  const result = ProgramParser.parse(input)
  if (!result.success) throw new Error('Parse failed')
  return result.program
}

describe('program stats', () => {
  test('simple number distribution', () => {
    const prog = parseProgram('`d6`')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('number')
    if (result.type === 'number') {
      expect(result.mean).toBeCloseTo(3.5, 0)
      expect(result.min).toBe(1)
      expect(result.max).toBe(6)
    }
  })

  test('record distribution', () => {
    const prog = parseProgram(
      '$roll = `d20`\n{ attack: $roll, doubled: $roll * 2 }',
    )
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('record')
    if (result.type === 'record') {
      expect(result.fields.attack.type).toBe('number')
      expect(result.fields.doubled.type).toBe('number')
      if (result.fields.attack.type === 'number') {
        expect(result.fields.attack.mean).toBeCloseTo(10.5, 0)
      }
    }
  })

  test('conditional probability', () => {
    const prog = parseProgram(
      `$roll = \`d20\`
$hit = $roll >= 11
$damage = if $hit then \`2d6\` else 0
{ damage: $damage }`,
    )
    const result = ProgramStats.analyze(prog, { trials: 50000 })
    expect(result.type).toBe('record')
    if (result.type === 'record') {
      const dmg = result.fields.damage
      if (dmg.type === 'number') {
        // 50% chance of 0, 50% chance of 2d6 (mean 7)
        // overall mean ~3.5
        expect(dmg.mean).toBeCloseTo(3.5, 0)
        expect(dmg.min).toBe(0)
      }
    }
  })

  test('boolean distribution', () => {
    const prog = parseProgram('`d6` >= 4')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('boolean')
    if (result.type === 'boolean') {
      expect(result.truePercent).toBeCloseTo(0.5, 1)
    }
  })

  test('array distribution', () => {
    const prog = parseProgram('repeat 3 { `d6` }')
    const result = ProgramStats.analyze(prog, { trials: 10000 })
    expect(result.type).toBe('array')
    if (result.type === 'array') {
      expect(result.elements).toHaveLength(3)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/program-stats.spec.ts`
Expected: FAIL - `ProgramStats` doesn't exist

- [ ] **Step 3: Implement program stats**

Create `src/program-stats.ts`:

```ts
import type { Program, Value } from './program'
import { Evaluator } from './evaluator'
import { Roller } from './roller'

export type FieldStats =
  | {
      type: 'number'
      mean: number
      stddev: number
      min: number
      max: number
      distribution: Map<number, number>
    }
  | { type: 'boolean'; truePercent: number }
  | { type: 'string'; frequencies: Map<string, number> }
  | { type: 'array'; elements: FieldStats[] }
  | { type: 'record'; fields: Record<string, FieldStats> }
  | { type: 'mixed' }

interface AnalyzeOptions {
  trials?: number
}

export const ProgramStats = {
  analyze(program: Program, options?: AnalyzeOptions): FieldStats {
    const trials = options?.trials ?? 10000
    const results: Value[] = []

    for (let i = 0; i < trials; i++) {
      const roller = new Roller((max) => Math.floor(Math.random() * max) + 1)
      const evaluator = new Evaluator(roller)
      results.push(evaluator.run(program))
    }

    return buildStats(results)
  },
}

function buildStats(values: Value[]): FieldStats {
  if (values.length === 0) return { type: 'mixed' }

  const first = values[0]

  if (typeof first === 'number') {
    return buildNumberStats(values as number[])
  }
  if (typeof first === 'boolean') {
    return buildBooleanStats(values as boolean[])
  }
  if (typeof first === 'string') {
    return buildStringStats(values as string[])
  }
  if (Array.isArray(first)) {
    return buildArrayStats(values as Value[][])
  }
  if (typeof first === 'object' && first !== null) {
    return buildRecordStats(values as Record<string, Value>[])
  }

  return { type: 'mixed' }
}

function buildNumberStats(values: number[]): FieldStats {
  const dist: Map<number, number> = new Map()
  let sum = 0
  let min = Infinity
  let max = -Infinity

  for (const v of values) {
    dist.set(v, (dist.get(v) ?? 0) + 1)
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }

  const mean = sum / values.length
  let variance = 0
  for (const v of values) {
    variance += (v - mean) ** 2
  }
  variance /= values.length

  // Normalize distribution
  for (const [k, v] of dist) {
    dist.set(k, v / values.length)
  }

  return {
    type: 'number',
    mean,
    stddev: Math.sqrt(variance),
    min,
    max,
    distribution: dist,
  }
}

function buildBooleanStats(values: boolean[]): FieldStats {
  const trueCount = values.filter((v) => v).length
  return {
    type: 'boolean',
    truePercent: trueCount / values.length,
  }
}

function buildStringStats(values: string[]): FieldStats {
  const freq: Map<string, number> = new Map()
  for (const v of values) {
    freq.set(v, ((freq.get(v) ?? 0) + 1) / values.length)
  }
  return { type: 'string', frequencies: freq }
}

function buildArrayStats(values: Value[][]): FieldStats {
  if (values.length === 0) return { type: 'array', elements: [] }
  const len = values[0].length
  const elements: FieldStats[] = []
  for (let i = 0; i < len; i++) {
    elements.push(buildStats(values.map((v) => v[i])))
  }
  return { type: 'array', elements }
}

function buildRecordStats(values: Record<string, Value>[]): FieldStats {
  if (values.length === 0) return { type: 'record', fields: {} }
  const keys = Object.keys(values[0])
  const fields: Record<string, FieldStats> = {}
  for (const key of keys) {
    fields[key] = buildStats(values.map((v) => v[key]))
  }
  return { type: 'record', fields }
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/program-stats.ts test/program-stats.spec.ts
git commit -m "feat: add program-level probability analysis via Monte Carlo"
```

---

### Task 7: Wire Up Exports and Parser API

**Files:**

- Modify: `src/dice-parser.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add parseProgram to DiceParser**

In `src/dice-parser.ts`, import and re-export:

```ts
import { ProgramParser, type ParseProgramResult } from './program-parser'
```

Add to the `DiceParser` object:

```ts
parseProgram(input: string): ParseProgramResult {
  return ProgramParser.parse(input)
},
```

- [ ] **Step 2: Update index.ts**

Add exports:

```ts
export type {
  Program,
  Statement,
  Assignment,
  ExpressionStatement,
  Expression,
  NumberLiteral,
  BooleanLiteral,
  StringLiteral,
  VariableRef,
  DiceExpr,
  BinaryExpr,
  BinaryOper,
  UnaryExpr,
  IfExpr,
  RecordExpr,
  RecordField,
  ArrayExpr,
  RepeatExpr,
  FieldAccess,
  IndexAccess,
  Value,
  RuntimeError,
} from './program'

export {
  program,
  assignment,
  expressionStatement,
  numberLiteral,
  booleanLiteral,
  stringLiteral,
  variableRef,
  diceExpr,
  binaryExpr,
  unaryExpr,
  ifExpr,
  recordExpr,
  arrayExpr,
  repeatExpr,
  fieldAccess,
  indexAccess,
  runtimeError,
} from './program'

export { Evaluator } from './evaluator'
export { ProgramStats, type FieldStats } from './program-stats'
export { ProgramParser, type ParseProgramResult } from './program-parser'
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Run full verify**

Run: `npm run verify`
Expected: All checks pass

- [ ] **Step 5: Commit**

```bash
git add src/dice-parser.ts src/index.ts
git commit -m "feat: wire up program parser and evaluator exports"
```

---

### Task 8: Final Integration Tests and Cleanup

**Files:**

- All source and test files

- [ ] **Step 1: Run prettier**

Run: `npx prettier --write .`

- [ ] **Step 2: Run full verify**

Run: `npm run verify`
Expected: All checks pass (lint, format, types, tests)

- [ ] **Step 3: Run coverage**

Run: `npx vitest run --coverage`
Expected: Good coverage across new modules

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: formatting and cleanup"
```
