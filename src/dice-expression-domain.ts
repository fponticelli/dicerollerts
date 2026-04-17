import {
  type DiceReducer,
  type DiceBinOp,
  type DiceExpression,
  type DiceFunctor,
  type DiceListWithFilter,
  type DiceReduce,
  type DiceReduceable,
  type DiceUnOp,
  type NDice,
  type NDiceParam,
  type Range,
  type Sides,
  type Times,
  type ValidationMessage,
  type DiceFilter,
  insufficientSides,
  emptySet,
  tooManyDrops,
  tooManyKeeps,
  dropOrKeepShouldBePositive,
  emptyFaces,
  literal,
  unaryOp,
  binaryOp,
} from './dice-expression'
import { Roller } from './roller'

function distinctPrimitive<T>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

function nDiceCountToString(p: NDiceParam): string {
  return p.kind === 'literal' ? String(p.value) : `$${p.name}`
}

function homogeneousHeadToString(count: NDiceParam, sides: NDiceParam): string {
  // All-literal -> use lowercase 'd' to match standard dice notation
  // (e.g. `3d6`, `d%`). Otherwise uppercase 'D' to indicate parametric form.
  if (count.kind === 'literal' && sides.kind === 'literal') {
    return DE.diceToString(count.value, sides.value)
  }
  return `${nDiceCountToString(count)}D${nDiceCountToString(sides)}`
}

function homogeneousCustomHeadToString(
  count: NDiceParam,
  faces: number[],
): string {
  const dieStr = customDieToString(faces)
  if (count.kind === 'literal') {
    return count.value === 1 ? dieStr : `${count.value}${dieStr}`
  }
  // Parametric: render `dF` -> `$nameDF` (uppercase D for parametric form).
  // For `d{...}`, render as `$nameD{...}`.
  const sidesPart = dieStr.startsWith('d') ? 'D' + dieStr.slice(1) : dieStr
  return `$${count.name}${sidesPart}`
}

function diceListWithFilterToString(dlwf: DiceListWithFilter): string {
  if (dlwf.list.type === 'filterable-dice-array') {
    return DE.sidesToString(dlwf.list.dice) + DE.diceFilterToString(dlwf.filter)
  } else if (dlwf.list.type === 'filterable-dice-expressions') {
    return (
      DE.expressionsToString(dlwf.list.exprs) +
      DE.diceFilterToString(dlwf.filter)
    )
  } else if (dlwf.list.type === 'filterable-homogeneous') {
    return (
      homogeneousHeadToString(dlwf.list.count, dlwf.list.sides) +
      DE.diceFilterToString(dlwf.filter)
    )
  } else if (dlwf.list.type === 'filterable-homogeneous-custom') {
    return (
      homogeneousCustomHeadToString(dlwf.list.count, dlwf.list.faces) +
      DE.diceFilterToString(dlwf.filter)
    )
  } else {
    throw new Error(`Unknown filterable: ${String(dlwf)}`)
  }
}

function diceReduceToString(dr: DiceReduce): string {
  if (dr.reduceable.type === 'dice-expressions') {
    return DE.expressionsToString(dr.reduceable.exprs)
  } else if (dr.reduceable.type === 'dice-list-with-filter') {
    return diceListWithFilterToString(dr.reduceable)
  } else if (dr.reduceable.type === 'dice-list-with-map') {
    return DE.diceBagToString(dr.reduceable.dice, dr.reduceable.functor)
  } else if (dr.reduceable.type === 'dice-list-with-map-homogeneous') {
    return DE.diceBagHomogeneousToString(
      dr.reduceable.count,
      dr.reduceable.sides,
      dr.reduceable.functor,
    )
  } else if (dr.reduceable.type === 'homogeneous-dice-expressions') {
    return homogeneousHeadToString(dr.reduceable.count, dr.reduceable.sides)
  } else if (dr.reduceable.type === 'homogeneous-custom-dice') {
    return homogeneousCustomHeadToString(
      dr.reduceable.count,
      dr.reduceable.faces,
    )
  } else {
    throw new Error(`Unknown reduceable: ${String(dr)}`)
  }
}

function customDieToString(faces: number[]): string {
  if (
    faces.length === 3 &&
    faces[0] === -1 &&
    faces[1] === 0 &&
    faces[2] === 1
  ) {
    return 'dF'
  }
  return `d{${faces.join(',')}}`
}

function binOpToString(op: DiceBinOp): string {
  switch (op) {
    case 'sum':
      return '+'
    case 'difference':
      return '-'
    case 'multiplication':
      return '*'
    case 'division':
      return '/'
  }
}

function unaryOpToString(op: DiceUnOp): string {
  switch (op) {
    case 'negate':
      return '-'
  }
}

function nDiceToString(expr: NDice): string {
  return homogeneousHeadToString(expr.count, expr.sides)
}

export const DE = {
  toString(expr: DiceExpression): string {
    if (expr.type === 'literal') {
      return String(expr.value)
    } else if (expr.type === 'die') {
      return DE.diceToString(1, expr.sides)
    } else if (expr.type === 'custom-die') {
      return customDieToString(expr.faces)
    } else if (expr.type === 'dice-reduce') {
      return (
        diceReduceToString(expr) + DE.expressionExtractorToString(expr.reducer)
      )
    } else if (expr.type === 'binary-op') {
      return `${DE.toString(expr.left)} ${binOpToString(expr.op)} ${DE.toString(expr.right)}`
    } else if (expr.type === 'unary-op') {
      return `${unaryOpToString(expr.op)}${DE.toString(expr.expr)}`
    } else if (expr.type === 'dice-variable-ref') {
      return `$${expr.name}`
    } else if (expr.type === 'n-dice') {
      return nDiceToString(expr)
    } else {
      throw new Error(`Unknown expression type: ${String(expr)}`)
    }
  },

  diceToString(times: number, sides: number): string {
    if (times === 1 && sides === 100) {
      return 'd%'
    } else if (times === 1) {
      return `d${sides}`
    } else if (sides === 100) {
      return `${times}d%`
    } else {
      return `${times}d${sides}`
    }
  },

  diceBagToString(dice: Sides[], functor: DiceFunctor): string {
    return DE.diceBagSuffix(DE.sidesToString(dice), functor)
  },

  diceBagHomogeneousToString(
    count: NDiceParam,
    sides: NDiceParam,
    functor: DiceFunctor,
  ): string {
    const head = homogeneousHeadToString(count, sides)
    return DE.diceBagSuffix(head, functor)
  },

  diceBagSuffix(head: string, functor: DiceFunctor): string {
    if (functor.type === 'emphasis') {
      const suffix = ((): string[] => {
        switch (functor.furthestFrom) {
          case 'average':
            return ['emphasis']
          default:
            return ['furthest from', String(functor.furthestFrom)]
        }
      })()
      if (functor.tieBreaker === 'high') {
        suffix.push('high')
      } else if (functor.tieBreaker === 'low') {
        suffix.push('low')
      }
      return `${head} ${suffix.join(' ')}`
    }
    const suffix = (() => {
      switch (functor.type) {
        case 'explode':
          return ['explode']
        case 'reroll':
          return ['reroll']
        case 'compound':
          return ['compound']
      }
    })()
      .concat(
        [
          DE.timesToString(functor.times),
          DE.rangeToString(functor.range),
        ].filter((x) => x !== ''),
      )
      .join(' ')
    return `${head} ${suffix}`
  },

  sidesToString(dice: Sides[]): string {
    if (distinctPrimitive(dice).length === 1) {
      return DE.diceToString(dice.length, dice[0])
    } else {
      const s = dice.map((d) => DE.diceToString(1, d)).join(',')
      return `(${s})`
    }
  },

  timesToString(times: Times): string {
    if (times.type === 'always') {
      return ''
    } else if (times.value === 1) {
      return 'once'
    } else if (times.value === 2) {
      return 'twice'
    } else {
      return `${times.value} times`
    }
  },

  rangeToString(range: Range): string {
    switch (range.type) {
      case 'exact':
        return `on ${range.value}`
      case 'between':
        return `${range.minInclusive}...${range.maxInclusive}`
      case 'composite':
        return `(${range.ranges.map(DE.rangeToString).join(',')})`
      case 'value-or-less':
        return `on ${range.value} or less`
      case 'value-or-more':
        return `on ${range.value} or more`
    }
  },

  expressionsToString(exprs: DiceExpression[]): string {
    if (DE.allOneDieSameSides(exprs)) {
      return (
        (exprs.length > 1 ? String(exprs.length) : '') + DE.toString(exprs[0])
      )
    } else if (exprs.length === 1 && !DE.needsBraces(exprs[0])) {
      return exprs.map(DE.toString).join(',')
    } else {
      return `(${exprs.map(DE.toString).join(',')})`
    }
  },

  allOneDieSameSides(exprs: DiceExpression[]) {
    if (exprs.length === 0) return false
    const first = exprs[0]
    if (first.type === 'die') {
      for (const expr of exprs) {
        if (expr.type !== 'die' || expr.sides !== first.sides) return false
      }
      return true
    } else if (first.type === 'custom-die') {
      for (const expr of exprs) {
        if (
          expr.type !== 'custom-die' ||
          expr.faces.length !== first.faces.length ||
          expr.faces.some((f, i) => f !== first.faces[i])
        ) {
          return false
        }
      }
      return true
    }
    return false
  },

  expressionExtractorToString(reducer: DiceReducer): string {
    if (typeof reducer === 'object' && reducer.type === 'count') {
      const parts = reducer.thresholds.map(DE.countThresholdToString)
      return ` count ${parts.join(' and ')}`
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
      default:
        throw new Error(`Unknown reducer: ${JSON.stringify(reducer)}`)
    }
  },

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

  diceFilterToString(filter: DiceFilter): string {
    if (filter.type === 'drop') {
      if (filter.dir === 'low') {
        return ` drop ${filter.value}`
      } else {
        return ` drop highest ${filter.value}`
      }
    } else {
      if (filter.dir === 'high') {
        return ` keep ${filter.value}`
      } else {
        return ` keep lowest ${filter.value}`
      }
    }
  },

  needsBraces(expr: DiceExpression): boolean {
    return expr.type === 'binary-op'
  },

  calculateBasicRollsReduceable(dr: DiceReduceable): number {
    switch (dr.type) {
      case 'dice-expressions':
        return dr.exprs.reduce(
          (acc, expr) => acc + DE.calculateBasicRolls(expr),
          0,
        )
      case 'dice-list-with-filter': {
        const list = dr.list
        switch (list.type) {
          case 'filterable-dice-array':
            return list.dice.length
          case 'filterable-dice-expressions':
            return list.exprs.reduce(
              (acc, expr) => acc + DE.calculateBasicRolls(expr),
              0,
            )
          case 'filterable-homogeneous':
          case 'filterable-homogeneous-custom':
            return list.count.kind === 'literal' ? list.count.value : 1
        }
        return 0
      }
      case 'dice-list-with-map':
        return dr.dice.length
      case 'dice-list-with-map-homogeneous':
      case 'homogeneous-dice-expressions':
      case 'homogeneous-custom-dice':
        return dr.count.kind === 'literal' ? dr.count.value : 1
    }
  },

  calculateBasicRolls(expr: DiceExpression): number {
    switch (expr.type) {
      case 'die':
        return 1
      case 'custom-die':
        return 1
      case 'literal':
        return 1
      case 'binary-op':
        return (
          DE.calculateBasicRolls(expr.left) + DE.calculateBasicRolls(expr.right)
        )
      case 'unary-op':
        return DE.calculateBasicRolls(expr.expr)
      case 'dice-reduce':
        return DE.calculateBasicRollsReduceable(expr.reduceable)
      case 'dice-variable-ref':
        return 0
      case 'n-dice':
        // Literal count contributes that many rolls; variable count is unknown
        // until evaluation, so contribute a conservative 1.
        return expr.count.kind === 'literal' ? expr.count.value : 1
    }
  },

  validateExpr(expr: DiceExpression): ValidationMessage[] {
    switch (expr.type) {
      case 'die':
        if (expr.sides <= 0) {
          return [insufficientSides(expr.sides)]
        } else {
          return []
        }
      case 'custom-die':
        if (expr.faces.length === 0) {
          return [emptyFaces()]
        } else {
          return []
        }
      case 'literal':
        return []
      case 'binary-op':
        return DE.validateExpr(expr.left).concat(DE.validateExpr(expr.right))
      case 'unary-op':
        return DE.validateExpr(expr.expr)
      case 'dice-reduce':
        return DE.validateDiceReduceable(expr.reduceable)
      case 'dice-variable-ref':
        return []
      case 'n-dice': {
        const errors: ValidationMessage[] = []
        if (expr.sides.kind === 'literal' && expr.sides.value <= 0) {
          errors.push(insufficientSides(expr.sides.value))
        }
        // Note: literal count <= 0 is allowed at validation time (returns 0
        // when rolled). Variable count/sides validate at runtime.
        return errors
      }
    }
  },

  validateDiceReduceable(dr: DiceReduceable): ValidationMessage[] {
    switch (dr.type) {
      case 'dice-expressions':
        if (dr.exprs.length === 0) {
          return [emptySet()]
        } else {
          return dr.exprs.reduce(
            (acc: ValidationMessage[], expr) =>
              acc.concat(DE.validateExpr(expr)),
            [],
          )
        }
      case 'dice-list-with-map': {
        const acc = dr.dice.reduce((acc: ValidationMessage[], sides) => {
          if (sides > 0) return acc
          else return acc.concat([insufficientSides(sides)])
        }, [])
        return acc.concat(
          dr.dice.map((v) => DE.checkFunctor(v, dr.functor)).flat(),
        )
      }
      case 'dice-list-with-map-homogeneous': {
        const acc: ValidationMessage[] = []
        if (dr.sides.kind === 'literal') {
          if (dr.sides.value <= 0) {
            acc.push(insufficientSides(dr.sides.value))
          } else {
            acc.push(...DE.checkFunctor(dr.sides.value, dr.functor))
          }
        }
        return acc
      }
      case 'homogeneous-dice-expressions': {
        const acc: ValidationMessage[] = []
        if (dr.sides.kind === 'literal' && dr.sides.value <= 0) {
          acc.push(insufficientSides(dr.sides.value))
        }
        return acc
      }
      case 'homogeneous-custom-dice': {
        const acc: ValidationMessage[] = []
        if (dr.faces.length === 0) acc.push(emptyFaces())
        return acc
      }
      case 'dice-list-with-filter': {
        const acc: ValidationMessage[] = []
        const list = dr.list
        let len: number | null
        switch (list.type) {
          case 'filterable-dice-array':
            len = list.dice.length
            break
          case 'filterable-dice-expressions':
            len = list.exprs.length
            break
          case 'filterable-homogeneous':
          case 'filterable-homogeneous-custom':
            // Variable count not known until evaluation; skip too-many checks.
            len = list.count.kind === 'literal' ? list.count.value : null
            if (list.type === 'filterable-homogeneous-custom') {
              if (list.faces.length === 0) acc.push(emptyFaces())
            } else if (list.sides.kind === 'literal' && list.sides.value <= 0) {
              acc.push(insufficientSides(list.sides.value))
            }
            break
        }
        if (dr.filter.value < 1) {
          acc.push(dropOrKeepShouldBePositive())
        } else if (len !== null) {
          if (dr.filter.type === 'drop' && dr.filter.value >= len) {
            acc.push(tooManyDrops(len, dr.filter.value))
          } else if (dr.filter.type === 'keep' && dr.filter.value > len) {
            acc.push(tooManyKeeps(len, dr.filter.value))
          }
        }
        return acc
      }
    }
  },

  alwaysInRange(sides: number, range: Range): boolean {
    for (let i = 1; i <= sides + 1; i++) {
      if (!Roller.matchRange(i, range)) {
        return false
      }
    }
    return true
  },

  checkFunctor(sides: number, df: DiceFunctor): ValidationMessage[] {
    if (
      (df.type === 'explode' ||
        df.type === 'reroll' ||
        df.type === 'compound') &&
      DE.alwaysInRange(sides, df.range)
    ) {
      return [{ type: 'infinite-reroll', sides, range: df.range }]
    } else {
      return []
    }
  },

  validate(expr: DiceExpression): null | ValidationMessage[] {
    const list = DE.validateExpr(expr)
    if (list.length > 0) {
      return list
    } else {
      return null
    }
  },

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
      case 'dice-variable-ref':
        return expr
      case 'n-dice':
        return expr
    }
  },
}
