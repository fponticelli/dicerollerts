import { type Range, type DiceFilter, type DiceFunctor, type DiceReducer, type Roll, type DiceExpression, type DiceReduce, die } from './dice-expression'
import { keepResult, discardResult, rerolled, normal, exploded, diceMapeableResult, diceReduceResult, diceFilterableResult, diceExpressionsResult, binaryOpResult, literalResult, dieResult, unaryOpResult } from './roll-result'
import { oneResult, type DiceResultMapped, type DieResult, type DieResultFilter, type RollResult } from './roll-result'
import { RR } from './roll-result-domain'

function mapNotNull<T, V> (arr: T[], fn: (t: T) => V | null): V[] {
  const result: V[] = []
  for (const t of arr) {
    const v = fn(t)
    if (v !== null) {
      result.push(v)
    }
  }
  return result
}

function compareNumbers (a: number, b: number): number {
  return a - b
}

function median (arr: number[]): number {
  const sorted = arr.slice().sort(compareNumbers)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid] + sorted[mid - 1]) / 2
  } else {
    return sorted[mid]
  }
}

function rank<T> (array: T[], compare: (a: T, b: T) => number, incrementDuplicates = true): number[] {
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

export class Roller {
  static matchRange (r: number, range: Range): boolean {
    switch (range.type) {
      case 'exact':
        return compareNumbers(r, range.value) === 0
      case 'between':
        return compareNumbers(r, range.minInclusive) >= 0 && compareNumbers(r, range.maxInclusive) <= 0
      case 'value-or-more':
        return compareNumbers(r, range.value) >= 0
      case 'value-or-less':
        return compareNumbers(r, range.value) <= 0
      case 'composite':
        return range.ranges.some(range => Roller.matchRange(r, range))
    }
  }

  static filterf (filter: DiceFilter): (res: number, length: number) => boolean {
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

  constructor (private readonly dieRoll: Roll) { }

  private rollDiceReduce (dr: DiceReduce): RollResult {
    if (dr.reduceable.type === 'dice-expressions') {
      const rolls = dr.reduceable.exprs.map(expr => this.roll(expr))
      const result = this.reduceRolls(rolls, dr.reducer)
      return diceReduceResult(diceExpressionsResult(rolls), dr.reducer, result)
    } else if (dr.reduceable.type === 'dice-list-with-filter') {
      if (dr.reduceable.list.type === 'filterable-dice-array') {
        const rolls = dr.reduceable.list.dice.map(d => this.roll(die(d)))
        const filteredRolls = this.filterRolls(rolls, dr.reduceable.filter)
        const keepFilteredRolls = this.keepFilteredRolls(filteredRolls)
        const result = this.reduceRolls(keepFilteredRolls, dr.reducer)
        return diceReduceResult(diceFilterableResult(filteredRolls, dr.reduceable.filter), dr.reducer, result)
      } else if (dr.reduceable.list.type === 'filterable-dice-expressions') {
        const rolls = dr.reduceable.list.exprs.map(expr => this.roll(expr))
        const filteredRolls = this.filterRolls(rolls, dr.reduceable.filter)
        const keepFilteredRolls = this.keepFilteredRolls(filteredRolls)
        const result = this.reduceRolls(keepFilteredRolls, dr.reducer)
        return diceReduceResult(diceFilterableResult(filteredRolls, dr.reduceable.filter), dr.reducer, result)
      } else {
        throw new Error(`Unknown filterable: ${JSON.stringify(dr)}`)
      }
    } else if (dr.reduceable.type === 'dice-list-with-map') {
      const rolls = dr.reduceable.dice.map(d => {
        const roll = this.roll(die(d))
        if (roll.type === 'one-result') {
          return roll.die
        } else {
          throw new Error(`Expected die result, got ${JSON.stringify(roll)}`)
        }
      })
      const mapped = this.mapRolls(rolls, dr.reduceable.functor)
      const keepMappedRolls = this.keepMappedRolls(mapped)
      const result = this.reduceRolls(keepMappedRolls.map(oneResult), dr.reducer)
      return diceReduceResult(diceMapeableResult(mapped, dr.reduceable.functor), dr.reducer, result)
    } else {
      throw new Error(`Unknown DiceReduce: ${JSON.stringify(dr)}`)
    }
  }

  roll (expr: DiceExpression): RollResult {
    if (expr.type === 'die') {
      return oneResult(dieResult(this.dieRoll(expr.sides), expr.sides))
    } else if (expr.type === 'literal') {
      return literalResult(expr.value, expr.value)
    } else if (expr.type === 'dice-reduce') {
      return this.rollDiceReduce(expr)
    } else if (expr.type === 'binary-op') {
      const left = this.roll(expr.left)
      const right = this.roll(expr.right)
      if (expr.op === 'sum') {
        return binaryOpResult('sum', left, right, RR.getResult(left) + RR.getResult(right))
      } else if (expr.op === 'difference') {
        return binaryOpResult('difference', left, right, RR.getResult(left) - RR.getResult(right))
      } else if (expr.op === 'multiplication') {
        return binaryOpResult('multiplication', left, right, RR.getResult(left) * RR.getResult(right))
      } else if (expr.op === 'division') {
        return binaryOpResult('division', left, right, Math.trunc(RR.getResult(left) / RR.getResult(right)))
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
    } else {
      throw new Error(`Invalid expressions ${JSON.stringify(expr)}`)
    }
  }

  mapRolls (rolls: DieResult[], functor: DiceFunctor): DiceResultMapped[] {
    const times = functor.times
    switch (functor.type) {
      case 'explode':
        if (times.type === 'always') {
          return rolls.map(roll => this.explodeRoll(roll, -1, functor.range))
        } else {
          return rolls.map(roll => this.explodeRoll(roll, times.value, functor.range))
        }
      case 'reroll':
        if (times.type === 'always') {
          return rolls.map(roll => this.rerollRoll(roll, -1, functor.range))
        } else {
          return rolls.map(roll => this.rerollRoll(roll, times.value, functor.range))
        }
    }
  }

  explodeRoll (roll: DieResult, times: number, range: Range): DiceResultMapped {
    const acc = this.rollRange(roll, times, range)
    return acc.length === 1 ? normal(acc[0]) : exploded(acc)
  }

  rerollRoll (roll: DieResult, times: number, range: Range): DiceResultMapped {
    const acc = this.rollRange(roll, times, range)
    return acc.length === 1 ? normal(acc[0]) : rerolled(acc)
  }

  rollRange (roll: DieResult, times: number, range: Range): DieResult[] {
    const acc = [roll]
    let curr = roll
    while (times !== 0 && Roller.matchRange(curr.result, range)) {
      curr = dieResult(this.dieRoll(curr.sides), curr.sides)
      acc.push(curr)
      times--
    }
    return acc
  }

  keepMappedRolls (rolls: DiceResultMapped[]): DieResult[] {
    return rolls.flatMap(roll => {
      switch (roll.type) {
        case 'normal': return [roll.roll]
        case 'rerolled': return [roll.rerolls[roll.rerolls.length - 1]]
        case 'exploded': return roll.explosions
        default: throw new Error(`Invalid mapped roll ${JSON.stringify(roll)}`)
      }
    })
  }

  filterRolls (rolls: RollResult[], filter: DiceFilter): DieResultFilter[] {
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

  keepFilteredRolls (rolls: DieResultFilter[]): RollResult[] {
    return mapNotNull(rolls, (roll) => {
      if (roll.type === 'keep-result') {
        return roll.roll
      } else {
        return null
      }
    })
  }

  reduceRolls (rolls: RollResult[], reducer: DiceReducer): number {
    return this.reduceResults(this.getRollResults(rolls), reducer)
  }

  reduceResults (results: number[], reducer: DiceReducer): number {
    switch (reducer) {
      case 'average': return Math.round(results.reduce((a, b) => a + b, 0) / results.length)
      case 'median': return median(results)
      case 'sum': return results.reduce((a, b) => a + b, 0)
      case 'min': return Math.min(...results)
      case 'max': return Math.max(...results)
    }
  }

  getRollResults (rolls: RollResult[]): number[] {
    return rolls.map(RR.getResult)
  }
}
