import { DiceParser } from './dice-parser'
import type { ParseError } from './parse-error'
import {
  type Program,
  type Statement,
  type Expression,
  type BinaryOper,
  type MatchArm,
  type MatchExpr,
  type MatchPattern,
  type ParameterDeclaration,
  type ParameterSpec,
  type ParameterDefault,
  type Value,
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
  matchExpr,
  matchArm,
  wildcardPattern,
  expressionPattern,
  parameterDeclaration,
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
  'is',
  'match',
])

const ALLOWED_PARAM_FIELDS = new Set([
  'default',
  'label',
  'description',
  'min',
  'max',
  'enum',
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
    // Try assignment: $name = expr  or  $name is { ... }
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
        } else if (this.matchKeyword('is')) {
          return this.parseParameterDeclaration(name)
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

  parseParameterDeclaration(name: string): ParameterDeclaration {
    this.skipWhitespaceAndComments()
    this.expect('{')
    this.skipWhitespaceAndComments()

    const fields = new Map<string, unknown>()
    while (this.pos < this.input.length && this.input[this.pos] !== '}') {
      const fieldName = this.parseIdentifier()
      if (!ALLOWED_PARAM_FIELDS.has(fieldName)) {
        throw new Error(
          `Unknown field '${fieldName}' in parameter $${name} (allowed: default, label, description, min, max, enum)`,
        )
      }
      if (fields.has(fieldName)) {
        throw new Error(`Duplicate field '${fieldName}' in parameter $${name}`)
      }
      this.skipSpaces()
      this.expect(':')
      this.skipWhitespaceAndComments()
      const value = this.parseParameterFieldValue(name, fieldName)
      fields.set(fieldName, value)
      this.skipWhitespaceAndComments()
      if (this.pos < this.input.length && this.input[this.pos] === ',') {
        this.pos++
        this.skipWhitespaceAndComments()
      } else {
        break
      }
    }
    this.skipWhitespaceAndComments()
    this.expect('}')

    const spec = buildAndValidateParameterSpec(name, fields)
    return parameterDeclaration(name, spec)
  }

  private parseParameterFieldValue(
    paramName: string,
    fieldName: string,
  ): unknown {
    switch (fieldName) {
      case 'default':
        return this.parseParameterDefaultValue(paramName)
      case 'label':
      case 'description':
        return this.parseParameterStringLiteral(fieldName)
      case 'min':
      case 'max':
        return this.parseParameterNumberLiteral(fieldName)
      case 'enum':
        return this.parseParameterEnumLiteral()
      default:
        throw new Error(
          `Unknown field '${fieldName}' in parameter $${paramName}`,
        )
    }
  }

  private parseParameterDefaultValue(paramName: string): ParameterDefault {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      throw new Error(
        `Expected default value for parameter $${paramName} at position ${this.pos}`,
      )
    }
    const ch = this.input[this.pos]
    if (ch === '`') {
      const expr = this.parseDiceExpr()
      if (expr.type !== 'dice-expr') {
        throw new Error(
          `Expected dice expression for parameter $${paramName} default`,
        )
      }
      return { kind: 'dice', expr: expr.expr, source: expr.source }
    }
    if (ch === '"') {
      const v = this.parseStringExpr()
      if (v.type !== 'string-literal') {
        throw new Error(
          `Expected string literal for parameter $${paramName} default`,
        )
      }
      return { kind: 'value', value: v.value }
    }
    if (ch === '-') {
      this.pos++
      this.skipSpaces()
      if (
        this.pos >= this.input.length ||
        this.input[this.pos] < '0' ||
        this.input[this.pos] > '9'
      ) {
        throw new Error(
          `Expected number after '-' for parameter $${paramName} default at position ${this.pos}`,
        )
      }
      return { kind: 'value', value: -this.parseNumber() }
    }
    if (ch >= '0' && ch <= '9') {
      return { kind: 'value', value: this.parseNumber() }
    }
    if (this.matchKeyword('true')) {
      return { kind: 'value', value: true }
    }
    if (this.matchKeyword('false')) {
      return { kind: 'value', value: false }
    }
    throw new Error(
      `Default value for parameter $${paramName} must be a number, boolean, string, or backtick dice expression at position ${this.pos}`,
    )
  }

  private parseParameterStringLiteral(fieldName: string): string {
    this.skipSpaces()
    if (this.pos >= this.input.length || this.input[this.pos] !== '"') {
      throw new Error(
        `Field '${fieldName}' must be a string literal at position ${this.pos}`,
      )
    }
    const v = this.parseStringExpr()
    if (v.type !== 'string-literal') {
      throw new Error(
        `Field '${fieldName}' must be a string literal at position ${this.pos}`,
      )
    }
    return v.value
  }

  private parseParameterNumberLiteral(fieldName: string): number {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      throw new Error(
        `Field '${fieldName}' must be a number literal at position ${this.pos}`,
      )
    }
    const ch = this.input[this.pos]
    if (ch === '-') {
      this.pos++
      this.skipSpaces()
      if (
        this.pos >= this.input.length ||
        this.input[this.pos] < '0' ||
        this.input[this.pos] > '9'
      ) {
        throw new Error(
          `Field '${fieldName}' must be a number literal at position ${this.pos}`,
        )
      }
      return -this.parseNumber()
    }
    if (ch < '0' || ch > '9') {
      throw new Error(
        `Field '${fieldName}' must be a number literal at position ${this.pos}`,
      )
    }
    return this.parseNumber()
  }

  private parseParameterEnumLiteral(): Value[] {
    this.skipSpaces()
    if (this.pos >= this.input.length || this.input[this.pos] !== '[') {
      throw new Error(
        `Field 'enum' must be an array literal at position ${this.pos}`,
      )
    }
    this.pos++ // skip [
    this.skipWhitespaceAndComments()
    const elements: Value[] = []
    if (this.pos < this.input.length && this.input[this.pos] === ']') {
      this.pos++
      return elements
    }
    elements.push(this.parseParameterLiteralValue())
    this.skipWhitespaceAndComments()
    while (this.pos < this.input.length && this.input[this.pos] === ',') {
      this.pos++
      this.skipWhitespaceAndComments()
      // allow trailing comma
      if (this.pos < this.input.length && this.input[this.pos] === ']') break
      elements.push(this.parseParameterLiteralValue())
      this.skipWhitespaceAndComments()
    }
    this.expect(']')
    return elements
  }

  private parseParameterLiteralValue(): Value {
    this.skipSpaces()
    if (this.pos >= this.input.length) {
      throw new Error(`Expected literal value at position ${this.pos}`)
    }
    const ch = this.input[this.pos]
    if (ch === '"') {
      const v = this.parseStringExpr()
      if (v.type !== 'string-literal') {
        throw new Error(`Expected string literal at position ${this.pos}`)
      }
      return v.value
    }
    if (ch === '-') {
      this.pos++
      this.skipSpaces()
      if (
        this.pos >= this.input.length ||
        this.input[this.pos] < '0' ||
        this.input[this.pos] > '9'
      ) {
        throw new Error(`Expected number after '-' at position ${this.pos}`)
      }
      return -this.parseNumber()
    }
    if (ch >= '0' && ch <= '9') {
      return this.parseNumber()
    }
    if (this.matchKeyword('true')) return true
    if (this.matchKeyword('false')) return false
    throw new Error(
      `Expected literal value (number, boolean, or string) at position ${this.pos}`,
    )
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
        // Don't consume '->': it's a match-arm arrow, not subtraction
        if (
          this.pos + 1 < this.input.length &&
          this.input[this.pos + 1] === '>'
        ) {
          break
        }
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
    if (this.matchKeyword('match')) {
      return this.parseMatchExpr()
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`)
  }

  parseMatchExpr(): MatchExpr {
    this.skipWhitespaceAndComments()

    // Detect mode: if next char is '{', guard mode; else value mode
    let value: Expression | undefined
    if (this.pos >= this.input.length) {
      throw new Error(`Expected '{' or value expression after 'match'`)
    }
    if (this.input[this.pos] !== '{') {
      value = this.parseExpression()
      this.skipWhitespaceAndComments()
    }

    this.expect('{')
    this.skipWhitespaceAndComments()

    const arms: MatchArm[] = []
    while (this.pos < this.input.length && this.input[this.pos] !== '}') {
      arms.push(this.parseMatchArm())
      this.skipWhitespaceAndComments()
      if (this.pos < this.input.length && this.input[this.pos] === ',') {
        this.pos++
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
    this.skipWhitespaceAndComments()

    // Parse pattern: '_' or expression
    let pattern: MatchPattern
    if (this.matchWildcard()) {
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
    this.expectArrow()
    this.skipWhitespaceAndComments()

    const body = this.parseExpression()
    return matchArm(pattern, body, guard)
  }

  matchWildcard(): boolean {
    const saved = this.pos
    this.skipSpaces()
    if (this.pos >= this.input.length || this.input[this.pos] !== '_') {
      this.pos = saved
      return false
    }
    const after = this.pos + 1
    // '_foo' or '_1' should NOT match the wildcard
    if (after < this.input.length && /[a-zA-Z0-9_]/.test(this.input[after])) {
      this.pos = saved
      return false
    }
    this.pos = after
    return true
  }

  matchArrow(): boolean {
    const saved = this.pos
    this.skipSpaces()
    if (
      this.pos + 1 < this.input.length &&
      this.input[this.pos] === '-' &&
      this.input[this.pos + 1] === '>'
    ) {
      this.pos += 2
      return true
    }
    this.pos = saved
    return false
  }

  expectArrow(): void {
    if (!this.matchArrow()) {
      throw new Error(`Expected '->' at position ${this.pos}`)
    }
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

    // The dice parser natively recognises `$var` in additive, count, and
    // sides positions (producing dice-variable-ref or n-dice nodes), so we
    // can pass the source through unchanged.
    const parsed = DiceParser.parseOrNull(source)
    if (parsed === null) {
      throw new Error(`Invalid dice expression: ${source}`)
    }

    return diceExpr(parsed, source)
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
      if (this.pos < this.input.length && this.input[this.pos] === ']') {
        break
      }
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
      if (this.pos < this.input.length && this.input[this.pos] === '}') {
        break
      }
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
    if (key === '_') {
      throw new Error(
        `'_' is reserved as the wildcard pattern and cannot be used as a record key at position ${this.pos}`,
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

function buildAndValidateParameterSpec(
  paramName: string,
  fields: Map<string, unknown>,
): ParameterSpec {
  const def = fields.get('default') as ParameterDefault | undefined
  if (def === undefined) {
    throw new Error(`Parameter $${paramName} missing required field 'default'`)
  }

  const spec: ParameterSpec = { default: def }

  const label = fields.get('label')
  if (label !== undefined) {
    if (typeof label !== 'string') {
      throw new Error(`Field 'label' must be a string literal`)
    }
    spec.label = label
  }

  const description = fields.get('description')
  if (description !== undefined) {
    if (typeof description !== 'string') {
      throw new Error(`Field 'description' must be a string literal`)
    }
    spec.description = description
  }

  const min = fields.get('min')
  const max = fields.get('max')
  const enumVals = fields.get('enum')

  const defaultIsNumber = def.kind === 'value' && typeof def.value === 'number'
  const defaultIsDice = def.kind === 'dice'

  if (min !== undefined) {
    if (typeof min !== 'number') {
      throw new Error(`Field 'min' must be a number literal`)
    }
    if (!defaultIsNumber && !defaultIsDice) {
      throw new Error(`Field 'min' is only valid for number defaults`)
    }
    spec.min = min
  }

  if (max !== undefined) {
    if (typeof max !== 'number') {
      throw new Error(`Field 'max' must be a number literal`)
    }
    if (!defaultIsNumber && !defaultIsDice) {
      throw new Error(`Field 'max' is only valid for number defaults`)
    }
    spec.max = max
  }

  if (enumVals !== undefined) {
    if (!Array.isArray(enumVals)) {
      throw new Error(`Field 'enum' must be an array literal`)
    }
    if (defaultIsNumber || defaultIsDice) {
      throw new Error(`Field 'enum' is only valid for non-number defaults`)
    }
    // Verify all enum entries match the default's primitive kind.
    if (def.kind === 'value') {
      const defaultType = typeof def.value
      for (const v of enumVals as unknown[]) {
        if (typeof v !== defaultType) {
          throw new Error(
            `Enum entries must all be of type '${defaultType}' to match default`,
          )
        }
      }
      // Ensure default is in enum.
      const found = (enumVals as unknown[]).some((v) => v === def.value)
      if (!found) {
        throw new Error(
          `Default value ${formatValue(def.value)} is not a member of enum [${(enumVals as unknown[]).map(formatValue).join(', ')}]`,
        )
      }
    }
    spec.enum = enumVals as Value[]
  }

  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    throw new Error(`min (${spec.min}) must be <= max (${spec.max})`)
  }

  if (defaultIsNumber && def.kind === 'value') {
    const v = def.value as number
    if (spec.min !== undefined && v < spec.min) {
      throw new Error(
        `default (${v}) is out of range [${spec.min}, ${spec.max ?? ''}]`,
      )
    }
    if (spec.max !== undefined && v > spec.max) {
      throw new Error(
        `default (${v}) is out of range [${spec.min ?? ''}, ${spec.max}]`,
      )
    }
  }

  return spec
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}
