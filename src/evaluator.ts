import type { Roll } from './dice-expression'
import type {
  Program,
  Statement,
  Expression,
  MatchArm,
  Value,
  ParameterSpec,
} from './program'
import { Roller } from './roller'
import { RR } from './roll-result-domain'

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
    return this.vars.get(name) ?? this.parent?.get(name)
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
      for (const [k, v] of this.parent.entries()) all.set(k, v)
    }
    for (const [k, v] of this.vars) all.set(k, v)
    return all.entries()
  }
}

export interface EvaluatorOptions {
  maxRepeatIterations?: number
}

export interface RunOptions {
  parameters?: Record<string, Value>
}

export class Evaluator {
  private readonly rollFn: Roll
  private readonly maxRepeat: number

  constructor(rollFn: Roll, options?: EvaluatorOptions) {
    this.rollFn = rollFn
    this.maxRepeat = options?.maxRepeatIterations ?? 10000
  }

  run(prog: Program, options?: RunOptions): Value {
    const env = new Environment()
    const overrides = options?.parameters ?? {}

    // Collect parameter declarations to validate overrides up-front.
    const declaredParams = new Map<string, ParameterSpec>()
    for (const stmt of prog.statements) {
      if (stmt.type === 'parameter-declaration') {
        declaredParams.set(stmt.name, stmt.spec)
      }
    }
    for (const name of Object.keys(overrides)) {
      const spec = declaredParams.get(name)
      if (spec === undefined) {
        throw new Error(`Unknown parameter: $${name}`)
      }
      validateParameterOverride(name, overrides[name], spec)
    }

    let result: Value = 0
    for (const stmt of prog.statements) {
      result = this.execStatement(stmt, env, overrides)
    }
    return result
  }

  private execStatement(
    stmt: Statement,
    env: Environment,
    parameters: Record<string, Value> = {},
  ): Value {
    switch (stmt.type) {
      case 'assignment': {
        if (env.has(stmt.name)) {
          throw new Error(`Variable '$${stmt.name}' is already defined`)
        }
        const value = this.evalExpr(stmt.value, env)
        env.set(stmt.name, value)
        return value
      }
      case 'expression-statement':
        return this.evalExpr(stmt.expr, env)
      case 'parameter-declaration': {
        if (env.has(stmt.name)) {
          throw new Error(`Cannot reassign immutable variable: $${stmt.name}`)
        }
        let value: Value
        if (Object.prototype.hasOwnProperty.call(parameters, stmt.name)) {
          value = parameters[stmt.name]
        } else if (stmt.spec.default.kind === 'value') {
          value = stmt.spec.default.value
        } else {
          // Dice-expression default - roll using current environment.
          const vars: Record<string, number> = {}
          for (const [name, val] of env.entries()) {
            if (typeof val === 'number') vars[name] = val
            else if (typeof val === 'boolean') vars[name] = val ? 1 : 0
          }
          const roller = new Roller(this.rollFn, undefined, vars)
          value = RR.getResult(roller.roll(stmt.spec.default.expr))
        }
        env.set(stmt.name, value)
        return value
      }
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
        const val = env.get(expr.name)
        if (val === undefined) {
          throw new Error(`Undefined variable '$${expr.name}'`)
        }
        return val
      }

      case 'dice-expr': {
        const vars: Record<string, number> = {}
        for (const [name, value] of env.entries()) {
          if (typeof value === 'number') vars[name] = value
          else if (typeof value === 'boolean') vars[name] = value ? 1 : 0
        }
        const roller = new Roller(this.rollFn, undefined, vars)
        return RR.getResult(roller.roll(expr.expr))
      }

      case 'unary-expr': {
        const val = this.evalExpr(expr.expr, env)
        if (expr.op === 'negate') {
          return -this.toNumber(val)
        } else {
          // 'not'
          return !this.isTruthy(val)
        }
      }

      case 'binary-expr': {
        const left = this.evalExpr(expr.left, env)
        const right = this.evalExpr(expr.right, env)

        switch (expr.op) {
          case 'add':
            if (typeof left === 'string' || typeof right === 'string') {
              return String(left) + String(right)
            }
            return this.toNumber(left) + this.toNumber(right)
          case 'subtract':
            return this.toNumber(left) - this.toNumber(right)
          case 'multiply':
            return this.toNumber(left) * this.toNumber(right)
          case 'divide': {
            const divisor = this.toNumber(right)
            if (divisor === 0) throw new Error('Division by zero')
            return Math.trunc(this.toNumber(left) / divisor)
          }
          case 'eq':
            return left === right
          case 'neq':
            return left !== right
          case 'gt':
            return this.toNumber(left) > this.toNumber(right)
          case 'lt':
            return this.toNumber(left) < this.toNumber(right)
          case 'gte':
            return this.toNumber(left) >= this.toNumber(right)
          case 'lte':
            return this.toNumber(left) <= this.toNumber(right)
          case 'and':
            return this.isTruthy(left) && this.isTruthy(right)
          case 'or':
            return this.isTruthy(left) || this.isTruthy(right)
        }
        break
      }

      case 'if-expr': {
        const cond = this.evalExpr(expr.condition, env)
        if (this.isTruthy(cond)) {
          return this.evalExpr(expr.then, env)
        } else {
          return this.evalExpr(expr.else, env)
        }
      }

      case 'record-expr': {
        const obj: Record<string, Value> = {}
        for (const field of expr.fields) {
          obj[field.key] = this.evalExpr(field.value, env)
        }
        return obj
      }

      case 'array-expr':
        return expr.elements.map((el) => this.evalExpr(el, env))

      case 'repeat-expr': {
        const countVal = this.evalExpr(expr.count, env)
        const count = this.toNumber(countVal)
        if (count > this.maxRepeat) {
          throw new Error(
            `Repeat count ${count} exceeds maximum of ${this.maxRepeat}`,
          )
        }
        if (count < 0) {
          throw new Error('Repeat count must be non-negative')
        }
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
          throw new Error('Field access on non-record value')
        }
        return (obj as Record<string, Value>)[expr.field]
      }

      case 'index-access': {
        const arr = this.evalExpr(expr.object, env)
        const idx = this.toNumber(this.evalExpr(expr.index, env))
        if (!Array.isArray(arr)) {
          throw new Error('Index access on non-array value')
        }
        if (idx < 0 || idx >= arr.length) {
          throw new Error(`Index ${idx} out of bounds (length ${arr.length})`)
        }
        return arr[idx]
      }

      case 'match-expr': {
        const matched =
          expr.value !== undefined ? this.evalExpr(expr.value, env) : undefined

        for (const arm of expr.arms) {
          if (this.armFires(arm, matched, env)) {
            return this.evalExpr(arm.body, env)
          }
        }

        throw new Error('No match arm fired')
      }
    }
  }

  private armFires(
    arm: MatchArm,
    matched: Value | undefined,
    env: Environment,
  ): boolean {
    let patternMatches: boolean
    if (arm.pattern.kind === 'wildcard') {
      patternMatches = true
    } else {
      const patternValue = this.evalExpr(arm.pattern.expr, env)
      if (matched === undefined) {
        // guard mode: pattern is a boolean condition
        patternMatches = this.isTruthy(patternValue)
      } else {
        // value mode: equality check (same semantics as `==`)
        patternMatches = matched === patternValue
      }
    }

    if (!patternMatches) return false

    if (arm.guard !== undefined) {
      const guardValue = this.evalExpr(arm.guard, env)
      if (!this.isTruthy(guardValue)) return false
    }

    return true
  }

  private toNumber(val: Value): number {
    if (typeof val === 'number') return val
    if (typeof val === 'boolean') return val ? 1 : 0
    throw new Error(`Cannot convert ${typeof val} to number`)
  }

  private isTruthy(val: Value): boolean {
    if (typeof val === 'boolean') return val
    if (typeof val === 'number') return val !== 0
    if (typeof val === 'string') return val.length > 0
    return true
  }
}

function validateParameterOverride(
  name: string,
  value: Value,
  spec: ParameterSpec,
): void {
  // Determine expected type from default kind.
  let expectedType: 'number' | 'boolean' | 'string'
  if (spec.default.kind === 'dice') {
    expectedType = 'number'
  } else {
    const dv = spec.default.value
    if (typeof dv === 'number') expectedType = 'number'
    else if (typeof dv === 'boolean') expectedType = 'boolean'
    else if (typeof dv === 'string') expectedType = 'string'
    else {
      throw new Error(`Parameter $${name} has unsupported default type`)
    }
  }

  const actualType = typeof value
  if (actualType !== expectedType) {
    throw new Error(
      `Type mismatch for parameter $${name}: expected ${expectedType}, got ${actualType}`,
    )
  }

  if (expectedType === 'number') {
    const v = value as number
    if (spec.min !== undefined && v < spec.min) {
      throw new Error(
        `Parameter $${name} out of range: ${v} not in [${spec.min}, ${spec.max ?? ''}]`,
      )
    }
    if (spec.max !== undefined && v > spec.max) {
      throw new Error(
        `Parameter $${name} out of range: ${v} not in [${spec.min ?? ''}, ${spec.max}]`,
      )
    }
  }

  if (spec.enum !== undefined) {
    const found = spec.enum.some((e) => e === value)
    if (!found) {
      throw new Error(
        `Parameter $${name} not in allowed values: ${formatRuntimeValue(value)} not in [${spec.enum.map(formatRuntimeValue).join(', ')}]`,
      )
    }
  }
}

function formatRuntimeValue(v: Value): string {
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}
