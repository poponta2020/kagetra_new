/**
 * Parse `--since=...` argument.
 *
 * Timezone handling, in priority order:
 *   - Bare `YYYY-MM-DD` → JST start-of-day. `new Date('2026-04-12')` would
 *     resolve to UTC midnight (= 09:00 JST), which would silently drop mails
 *     received between 00:00 and 08:59 JST on that date.
 *   - ISO datetime with explicit offset (`Z`, `+09:00`, `-05:00`, etc.) →
 *     passed through unchanged.
 *   - ISO datetime without offset (`2026-04-12T15:00:00`) → JST. Otherwise
 *     `new Date(value)` would interpret it in the runtime's local timezone,
 *     which silently differs between a developer machine (JST) and a UTC
 *     production host. The app is JST-only, so defaulting to JST removes a
 *     class of nine-hour off-by-one bugs.
 */
export function parseSinceArg(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  // Trailing offset: `Z`, `±HHMM`, or `±HH:MM`.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  let date: Date
  if (dateOnly) {
    date = new Date(`${value}T00:00:00+09:00`)
  } else if (!hasOffset) {
    date = new Date(`${value}+09:00`)
  } else {
    date = new Date(value)
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--since must be a parseable date, got: ${value}`)
  }
  return date
}

export type DispatcherMode = 'fetch' | 'extract'

export interface WorkerCliFlags {
  once: boolean
  since: Date | undefined
  mockImap: boolean
  mockLlm: boolean
  dryRun: boolean
  noClaim: boolean
  fixtureDir: string | undefined
  mode: DispatcherMode
  mailbox: string
  fromYear: number | undefined
  toYear: number | undefined
  maxRosterCandidates: number
  maxRosterAiCalls: number
  help: boolean
}

export const DEFAULT_MAX_ROSTER_CANDIDATES = 500
export const DEFAULT_MAX_ROSTER_AI_CALLS = 0

function parseIntegerFlag(name: string, value: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`--${name} must be a finite integer >= ${minimum}, got: ${value}`)
  }
  return parsed
}

export function parseWorkerArgs(argv: readonly string[]): WorkerCliFlags {
  const flags: WorkerCliFlags = {
    once: false,
    since: undefined,
    mockImap: false,
    mockLlm: false,
    dryRun: false,
    noClaim: false,
    fixtureDir: undefined,
    mode: 'fetch',
    mailbox: 'INBOX',
    fromYear: undefined,
    toYear: undefined,
    maxRosterCandidates: DEFAULT_MAX_ROSTER_CANDIDATES,
    maxRosterAiCalls: DEFAULT_MAX_ROSTER_AI_CALLS,
    help: false,
  }

  for (const arg of argv) {
    if (arg === '--once') flags.once = true
    else if (arg === '--mock-imap') flags.mockImap = true
    else if (arg === '--mock-llm') flags.mockLlm = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--no-claim') flags.noClaim = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg.startsWith('--since=')) flags.since = parseSinceArg(arg.slice('--since='.length))
    else if (arg.startsWith('--fixture-dir=')) flags.fixtureDir = arg.slice('--fixture-dir='.length)
    else if (arg.startsWith('--mailbox=')) {
      const mailbox = arg.slice('--mailbox='.length).trim()
      if (!mailbox) throw new Error('--mailbox must not be empty')
      flags.mailbox = mailbox
    } else if (arg.startsWith('--from-year=')) {
      flags.fromYear = parseIntegerFlag('from-year', arg.slice('--from-year='.length), 2000)
    } else if (arg.startsWith('--to-year=')) {
      flags.toYear = parseIntegerFlag('to-year', arg.slice('--to-year='.length), 2000)
    } else if (arg.startsWith('--max-roster-candidates=')) {
      flags.maxRosterCandidates = parseIntegerFlag(
        'max-roster-candidates',
        arg.slice('--max-roster-candidates='.length),
        0,
      )
    } else if (arg.startsWith('--max-roster-ai-calls=')) {
      flags.maxRosterAiCalls = parseIntegerFlag(
        'max-roster-ai-calls',
        arg.slice('--max-roster-ai-calls='.length),
        0,
      )
    } else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length)
      if (value === 'extract-only') flags.mode = 'extract'
      else if (value === 'fetch-only' || value === 'fetch') flags.mode = 'fetch'
      else throw new Error(`unknown --mode value: ${value} (expected fetch-only or extract-only)`)
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }

  if (flags.fromYear !== undefined && flags.toYear !== undefined && flags.fromYear > flags.toYear) {
    throw new Error('year range must have --from-year <= --to-year')
  }
  return flags
}
