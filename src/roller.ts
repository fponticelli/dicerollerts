import {
  type Range,
  type DiceFilter,
  type DiceFunctor,
  type DiceReducer,
  type Roll,
  type DiceExpression,
  type DiceReduce,
  type NDice,
  type NDiceParam,
  type DiceFilterable,
  die,
  customDie,
} from './dice-expression'
import {
  keepResult,
  discardResult,
  rerolled,
  normal,
  exploded,
  compounded,
  diceMapeableResult,
  diceReduceResult,
  diceFilterableResult,
  diceExpressionsResult,
  binaryOpResult,
  literalResult,
  dieResult,
  unaryOpResult,
  customDieResult,
} from './roll-result'
import {
  oneResult,
  type DiceResultMapped,
  type DieResult,
  type DieResultFilter,
  type RollResult,
} from './roll-result'
import { RR } from './roll-result-domain'

function mapNotNull<T, V>(arr: T[], fn: (t: T) => V | null): V[] {
  const result: V[] = []
  for (const t of arr) {
    const v = fn(t)
    if (v !== null) {
      result.push(v)
    }
  }
  return result
}

function compareNumbers(a: number, b: number): number {
  return a - b
}

function median(arr: number[]): number {
  const sorted = arr.slice().sort(compareNumbers)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid] + sorted[mid - 1]) / 2
  } else {
    return sorted[mid]
  }
}

function rank<T>(
  array: T[],
  compare: (a: T, b: T) => number,
  incrementDuplicates = true,
): number[] {
  const arr = array.map((v, i): [T, number] => [v, i])
  arr.sort((a, b) => compare(a[0], b[0]))
  const ranks = new Array<number>(arr.length)
  let rank = 0
  let last = arr[0][0]
  for (let i = 0; i < arr.length; i++) {
    const [v, index] = arr[i]
    if (compare(v, last) !== 0) {
      rank = i
      last = v
    }
    ranks[index] = rank
    if (incrementDuplicates) rank++
  }
  return ranks
}

function pickFurthest(
  first: number,
  second: number,
  furthestValue: number,
  tieBreaker: 'high' | 'low' | 'reroll',
): 'first' | 'second' | 'tie' {
  const firstDistance = Math.abs(first - furthestValue)
  const secondDistance = Math.abs(second - furthestValue)
  if (firstDistance > secondDistance) {
    return 'first'
  } else if (secondDistance > firstDistance) {
    return 'second'
  } else {
    switch (tieBreaker) {
      case 'high':
        return first > second ? 'first' : 'second'
      case 'low':
        return first < second ? 'first' : 'second'
      case 'reroll':
        return 'tie'
    }
  }
}

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

/** Maximum number of dice that can be rolled by a single n-dice expression. */
export const MAX_DICE_COUNT = 10000

export class Roller {
  static matchRange(r: number, range: Range): boolean {
    switch (range.type) {
      case 'exact':
        return compareNumbers(r, range.value) === 0
      case 'between':
        return (
          compareNumbers(r, range.minInclusive) >= 0 &&
          compareNumbers(r, range.maxInclusive) <= 0
        )
      case 'value-or-more':
        return compareNumbers(r, range.value) >= 0
      case 'value-or-less':
        return compareNumbers(r, range.value) <= 0
      case 'composite':
        return range.ranges.some((range) => Roller.matchRange(r, range))
    }
  }

  static filterf(filter: DiceFilter): (res: number, length: number) => boolean {
    switch (filter.type) {
      case 'drop':
        if (filter.dir === 'low') {
          return (res) => res >= filter.value
        } else {
          return (res, length) => res < length - filter.value
        }
      case 'keep':
        if (filter.dir === 'high') {
          return (res, length) => res >= length - filter.value
        } else {
          return (res) => res < filter.value
        }
    }
  }

  readonly options: RollerOptions

  constructor(
    private readonly dieRoll: Roll,
    options?: Partial<RollerOptions>,
    private readonly variables?: Record<string, number>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  private materializeFilterable(filterable: DiceFilterable): RollResult[] {
    switch (filterable.type) {
      case 'filterable-dice-array':
        return filterable.dice.map((d) => this.roll(die(d)))
      case 'filterable-dice-expressions':
        return filterable.exprs.map((expr) => this.roll(expr))
      case 'filterable-homogeneous': {
        const count = this.resolveNDiceParam(filterable.count, 'count')
        const sides = this.resolveNDiceParam(filterable.sides, 'sides')
        if (count > MAX_DICE_COUNT) {
          throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
        }
        if (sides <= 0) {
          throw new Error(`dice sides must be positive, got ${sides}`)
        }
        const rolls: RollResult[] = []
        for (let i = 0; i < count; i++) {
          rolls.push(this.roll(die(sides)))
        }
        return rolls
      }
      case 'filterable-homogeneous-custom': {
        const count = this.resolveNDiceParam(filterable.count, 'count')
        if (count > MAX_DICE_COUNT) {
          throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
        }
        if (filterable.faces.length === 0) {
          throw new Error('custom die must have at least one face')
        }
        const rolls: RollResult[] = []
        const cd = customDie(filterable.faces)
        for (let i = 0; i < count; i++) {
          rolls.push(this.roll(cd))
        }
        return rolls
      }
    }
  }

  private rollDiceReduce(dr: DiceReduce): RollResult {
    if (dr.reduceable.type === 'dice-expressions') {
      const rolls = dr.reduceable.exprs.map((expr) => this.roll(expr))
      const result = this.reduceRolls(rolls, dr.reducer)
      return diceReduceResult(diceExpressionsResult(rolls), dr.reducer, result)
    } else if (dr.reduceable.type === 'homogeneous-dice-expressions') {
      const count = this.resolveNDiceParam(dr.reduceable.count, 'count')
      const sides = this.resolveNDiceParam(dr.reduceable.sides, 'sides')
      if (count > MAX_DICE_COUNT) {
        throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
      }
      if (sides <= 0) {
        throw new Error(`dice sides must be positive, got ${sides}`)
      }
      const rolls: RollResult[] = []
      for (let i = 0; i < count; i++) {
        rolls.push(this.roll(die(sides)))
      }
      const result = this.reduceRolls(rolls, dr.reducer)
      return diceReduceResult(diceExpressionsResult(rolls), dr.reducer, result)
    } else if (dr.reduceable.type === 'homogeneous-custom-dice') {
      const count = this.resolveNDiceParam(dr.reduceable.count, 'count')
      if (count > MAX_DICE_COUNT) {
        throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
      }
      if (dr.reduceable.faces.length === 0) {
        throw new Error('custom die must have at least one face')
      }
      const rolls: RollResult[] = []
      const cd = customDie(dr.reduceable.faces)
      for (let i = 0; i < count; i++) {
        rolls.push(this.roll(cd))
      }
      const result = this.reduceRolls(rolls, dr.reducer)
      return diceReduceResult(diceExpressionsResult(rolls), dr.reducer, result)
    } else if (dr.reduceable.type === 'dice-list-with-filter') {
      const rolls = this.materializeFilterable(dr.reduceable.list)
      const filteredRolls = this.filterRolls(rolls, dr.reduceable.filter)
      const keepFilteredRolls = this.keepFilteredRolls(filteredRolls)
      const result = this.reduceRolls(keepFilteredRolls, dr.reducer)
      return diceReduceResult(
        diceFilterableResult(filteredRolls, dr.reduceable.filter),
        dr.reducer,
        result,
      )
    } else if (dr.reduceable.type === 'dice-list-with-map') {
      const rolls = dr.reduceable.dice.map((d) => {
        const roll = this.roll(die(d))
        if (roll.type === 'one-result') {
          if (roll.die.type !== 'die-result') {
            throw new Error(`Expected die result, got ${JSON.stringify(roll)}`)
          }
          return roll.die
        } else {
          throw new Error(`Expected die result, got ${JSON.stringify(roll)}`)
        }
      })
      const mapped = this.mapRolls(rolls, dr.reduceable.functor)
      const keepMappedRolls = this.keepMappedRolls(mapped)
      const result = this.reduceRolls(
        keepMappedRolls.map(oneResult),
        dr.reducer,
      )
      return diceReduceResult(
        diceMapeableResult(mapped, dr.reduceable.functor),
        dr.reducer,
        result,
      )
    } else if (dr.reduceable.type === 'dice-list-with-map-homogeneous') {
      const count = this.resolveNDiceParam(dr.reduceable.count, 'count')
      const sides = this.resolveNDiceParam(dr.reduceable.sides, 'sides')
      if (count > MAX_DICE_COUNT) {
        throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
      }
      if (sides <= 0) {
        throw new Error(`dice sides must be positive, got ${sides}`)
      }
      const rolls = []
      for (let i = 0; i < count; i++) {
        const roll = this.roll(die(sides))
        if (roll.type !== 'one-result' || roll.die.type !== 'die-result') {
          throw new Error(`Expected die result, got ${JSON.stringify(roll)}`)
        }
        rolls.push(roll.die)
      }
      const mapped = this.mapRolls(rolls, dr.reduceable.functor)
      const keepMappedRolls = this.keepMappedRolls(mapped)
      const result = this.reduceRolls(
        keepMappedRolls.map(oneResult),
        dr.reducer,
      )
      return diceReduceResult(
        diceMapeableResult(mapped, dr.reduceable.functor),
        dr.reducer,
        result,
      )
    } else {
      throw new Error(`Unknown DiceReduce: ${JSON.stringify(dr)}`)
    }
  }

  roll(expr: DiceExpression): RollResult {
    if (expr.type === 'die') {
      return oneResult(dieResult(this.dieRoll(expr.sides), expr.sides))
    } else if (expr.type === 'custom-die') {
      const index = this.dieRoll(expr.faces.length)
      return oneResult(customDieResult(expr.faces[index - 1], expr.faces))
    } else if (expr.type === 'literal') {
      return literalResult(expr.value, expr.value)
    } else if (expr.type === 'dice-reduce') {
      return this.rollDiceReduce(expr)
    } else if (expr.type === 'binary-op') {
      const left = this.roll(expr.left)
      const right = this.roll(expr.right)
      if (expr.op === 'sum') {
        return binaryOpResult(
          'sum',
          left,
          right,
          RR.getResult(left) + RR.getResult(right),
        )
      } else if (expr.op === 'difference') {
        return binaryOpResult(
          'difference',
          left,
          right,
          RR.getResult(left) - RR.getResult(right),
        )
      } else if (expr.op === 'multiplication') {
        return binaryOpResult(
          'multiplication',
          left,
          right,
          RR.getResult(left) * RR.getResult(right),
        )
      } else if (expr.op === 'division') {
        return binaryOpResult(
          'division',
          left,
          right,
          Math.trunc(RR.getResult(left) / RR.getResult(right)),
        )
      } else {
        throw new Error(`Invalid binary operation ${JSON.stringify(expr)}`)
      }
    } else if (expr.type === 'unary-op') {
      const inner = this.roll(expr.expr)
      if (expr.op === 'negate') {
        return unaryOpResult('negate', inner, -RR.getResult(inner))
      } else {
        throw new Error(`Invalid unary operation ${JSON.stringify(expr)}`)
      }
    } else if (expr.type === 'dice-variable-ref') {
      const value = this.variables?.[expr.name]
      if (value === undefined) {
        throw new Error(`Undefined variable: $${expr.name}`)
      }
      return literalResult(value, value)
    } else if (expr.type === 'n-dice') {
      return this.rollNDice(expr)
    } else {
      throw new Error(`Invalid expressions ${JSON.stringify(expr)}`)
    }
  }

  private resolveNDiceParam(p: NDiceParam, role: 'count' | 'sides'): number {
    if (p.kind === 'literal') return p.value
    const value = this.variables?.[p.name]
    if (value === undefined) {
      throw new Error(`Undefined variable: $${p.name}`)
    }
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(
        `Variable $${p.name} must be an integer for dice ${role}, got ${value}`,
      )
    }
    return value
  }

  private rollNDice(expr: NDice): RollResult {
    const count = this.resolveNDiceParam(expr.count, 'count')
    const sides = this.resolveNDiceParam(expr.sides, 'sides')
    if (count > MAX_DICE_COUNT) {
      throw new Error(`dice count exceeds maximum (${MAX_DICE_COUNT})`)
    }
    if (count <= 0) {
      // No dice rolled. Mirror "0 + ... " by returning a dice-reduce-result
      // of an empty dice-expressions sum.
      return diceReduceResult(diceExpressionsResult([]), 'sum', 0)
    }
    if (sides <= 0) {
      throw new Error(`dice sides must be positive, got ${sides}`)
    }
    const rolls: RollResult[] = []
    let total = 0
    for (let i = 0; i < count; i++) {
      const r = this.dieRoll(sides)
      rolls.push(oneResult(dieResult(r, sides)))
      total += r
    }
    return diceReduceResult(diceExpressionsResult(rolls), 'sum', total)
  }

  mapRolls(rolls: DieResult[], functor: DiceFunctor): DiceResultMapped[] {
    if (functor.type === 'emphasis') {
      return rolls.map((roll) =>
        this.emphasisRoll(roll, functor.furthestFrom, functor.tieBreaker),
      )
    }
    if (functor.type === 'compound') {
      const limit =
        functor.times.type === 'always'
          ? this.options.maxExplodeIterations
          : functor.times.value
      return rolls.map((roll) => this.compoundRoll(roll, limit, functor.range))
    }
    const times = functor.times
    switch (functor.type) {
      case 'explode':
        if (times.type === 'always') {
          return rolls.map((roll) =>
            this.explodeRoll(
              roll,
              this.options.maxExplodeIterations,
              functor.range,
            ),
          )
        } else {
          return rolls.map((roll) =>
            this.explodeRoll(roll, times.value, functor.range),
          )
        }
      case 'reroll':
        if (times.type === 'always') {
          return rolls.map((roll) =>
            this.rerollRoll(
              roll,
              this.options.maxRerollIterations,
              functor.range,
            ),
          )
        } else {
          return rolls.map((roll) =>
            this.rerollRoll(roll, times.value, functor.range),
          )
        }
    }
  }

  compoundRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
    const rolls = [roll]
    let total = roll.result
    let curr = roll
    let remaining = times
    while (remaining > 0 && Roller.matchRange(curr.result, range)) {
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

  emphasisRoll(
    roll: DieResult,
    furthestFrom: number | 'average',
    tieBreaker: 'low' | 'high' | 'reroll',
  ): DiceResultMapped {
    let rolls = [roll.result, this.dieRoll(roll.sides)]
    const furthestValue =
      furthestFrom === 'average' ? Math.floor(roll.sides / 2) : furthestFrom
    let result = pickFurthest(rolls[0], rolls[1], furthestValue, tieBreaker)
    for (let i = 0; i < this.options.maxEmphasisIterations; i++) {
      if (result !== 'tie') {
        break
      }
      rolls = [this.dieRoll(roll.sides), this.dieRoll(roll.sides)]
      result = pickFurthest(rolls[0], rolls[1], furthestValue, tieBreaker)
    }
    if (result === 'first') {
      return rerolled([
        dieResult(rolls[1], roll.sides),
        dieResult(rolls[0], roll.sides),
      ])
    } else {
      return rerolled([
        dieResult(rolls[0], roll.sides),
        dieResult(rolls[1], roll.sides),
      ])
    }
  }

  explodeRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
    const limit = times === -1 ? this.options.maxExplodeIterations : times
    const acc = this.rollRange(roll, limit, range)
    return acc.length === 1 ? normal(acc[0]) : exploded(acc)
  }

  rerollRoll(roll: DieResult, times: number, range: Range): DiceResultMapped {
    const limit = times === -1 ? this.options.maxRerollIterations : times
    const acc = this.rollRange(roll, limit, range)
    return acc.length === 1 ? normal(acc[0]) : rerolled(acc)
  }

  rollRange(roll: DieResult, times: number, range: Range): DieResult[] {
    const acc = [roll]
    let curr = roll
    while (times !== 0 && Roller.matchRange(curr.result, range)) {
      curr = dieResult(this.dieRoll(curr.sides), curr.sides)
      acc.push(curr)
      times--
    }
    return acc
  }

  keepMappedRolls(rolls: DiceResultMapped[]): DieResult[] {
    return rolls.flatMap((roll) => {
      switch (roll.type) {
        case 'normal':
          return [roll.roll]
        case 'rerolled':
          return [roll.rerolls[roll.rerolls.length - 1]]
        case 'exploded':
          return roll.explosions
        case 'compounded':
          return [dieResult(roll.total, roll.rolls[0].sides)]
        default:
          throw new Error(`Invalid mapped roll ${JSON.stringify(roll)}`)
      }
    })
  }

  filterRolls(rolls: RollResult[], filter: DiceFilter): DieResultFilter[] {
    const ranked = rank(rolls, (a, b) => {
      return compareNumbers(RR.getResult(a), RR.getResult(b))
    })
    const f = Roller.filterf(filter)
    return rolls.map((roll, i) => {
      if (f(ranked[i], ranked.length)) {
        return keepResult(roll)
      } else {
        return discardResult(roll)
      }
    })
  }

  keepFilteredRolls(rolls: DieResultFilter[]): RollResult[] {
    return mapNotNull(rolls, (roll) => {
      if (roll.type === 'keep-result') {
        return roll.roll
      } else {
        return null
      }
    })
  }

  reduceRolls(rolls: RollResult[], reducer: DiceReducer): number {
    return this.reduceResults(this.getRollResults(rolls), reducer)
  }

  reduceResults(results: number[], reducer: DiceReducer): number {
    if (typeof reducer === 'object' && reducer.type === 'count') {
      // Each die contributes 1 success per matching threshold. For the common
      // single-threshold case this collapses to "count dice that match".
      let total = 0
      for (const r of results) {
        for (const t of reducer.thresholds) {
          if (Roller.matchRange(r, t)) total++
        }
      }
      return total
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
      default:
        throw new Error(`Unknown reducer: ${JSON.stringify(reducer)}`)
    }
  }

  getRollResults(rolls: RollResult[]): number[] {
    return rolls.map(RR.getResult)
  }
}
