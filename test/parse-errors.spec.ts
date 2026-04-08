import { DiceParser } from '../src/dice-parser'

describe('parser error messages', () => {
  test('parseWithErrors returns success for valid input', () => {
    const result = DiceParser.parseWithErrors('3d6')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value.type).toBe('dice-reduce')
    }
  })

  test('parseWithErrors returns errors for invalid input', () => {
    const result = DiceParser.parseWithErrors('???')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0].message).toBeTruthy()
      expect(typeof result.errors[0].position).toBe('number')
    }
  })

  test('provides position information', () => {
    const result = DiceParser.parseWithErrors('3d6 +')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].position).toBeGreaterThanOrEqual(0)
    }
  })

  test('provides context string', () => {
    const result = DiceParser.parseWithErrors('3d6 explod on 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0].context).toBeTruthy()
    }
  })

  test('suggests corrections for misspelled keywords', () => {
    const result = DiceParser.parseWithErrors('3d6 explod on 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasSuggestion = result.errors.some((e) => e.suggestion)
      expect(hasSuggestion).toBe(true)
    }
  })

  test('suggests missing on keyword', () => {
    const result = DiceParser.parseWithErrors('3d6 explode 6')
    expect(result.success).toBe(false)
    if (!result.success) {
      const hasSuggestion = result.errors.some((e) =>
        e.suggestion?.includes('on'),
      )
      expect(hasSuggestion).toBe(true)
    }
  })

  test('empty input returns error', () => {
    const result = DiceParser.parseWithErrors('')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})
