import type { Program, Value } from './program'
import type { DiceExpression } from './dice-expression'

export interface Parameter {
  name: string
  default?: Value
  defaultExpr?: DiceExpression
  defaultSource?: string
  label?: string
  description?: string
  min?: number
  max?: number
  enum?: Value[]
}

export const ProgramParameters = {
  list(program: Program): Parameter[] {
    const result: Parameter[] = []
    for (const stmt of program.statements) {
      if (stmt.type !== 'parameter-declaration') continue
      const p: Parameter = { name: stmt.name }
      if (stmt.spec.default.kind === 'value') {
        p.default = stmt.spec.default.value
      } else {
        p.defaultExpr = stmt.spec.default.expr
        p.defaultSource = stmt.spec.default.source
      }
      if (stmt.spec.label !== undefined) p.label = stmt.spec.label
      if (stmt.spec.description !== undefined)
        p.description = stmt.spec.description
      if (stmt.spec.min !== undefined) p.min = stmt.spec.min
      if (stmt.spec.max !== undefined) p.max = stmt.spec.max
      if (stmt.spec.enum !== undefined) p.enum = stmt.spec.enum
      result.push(p)
    }
    return result
  },
}
