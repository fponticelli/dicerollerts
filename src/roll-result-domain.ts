import { type RollResult } from './roll-result'

export const RR = {
  getResult (result: RollResult): number {
    if (result.type === 'one-result') {
      return result.die.result
    } else {
      return result.result
    }
  }
}
