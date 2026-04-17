import type { DiceExpression } from './dice-expression'

export interface Program {
  type: 'program'
  statements: Statement[]
}

export function program(statements: Statement[]): Program {
  return { type: 'program', statements }
}

export type Statement = Assignment | ExpressionStatement | ParameterDeclaration

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

export interface ParameterDeclaration {
  type: 'parameter-declaration'
  name: string
  spec: ParameterSpec
}

export interface ParameterSpec {
  default: ParameterDefault
  label?: string
  description?: string
  min?: number
  max?: number
  enum?: Value[]
}

export type ParameterDefault =
  | { kind: 'value'; value: Value }
  | { kind: 'dice'; expr: DiceExpression; source: string }

export function parameterDeclaration(
  name: string,
  spec: ParameterSpec,
): ParameterDeclaration {
  return { type: 'parameter-declaration', name, spec }
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
