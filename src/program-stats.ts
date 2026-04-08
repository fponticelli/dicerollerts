import type { Program, Value } from './program'
import { Evaluator } from './evaluator'

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
      const rollFn = (max: number) => Math.floor(Math.random() * max) + 1
      const evaluator = new Evaluator(rollFn)
      results.push(evaluator.run(program))
    }

    return buildStats(results)
  },
}

function buildStats(values: Value[]): FieldStats {
  if (values.length === 0) return { type: 'mixed' }

  const first = values[0]
  const firstType = typeOf(first)

  // Check for mixed types
  for (const v of values) {
    if (typeOf(v) !== firstType) return { type: 'mixed' }
  }

  if (firstType === 'number') {
    return buildNumberStats(values as number[])
  }

  if (firstType === 'boolean') {
    return buildBooleanStats(values as boolean[])
  }

  if (firstType === 'string') {
    return buildStringStats(values as string[])
  }

  if (firstType === 'array') {
    return buildArrayStats(values as Value[][])
  }

  if (firstType === 'record') {
    return buildRecordStats(values as Record<string, Value>[])
  }

  return { type: 'mixed' }
}

function typeOf(value: Value): string {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  return 'record'
}

function buildNumberStats(values: number[]): FieldStats {
  const n = values.length
  let sum = 0
  let min = values[0]
  let max = values[0]
  const counts = new Map<number, number>()

  for (const v of values) {
    sum += v
    if (v < min) min = v
    if (v > max) max = v
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  const mean = sum / n

  let variance = 0
  for (const v of values) {
    variance += (v - mean) ** 2
  }
  const stddev = Math.sqrt(variance / n)

  const distribution = new Map<number, number>()
  for (const [k, count] of counts) {
    distribution.set(k, count / n)
  }

  return { type: 'number', mean, stddev, min, max, distribution }
}

function buildBooleanStats(values: boolean[]): FieldStats {
  const trueCount = values.filter((v) => v).length
  return { type: 'boolean', truePercent: trueCount / values.length }
}

function buildStringStats(values: string[]): FieldStats {
  const counts = new Map<string, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const frequencies = new Map<string, number>()
  for (const [k, count] of counts) {
    frequencies.set(k, count / values.length)
  }
  return { type: 'string', frequencies }
}

function buildArrayStats(values: Value[][]): FieldStats {
  if (values.length === 0) return { type: 'array', elements: [] }
  const length = values[0].length
  const elements: FieldStats[] = []
  for (let i = 0; i < length; i++) {
    const column = values.map((arr) => arr[i])
    elements.push(buildStats(column))
  }
  return { type: 'array', elements }
}

function buildRecordStats(values: Record<string, Value>[]): FieldStats {
  if (values.length === 0) return { type: 'record', fields: {} }
  const keys = Object.keys(values[0])
  const fields: Record<string, FieldStats> = {}
  for (const key of keys) {
    const column = values.map((rec) => rec[key])
    fields[key] = buildStats(column)
  }
  return { type: 'record', fields }
}
