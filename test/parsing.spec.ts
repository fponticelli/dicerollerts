import { DE } from "../src/dice-expression-domain"
import { DiceParser } from "../src/dice-parser"
import { RR } from "../src/roll-result-domain"
import { maxRoller, minRoller } from "./roller.spec"

interface TestObject {
  min: number
  max?: number
  t: string
  p?: string
}

const testObjects: TestObject[] = [
  { min: 1, t: "1" },
  { min: 2, t: "2" },
  { min: 1, max: 6, t: "D", p: "d6" },
  { min: 1, max: 6, t: "d", p: "d6" },
  { min: 1, max: 6, t: "1d", p: "d6" },
  { min: 1, max: 6, t: "1D", p: "d6" },
  { min: 1, max: 6, t: "1d6", p: "d6" },
  { min: 1, max: 6, t: "1D6", p: "d6" },
  { min: 1, max: 6, t: "d6" },
  { min: 1, max: 6, t: "D6", p: "d6" },
  { min: 1, max: 6, t: " d6 ", p: "d6" },
  { min: 1, max: 6, t: "d6 ", p: "d6" },
  { min: 1, max: 6, t: " d6", p: "d6" },
  { min: 1, max: 100, t: "d%" },
  { min: 3, max: 300, t: "3d100", p: "3d%" },

  { min: 1, max: 8, t: "(d8)", p: 'd8' },
  { min: 2, max: 2, t: "(2)", p: '2' },
  { min: 5, t: "(2,3)" },
  { min: 2, max: 6, t: "2d3" },
  { min: 2, max: 6, t: "(2d3)", p: '2d3' },
  { min: 2, max: 14, t: "(d6,d8)" },
  { min: 2, max: 14, t: "( d6 , d8 )", p: "(d6,d8)" },
  { min: 3, max: 18, t: "(d4,d6,d8)" },
  { min: 5, max: 20, t: "(2,d4,d6,d8)" },
  { min: 6, max: 30, t: "(2,d4,3d8)" },
  { min: 10, max: 58, t: "((2,d4,3d8),d4,3d8)" },

  { min: -6, t: "-6" },
  { min: -1, max: -6, t: "-d6" },
  { min: -1, max: -6, t: "-d6" },
  { min: -2, max: -10, t: "-(d6,d4)" },
  { min: 5, t: "2+3", p: "2 + 3" },
  { min: 1, t: "2-1", p: "2 - 1" },
  { min: 0, t: "2-1-1", p: "2 - 1 - 1" },
  { min: 6, max: 25, t: "3 + d6 + 2d8" },
  { min: 0, max: 19, t: "-3 + d6 + 2d8" },
  { min: -2, max: 7, t: "-3 + -d6 + 2d8" },
  { min: 5, max: 24, t: "d6 + 2d8 + 2" },
  { min: 1, max: 48, t: "d6 * 2d8 / 2" },
  { min: 14, max: 14, t: "2 + 3 * 4" },
  { min: -10, t: "2 + -3 * 4" },
  { min: -10, t: "2 + 3 * -4" },
  { min: 10, t: "-2 + 3 * 4" },
  { min: 14, t: "2 + (3 * 4)" },

  { min: 4, t: "100 / 25" },
  { min: 75, t: "25 * 3" },
  { min: 2, t: "150 / 25 * 3" }, // precedence might not be correct
  { min: 18, t: "(150 / 25) * 3" },
  { min: 11, max: 105, t: "((2,d4,3d8),5) * (d4,3d8) / (3,d6)" },

  { min: 10, max: 60, t: "10d6" },
  { min: 10, max: 60, t: "10d6 sum", p: "10d6" },
  { min: 1, max: 6, t: "10d6 min" },
  { min: 1, max: 6, t: "10d6 minimum", p: "10d6 min" },
  { min: 1, max: 6, t: "10d6 max" },
  { min: 1, max: 6, t: "10d6 maximum", p: "10d6 max" },
  { min: 1, t: "(1,2,3) min" },
  { min: 3, t: "(1,2,3) max" },
  { min: 2, t: "(1,2,3) avg", p: "(1,2,3) average" },
  { min: 1, max: 6, t: "3d6 average" },
  { min: 4, max: 24, t: "(3d6,5d6) average" },
  { min: 2, t: "(1,2,3) average" },

  { min: 5, t: "(1,2,3) drop lowest 1", p: "(1,2,3) drop 1" },
  { min: 3, t: "(1,2,3) drop lowest 2", p: "(1,2,3) drop 2" },
  { min: 3, t: "(1,2,3) drop low 2", p: "(1,2,3) drop 2" },
  { min: 5, t: "(1,2,3) drop 1" },
  { min: 5, t: "(1,2,3)d1", p: "(1,2,3) drop 1" },
  { min: 3, t: "(1,2,3) drop highest 1" },
  { min: 1, t: "(1,2,3) drop highest 2" },
  { min: 1, t: "(1,2,3) drop high 2", p: "(1,2,3) drop highest 2" },
  { min: 3, max: 18, t: "5d6 drop 2" },

  { min: 1, t: "(1,2,3) keep lowest 1" },
  { min: 3, t: "(1,2,3) keep lowest 2" },
  { min: 3, t: "(1,2,3) keep low 2", p: "(1,2,3) keep lowest 2" },
  { min: 3, t: "(1,2,3) keep 1" },
  { min: 3, t: "(1,2,3) keep highest 1", p: "(1,2,3) keep 1" },
  { min: 5, t: "(1,2,3) keep highest 2", p: "(1,2,3) keep 2" },
  { min: 5, t: "(1,2,3)k2", p: "(1,2,3) keep 2" },
  { min: 5, t: "(1,2,3) keep high 2", p: "(1,2,3) keep 2" },
  { min: 2, max: 12, t: "5d6 keep 2" },

  { min: 3, max: 12, t: "(d2,d3,d4) explode once on 3" },
  { min: 3, max: 54, t: "3d6 explode twice on 6" },
  { min: 3, max: 108, t: "3d6 explode 5 times on 6" },
  { min: 3, max: 18, t: "3d6 explode always on 7", p: "3d6 explode on 7" },
  { min: 3, max: 18, t: "3d6 explode on 7" },
  { min: 1, max: 12, t: "d6 explode once on 6" },
  { min: 1, max: 12, t: "1d6 explode once on 6", p: "d6 explode once on 6" },
  { min: 3, max: 18, t: "3d6e7", p: "3d6 explode on 7 or more" },

  { min: 3, max: 9, t: "(d2,d3,d4) reroll once on 1" },
  { min: 3, max: 18, t: "3d6 reroll twice on 6" },
  { min: 3, max: 18, t: "3d6 reroll 5 times on 6" },
  { min: 1, max: 6, t: "d6 reroll once on 6" },
  { min: 1, max: 6, t: "1d6 reroll once on 6", p: "d6 reroll once on 6" },

  { min: 1, max: 20, t: "d20 emphasis reroll", p: "d20 emphasis" },
  { min: 1, max: 20, t: "d20 emphasis", p: "d20 emphasis" },
  { min: 1, max: 20, t: "d20 emphasis high", p: "d20 emphasis high" },
  { min: 1, max: 20, t: "d20 emphasis low", p: "d20 emphasis low" },

  { min: 1, t: "d20 furthest from 10", p: "d20 furthest from 10" },
  { min: 1, t: "d20 furthest from 10 reroll", p: "d20 furthest from 10" },
  { min: 1, t: "d20 furthest from 10 high", p: "d20 furthest from 10 high" },
  { min: 1, t: "d20 furthest from 10 low", p: "d20 furthest from 10 low" },
];

function fail(reason = "fail was called in a test.") {
  throw new Error(reason);
}

describe("parsing and rendering", () => {
  test("parse and render", () => {
    for (const { t, p, min, max } of testObjects) {
      const parsed = DiceParser.parse(t);
      if (parsed.isSuccess()) {
        const rendered = DE.toString(parsed.value);
        expect(rendered).toEqual(p ?? t);
        const minr = RR.getResult(minRoller().roll(parsed.value))
        if (minr !== min) {
          fail(`min roll ${minr} to be equal to ${min} for ${t}`);
        }
        if (max != null) {
          const maxr = RR.getResult(maxRoller().roll(parsed.value))
          if (maxr !== max) {
            fail(`max roll ${maxr} expected to be equal to ${max} for ${t}`);
          }
        }
      } else {
        fail(`failed to parse "${t}": ${parsed.getUnsafeFailures().join(", ")}`);
      }
    }
  })
})
