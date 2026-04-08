import { DiceParser } from './dice-parser'
import { diceVariableRef } from './dice-expression'
import type { DiceExpression } from './dice-expression'
import type { ParseError } from './parse-error'
import {
  type Program,
  type Statement,
  type Expression,
  type BinaryOper,
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
} from './program'

export type ParseProgramResult =
  | { success: true; program: Program }
  | { success: false; errors: ParseError[] }

export const ProgramParser = {
  parse(input: string): ParseProgramResult {
    const parser = new Parser(input)
    try {
      const statements = parser.parseStatements()
      return { success: true, program: program(statements) }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        success: false,
        errors: [
          {
            message: msg,
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
])

class Parser {
  pos = 0
  constructor(private readonly input: string) {}

  parseStatements(): Statement[] {
    const stmts: Statement[] = []
    this.skipWhitespaceAndComments()
    while (this.pos < this.input.length) {
      stmts.push(this.parseStatement())
      this.skipSpaces()
      // consume optional comment at end of line
      if (this.pos < this.input.length && this.input[this.pos] === '#') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
      }
      // expect newline or end
      if (this.pos < this.input.length) {
        if (this.input[this.pos] === '\n') {
          this.skipWhitespaceAndComments()
        } else if (this.pos < this.input.length) {
          // might be end of input after skipping
        }
      }
    }
    return stmts
  }

  parseStatement(): Statement {
    // Try assignment: $name = expr
    if (this.input[this.pos] === '$') {
      const savedPos = this.pos
      try {
        const name = this.parseVariableName()
        this.skipSpaces()
        if (this.pos < this.input.length && this.input[this.pos] === '=') {
          // Make sure it's not ==
          if (
            this.pos + 1 < this.input.length &&
            this.input[this.pos + 1] === '='
          ) {
            // It's ==, not assignment
            this.pos = savedPos
          } else {
            this.pos++ // skip =
            this.skipSpaces()
            const value = this.parseExpression()
            return assignment(name, value)
          }
        } else {
          this.pos = savedPos
        }
      } catch {
        this.pos = savedPos
      }
    }
    const expr = this.parseExpression()
    return expressionStatement(expr)
  }

  parseExpression(): Expression {
    return this.parseOr()
  }

  parseOr(): Expression {
    let left = this.parseAnd()
    while (this.matchKeyword('or')) {
      this.skipSpaces()
      const right = this.parseAnd()
      left = binaryExpr('or', left, right)
    }
    return left
  }

  parseAnd(): Expression {
    let left = this.parseComparison()
    while (this.matchKeyword('and')) {
      this.skipSpaces()
      const right = this.parseComparison()
      left = binaryExpr('and', left, right)
    }
    return left
  }

  parseComparison(): Expression {
    let left = this.parseAddSub()
    const op = this.matchComparisonOp()
    if (op) {
      this.skipSpaces()
      const right = this.parseAddSub()
      left = binaryExpr(op, left, right)
    }
    return left
  }

  parseAddSub(): Expression {
    let left = this.parseMulDiv()
    for (;;) {
      this.skipSpaces()
      if (this.pos >= this.input.length) break
      const ch = this.input[this.pos]
      if (ch === '+') {
        this.pos++
        this.skipSpaces()
        const right = this.parseMulDiv()
        left = binaryExpr('add', left, right)
      } else if (ch === '-') {
        this.pos++
        this.skipSpaces()
        const right = this.parseMulDiv()
        left = binaryExpr('subtract', left, right)
      } else {
        break
      }
    }
    return left
  }

  parseMulDiv(): Expression {
    let left = this.parseUnary()
    for (;;) {
      this.skipSpaces()
      if (this.pos >= this.input.length) break
      const ch = this.input[this.pos]
      if (ch === '*') {
        this.pos++
        this.skipSpaces()
        const right = this.parseUnary()
        left = binaryExpr('multiply', left, right)
      } else if (ch === '/') {
        this.pos++
        this.skipSpaces()
        const right = this.parseUnary()
        left = binaryExpr('divide', left, right)
      } else {
        break
      }
    }
    return left
  }

  parseUnary(): Expression {
    this.skipSpaces()
    if (this.pos < this.input.length) {
      if (this.input[this.pos] === '-') {
        this.pos++
        this.skipSpaces()
        const expr = this.parseUnary()
        return unaryExpr('negate', expr)
      }
      if (this.matchKeyword('not')) {
        this.skipSpaces()
        const expr = this.parseUnary()
        return unaryExpr('not', expr)
      }
    }
    return this.parsePostfix()
  }

  parsePostfix(): Expression {
    let expr = this.parsePrimary()
    for (;;) {
      if (this.pos < this.input.length && this.input[this.pos] === '.') {
        this.pos++
        const field = this.parseIdentifier()
        expr = fieldAccess(expr, field)
      } else if (this.pos < this.input.length && this.input[this.pos] === '[') {
        this.pos++
        this.skipSpaces()
        const index = this.parseExpression()
        this.skipSpaces()
        this.expect(']')
        expr = indexAccess(expr, index)
      } else {
        break
      }
    }
    return expr
  }

  parsePrimary(): Expression {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      throw new Error('Unexpected end of input')
    }

    const ch = this.input[this.pos]

    // Backtick dice expression
    if (ch === '`') {
      return this.parseDiceExpr()
    }

    // String literal
    if (ch === '"') {
      return this.parseStringExpr()
    }

    // Array
    if (ch === '[') {
      return this.parseArrayExpr()
    }

    // Record
    if (ch === '{') {
      return this.parseRecordExpr()
    }

    // Parenthesized expression
    if (ch === '(') {
      this.pos++
      this.skipSpaces()
      const expr = this.parseExpression()
      this.skipSpaces()
      this.expect(')')
      return expr
    }

    // Variable reference
    if (ch === '$') {
      const name = this.parseVariableName()
      return variableRef(name)
    }

    // Number literal
    if (ch >= '0' && ch <= '9') {
      return numberLiteral(this.parseNumber())
    }

    // Keywords: true, false, if, repeat
    if (this.matchKeyword('true')) {
      return booleanLiteral(true)
    }
    if (this.matchKeyword('false')) {
      return booleanLiteral(false)
    }
    if (this.matchKeyword('if')) {
      return this.parseIf()
    }
    if (this.matchKeyword('repeat')) {
      return this.parseRepeat()
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`)
  }

  parseDiceExpr(): Expression {
    this.pos++ // skip opening backtick
    const start = this.pos
    while (this.pos < this.input.length && this.input[this.pos] !== '`') {
      this.pos++
    }
    if (this.pos >= this.input.length) {
      throw new Error('Unterminated backtick expression')
    }
    const source = this.input.substring(start, this.pos)
    this.pos++ // skip closing backtick

    // Find all $name references
    const varPattern = /\$([a-z_][a-z0-9_]*)/g
    const vars: { name: string; placeholder: number }[] = []
    let placeholderBase = 99990
    let match: RegExpExecArray | null
    while ((match = varPattern.exec(source)) !== null) {
      vars.push({ name: match[1], placeholder: placeholderBase++ })
    }

    // Replace variables with placeholders
    let substituted = source
    for (const v of vars) {
      substituted = substituted.replaceAll('$' + v.name, String(v.placeholder))
    }

    const parsed = DiceParser.parseOrNull(substituted)
    if (parsed === null) {
      throw new Error(`Invalid dice expression: ${source}`)
    }

    // Walk AST and replace placeholder literals with variable refs
    const walked = vars.length > 0 ? walkDiceAst(parsed, vars) : parsed

    return diceExpr(walked, source)
  }

  parseArrayExpr(): Expression {
    this.pos++ // skip [
    this.skipWhitespaceAndComments()
    const elements: Expression[] = []
    if (this.pos < this.input.length && this.input[this.pos] === ']') {
      this.pos++
      return arrayExpr(elements)
    }
    elements.push(this.parseExpression())
    this.skipWhitespaceAndComments()
    while (this.pos < this.input.length && this.input[this.pos] === ',') {
      this.pos++
      this.skipWhitespaceAndComments()
      elements.push(this.parseExpression())
      this.skipWhitespaceAndComments()
    }
    this.expect(']')
    return arrayExpr(elements)
  }

  parseRecordExpr(): Expression {
    this.pos++ // skip {
    this.skipWhitespaceAndComments()
    const fields: { key: string; value: Expression }[] = []
    if (this.pos < this.input.length && this.input[this.pos] === '}') {
      this.pos++
      return recordExpr(fields)
    }
    fields.push(this.parseRecordField())
    this.skipWhitespaceAndComments()
    while (this.pos < this.input.length && this.input[this.pos] === ',') {
      this.pos++
      this.skipWhitespaceAndComments()
      fields.push(this.parseRecordField())
      this.skipWhitespaceAndComments()
    }
    this.skipWhitespaceAndComments()
    this.expect('}')
    return recordExpr(fields)
  }

  private parseRecordField(): { key: string; value: Expression } {
    if (this.input[this.pos] === '$') {
      // Could be shorthand { $var } or { $var: expr }
      const savedPos = this.pos
      const name = this.parseVariableName()
      this.skipSpaces()
      if (this.pos < this.input.length && this.input[this.pos] === ':') {
        // Regular field with $ variable name as key - not valid, backtrack
        this.pos = savedPos
      } else {
        // Shorthand
        return { key: name, value: variableRef(name) }
      }
    }
    const key = this.parseIdentifier()
    if (RESERVED.has(key)) {
      throw new Error(
        `'${key}' is a reserved word and cannot be used as a record key at position ${this.pos}`,
      )
    }
    this.skipSpaces()
    this.expect(':')
    this.skipSpaces()
    const value = this.parseExpression()
    return { key, value }
  }

  parseIf(): Expression {
    this.skipWhitespaceAndComments()
    const condition = this.parseExpression()
    this.skipWhitespaceAndComments()
    if (!this.matchKeyword('then')) {
      throw new Error(`Expected 'then' at position ${this.pos}`)
    }
    this.skipWhitespaceAndComments()
    const thenExpr = this.parseExpression()
    this.skipWhitespaceAndComments()
    if (!this.matchKeyword('else')) {
      throw new Error(`Expected 'else' at position ${this.pos}`)
    }
    this.skipWhitespaceAndComments()
    const elseExpr = this.parseExpression()
    return ifExpr(condition, thenExpr, elseExpr)
  }

  parseRepeat(): Expression {
    this.skipSpaces()
    const count = this.parseExpression()
    this.skipWhitespaceAndComments()
    this.expect('{')
    this.skipWhitespaceAndComments()
    const body: Statement[] = []
    while (this.pos < this.input.length && this.input[this.pos] !== '}') {
      body.push(this.parseStatement())
      this.skipSpaces()
      // consume optional comment
      if (this.pos < this.input.length && this.input[this.pos] === '#') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
      }
      this.skipWhitespaceAndComments()
    }
    this.expect('}')
    return repeatExpr(count, body)
  }

  parseVariableName(): string {
    this.expect('$')
    const start = this.pos
    if (this.pos < this.input.length && /[a-z_]/.test(this.input[this.pos])) {
      this.pos++
      while (
        this.pos < this.input.length &&
        /[a-z0-9_]/.test(this.input[this.pos])
      ) {
        this.pos++
      }
    }
    if (this.pos === start) {
      throw new Error(`Expected variable name at position ${this.pos}`)
    }
    return this.input.substring(start, this.pos)
  }

  parseIdentifier(): string {
    const start = this.pos
    while (
      this.pos < this.input.length &&
      /[a-zA-Z0-9_]/.test(this.input[this.pos])
    ) {
      this.pos++
    }
    if (this.pos === start) {
      throw new Error(`Expected identifier at position ${this.pos}`)
    }
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

  parseStringExpr(): Expression {
    this.pos++ // skip opening "
    let value = ''
    while (this.pos < this.input.length && this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\\') {
        this.pos++ // skip backslash
        const ch = this.input[this.pos]
        switch (ch) {
          case 'n':
            value += '\n'
            break
          case 't':
            value += '\t'
            break
          case '"':
            value += '"'
            break
          case '\\':
            value += '\\'
            break
          default:
            value += ch
            break
        }
        this.pos++
      } else {
        value += this.input[this.pos]
        this.pos++
      }
    }
    if (this.pos >= this.input.length) {
      throw new Error('Unterminated string literal')
    }
    this.pos++ // skip closing "
    return stringLiteral(value)
  }

  matchKeyword(kw: string): boolean {
    const savedPos = this.pos
    this.skipSpaces()
    if (this.input.substring(this.pos, this.pos + kw.length) === kw) {
      const afterKw = this.pos + kw.length
      // Check that keyword isn't followed by an identifier character
      if (
        afterKw < this.input.length &&
        /[a-zA-Z0-9_]/.test(this.input[afterKw])
      ) {
        this.pos = savedPos
        return false
      }
      this.pos = afterKw
      return true
    }
    this.pos = savedPos
    return false
  }

  matchComparisonOp(): BinaryOper | null {
    this.skipSpaces()
    if (this.pos >= this.input.length) return null

    // Two-char ops first
    const two = this.input.substring(this.pos, this.pos + 2)
    if (two === '>=') {
      this.pos += 2
      return 'gte'
    }
    if (two === '<=') {
      this.pos += 2
      return 'lte'
    }
    if (two === '==') {
      this.pos += 2
      return 'eq'
    }
    if (two === '!=') {
      this.pos += 2
      return 'neq'
    }

    // Single-char ops
    const one = this.input[this.pos]
    if (one === '>') {
      this.pos++
      return 'gt'
    }
    if (one === '<') {
      this.pos++
      return 'lt'
    }

    return null
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
    for (;;) {
      // Skip whitespace including newlines
      while (
        this.pos < this.input.length &&
        (this.input[this.pos] === ' ' ||
          this.input[this.pos] === '\t' ||
          this.input[this.pos] === '\n' ||
          this.input[this.pos] === '\r')
      ) {
        this.pos++
      }
      // Skip # comments
      if (this.pos < this.input.length && this.input[this.pos] === '#') {
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
        continue
      }
      break
    }
  }

  expect(ch: string): void {
    if (this.pos >= this.input.length || this.input[this.pos] !== ch) {
      throw new Error(
        `Expected '${ch}' at position ${this.pos}, got '${this.pos < this.input.length ? this.input[this.pos] : 'EOF'}'`,
      )
    }
    this.pos++
  }
}

function walkDiceAst(
  expr: DiceExpression,
  vars: { name: string; placeholder: number }[],
): DiceExpression {
  switch (expr.type) {
    case 'literal': {
      const found = vars.find((v) => v.placeholder === expr.value)
      if (found) {
        return diceVariableRef(found.name)
      }
      return expr
    }
    case 'binary-op':
      return {
        ...expr,
        left: walkDiceAst(expr.left, vars),
        right: walkDiceAst(expr.right, vars),
      }
    case 'unary-op':
      return {
        ...expr,
        expr: walkDiceAst(expr.expr, vars),
      }
    case 'dice-reduce':
      return {
        ...expr,
        reduceable: walkDiceReduceable(expr.reduceable, vars),
      }
    default:
      return expr
  }
}

function walkDiceReduceable(
  reduceable: import('./dice-expression').DiceReduceable,
  vars: { name: string; placeholder: number }[],
): import('./dice-expression').DiceReduceable {
  switch (reduceable.type) {
    case 'dice-expressions':
      return {
        ...reduceable,
        exprs: reduceable.exprs.map((e) => walkDiceAst(e, vars)),
      }
    case 'dice-list-with-filter': {
      const list = reduceable.list
      if (list.type === 'filterable-dice-expressions') {
        return {
          ...reduceable,
          list: {
            ...list,
            exprs: list.exprs.map((e) => walkDiceAst(e, vars)),
          },
        }
      }
      return reduceable
    }
    case 'dice-list-with-map':
      return reduceable
  }
}
