export interface ParseError {
  message: string
  position: number
  suggestion?: string
  context: string
}

export type ParseWithErrorsResult<T> =
  | { success: true; value: T }
  | { success: false; errors: ParseError[] }

const KEYWORDS = [
  'explode', 'reroll', 'compound', 'drop', 'keep',
  'lowest', 'highest', 'average', 'median', 'minimum',
  'maximum', 'emphasis', 'furthest', 'count', 'sum',
  'once', 'twice', 'always', 'on', 'or', 'more',
  'less', 'high', 'low', 'times',
]

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

export function suggestKeyword(word: string): string | undefined {
  let best: string | undefined
  let bestDist = Infinity
  for (const kw of KEYWORDS) {
    const dist = levenshtein(word.toLowerCase(), kw)
    if (dist < bestDist && dist <= 2) {
      bestDist = dist
      best = kw
    }
  }
  return best
}

export function buildParseErrors(
  input: string,
  failureIndex: number,
  rawMessages: string[],
): ParseError[] {
  const position = failureIndex
  const contextStart = Math.max(0, position - 10)
  const contextEnd = Math.min(input.length, position + 10)
  const context = input.substring(contextStart, contextEnd)

  const remaining = input.substring(position)
  const wordMatch = remaining.match(/^([a-zA-Z]+)/)
  const suggestion = wordMatch ? suggestKeyword(wordMatch[1]) : undefined

  const errors: ParseError[] = []

  if (input.trim() === '') {
    errors.push({
      message: 'Empty input: expected a dice expression',
      position: 0,
      context: '',
    })
    return errors
  }

  // Check for "explode/reroll/compound <number>" without "on"
  const explodeWithoutOn = input.match(/\b(explode|reroll|compound)\s+(\d+)\s*$/)
  if (explodeWithoutOn) {
    errors.push({
      message: `Expected 'on' keyword after '${explodeWithoutOn[1]}'`,
      position: input.indexOf(explodeWithoutOn[0]) + explodeWithoutOn[1].length,
      suggestion: `${explodeWithoutOn[1]} on ${explodeWithoutOn[2]}`,
      context,
    })
    return errors
  }

  const message = rawMessages.length > 0
    ? rawMessages.join('; ')
    : `Unexpected input at position ${position}`

  errors.push({
    message,
    position,
    suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
    context,
  })

  return errors
}
