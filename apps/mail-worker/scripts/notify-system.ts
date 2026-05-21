#!/usr/bin/env -S tsx
/**
 * Push a free-form text message to the LINE `status='system'` channel.
 *
 * Thin tsx CLI around `pushSystemNotification(db, message)` so bash scripts
 * (notably the nightly backup script) can fire a one-line admin alert without
 * re-implementing the SDK wiring. Mirrors the structure of
 * `seed-system-channel.ts` for consistency (shebang, entrypoint guard, log
 * prefix), but the surface is intentionally tiny: a single positional message.
 *
 * Args:
 *   <message>         positional, required. The text body to push.
 *   --help, -h        show usage and exit 1 (also fires when message missing).
 *
 * Exit codes:
 *   0  push succeeded, dry-run skip (`LINE_NOTIFY_DRY_RUN=1`), or no-user-id
 *      skip (system channel seeded but `notification_line_user_id` is null —
 *      LINE Login webhook not wired yet). These are all "non-error" outcomes;
 *      a backup script that just wants to fire-and-forget gets a clean 0.
 *   1  usage error (missing message), system channel not seeded,
 *      `LineNotifyError` from the SDK (e.g. 401 token expired), or any other
 *      unexpected fatal. The backup script can treat 1 as "alert not
 *      delivered" and fall back to its own log channel if needed.
 *
 * Usage:
 *   tsx apps/mail-worker/scripts/notify-system.ts "backup failed: foo"
 *
 * Requires DATABASE_URL in env (loaded via dotenv from repo root) and a seeded
 * `line_channels` row with status='system' (see seed-system-channel.ts).
 * Honours `LINE_NOTIFY_DRY_RUN=1` for local smoke tests.
 */
import { pathToFileURL } from 'node:url'
import { closeDb, getDb } from '../src/db.js'
import {
  LineNotifyError,
  LineSystemChannelNotConfiguredError,
  pushSystemNotification,
} from '../src/notify/line.js'
import type { NotifyLogger } from '../src/notify/line.js'

interface ParsedArgs {
  message: string | null
  help: boolean
}

export function printUsage(): void {

  console.log(`Usage: tsx apps/mail-worker/scripts/notify-system.ts "<message>"

Push a free-form text message to the LINE channel whose status='system'.

Args:
  <message>        positional, required. The text body to push.
  --help, -h       show this help

Exit codes:
  0  pushed, dry-run skip, or no-user-id skip
  1  usage error, system channel not seeded, SDK error, or other fatal

Requires DATABASE_URL in env and a seeded line_channels row (see
seed-system-channel.ts). Honours LINE_NOTIFY_DRY_RUN=1 for smoke tests.
`)
}

/**
 * Pull the first non-flag arg as the message. Unknown flags fail loudly so a
 * typo like `--mesage=foo` doesn't silently produce a help screen. Only
 * `--help` / `-h` / `--usage` short-circuit to the usage path.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { message: null, help: false }
  for (const a of argv) {
    if (a === '--help' || a === '-h' || a === '--usage') {
      parsed.help = true
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`)
    } else if (parsed.message === null) {
      parsed.message = a
    } else {
      throw new Error(`unexpected extra positional arg: ${a}`)
    }
  }
  return parsed
}

/**
 * Console-shaped logger forwarded into `pushSystemNotification`. We tag every
 * line with `[notify-system]` so journald output is greppable when a backup
 * script invocation hits a skip path.
 */
const cliLogger: NotifyLogger = {
  info: (msg, ctx) => {

    console.log('[notify-system]', msg, ctx ?? '')
  },
  warn: (msg, ctx) => {

    console.warn('[notify-system]', msg, ctx ?? '')
  },
}

/**
 * Library-shaped CLI entrypoint. Returns the would-be process exit code so
 * tests can assert without actually exiting the worker. The outer
 * `process.exit` happens only in the `import.meta.url` guard below.
 */
export async function runNotifySystemCli(
  argv: readonly string[],
): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(
      `[notify-system] error: ${err instanceof Error ? err.message : String(err)}\n\n`,
    )
    printUsage()
    return 1
  }

  if (parsed.help || !parsed.message) {
    printUsage()
    return 1
  }

  const message = parsed.message
  const db = getDb()
  try {
    const result = await pushSystemNotification(db, message, cliLogger)
    if (result.skipped) {

      console.log(`[notify-system] skipped: ${result.reason ?? 'unknown'}`)
    } else {

      console.log('[notify-system] pushed')
    }
    return 0
  } catch (err) {
    if (err instanceof LineSystemChannelNotConfiguredError) {
      process.stderr.write(
        `[notify-system] error: system channel not seeded: ${err.message}\n`,
      )
      return 1
    }
    if (err instanceof LineNotifyError) {
      process.stderr.write(
        `[notify-system] error: LINE pushMessage failed: ${String(err.cause)}\n`,
      )
      return 1
    }
    process.stderr.write(
      `[notify-system] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  } finally {
    await closeDb()
  }
}

// Entrypoint guard. Equivalent to Python's `if __name__ == '__main__':` —
// allows tests / other scripts to import this module without auto-running
// the CLI. See seed-system-channel.ts for the Windows `file://` rationale
// (PR3 r3 review): `pathToFileURL` produces the canonical form that matches
// `import.meta.url` on both POSIX and Windows.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runNotifySystemCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {

      console.error('[notify-system] fatal:', err)
      process.exit(1)
    })
}
