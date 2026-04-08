import { die, binaryOp, diceVariableRef } from '../src/dice-expression'
import { DE } from '../src/dice-expression-domain'
import { Roller } from '../src/roller'
import { RR } from '../src/roll-result-domain'

describe('DiceVariableRef in DiceExpression', () => {
  test('toString renders $name', () => {
    const expr = binaryOp('sum', die(20), diceVariableRef('mod'))
    expect(DE.toString(expr)).toBe('d20 + $mod')
  })

  test('roller resolves variable from environment', () => {
    const expr = binaryOp('sum', die(20), diceVariableRef('mod'))
    const roller = new Roller(() => 1, undefined, { mod: 5 })
    const result = RR.getResult(roller.roll(expr))
    expect(result).toBe(6)
  })

  test('roller throws on undefined variable', () => {
    const expr = diceVariableRef('missing')
    const roller = new Roller(() => 1)
    expect(() => roller.roll(expr)).toThrow('Undefined variable: $missing')
  })

  test('calculateBasicRolls counts variable as 0', () => {
    expect(DE.calculateBasicRolls(diceVariableRef('x'))).toBe(0)
  })

  test('simplify returns variable unchanged', () => {
    const expr = diceVariableRef('x')
    expect(DE.simplify(expr)).toEqual(expr)
  })

  test('validate returns no errors', () => {
    expect(DE.validate(diceVariableRef('x'))).toBeNull()
  })
})
