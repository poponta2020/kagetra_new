#!/usr/bin/env -S tsx
/**
 * DB-independent LINE failure notification CLI. Used by scripts/deploy/backup.sh
 * as a second-tier fallback when the primary notify-system.ts (which reads
 * line_channels from postgres) cannot reach the DB — typically because the
 * postgres container itself is the cause of the backup failure.
 *
 * Reads channel token + admin userId from env (LINE_FALLBACK_CHANNEL_ACCESS_TOKEN,
 * LINE_FALLBACK_NOTIFY_USER_ID) and calls @line/bot-sdk's pushMessage directly.
 * No DB dependency, no shared state with mail-worker pipeline — keeps the
 * failure path orthogonal to whatever broke the primary notify.
 *
 * Args:
 *   <message>         positional, required. The text body to push.
 *   --help, -h        show usage and exit 1 (also fires when message missing).
 *
 * Exit codes:
 *   0  pushed, dry-run skip (`LINE_NOTIFY_DRY_RUN=1`), or env-not-configured
 *      skip (LINE_FALLBACK_* unset — operator hasn't wired this fallback yet).
 *      env-not-configured is intentionally non-fatal: the calling backup.sh has
 *      already tried notify-system.ts, and journalctl is the last-resort
 *      log channel. Returning 1 here would only add noise.
 *   1  usage error (missing message), SDK throw (network / auth / etc.), or
 *      any other unexpected fatal. The backup script can treat 1 as
 *      "alert not delivered" and surface that to journalctl.
 *
 * Usage:
 *   tsx apps/mail-worker/scripts/notify-fallback.ts "<message>"
 *
 * Honours `LINE_NOTIFY_DRY_RUN=1` for local smoke tests (same convention as
 * notify-system.ts).
 */
import { pathToFileURL } from 'node:url'
import { messagingApi } from '@line/bot-sdk'

interface ParsedArgs {
  message: string | null
  help: boolean
}

export function printUsage(): void {

  console.log(`Usage: tsx apps/mail-worker/scripts/notify-fallback.ts "<message>"

Push a free-form text message to the LINE channel configured via env vars.
Used as a DB-independent fallback when notify-system.ts (DB-backed) cannot
reach postgres.

Args:
  <message>        positional, required. The text body to push.
  --help, -h       show this help

Exit codes:
  0  pushed, dry-run skip, or env-not-configured skip
  1  usage error, SDK error, or other fatal

Env:
  LINE_FALLBACK_CHANNEL_ACCESS_TOKEN  channel access token (production LINE
                                      channel; may be the same value used by
                                      seed-system-channel.ts).
  LINE_FALLBACK_NOTIFY_USER_ID        admin LINE userId to receive the alert.
  LINE_NOTIFY_DRY_RUN=1               skip the real push (log-only).

If either LINE_FALLBACK_* var is empty, the CLI logs a skip line and exits 0
so the calling script can rely on journalctl as the final log channel.
`)
}

/**
 * Pull the first non-flag arg as the message. Mirrors notify-system.ts so the
 * two CLIs feel identical to operator hands. Unknown flags fail loudly to
 * surface typos (e.g. `--mesage=foo`).
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
 * Library-shaped CLI entrypoint. Returns the would-be process exit code so
 * tests can assert without actually exiting the worker. log prefix is
 * `[notify-fallback]` (distinct from notify-system's `[notify-system]`) so
 * journald greps can tell which path fired.
 */
export async function runNotifyFallbackCli(
  argv: readonly string[],
): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(
      `[notify-fallback] error: ${err instanceof Error ? err.message : String(err)}\n\n`,
    )
    printUsage()
    return 1
  }

  if (parsed.help || !parsed.message) {
    printUsage()
    return 1
  }

  const message = parsed.message

  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {

    console.log(
      '[notify-fallback] skipped: dry-run (LINE_NOTIFY_DRY_RUN=1)',
      { preview: message.slice(0, 200) },
    )
    return 0
  }

  const token = process.env.LINE_FALLBACK_CHANNEL_ACCESS_TOKEN
  const userId = process.env.LINE_FALLBACK_NOTIFY_USER_ID
  if (!token || !userId) {
    // Operational choice (see header docstring): unconfigured env is logged
    // and skipped rather than treated as a failure. The caller (backup.sh)
    // has already exhausted the primary path; emitting exit 1 here would
    // just churn journal without changing the operator outcome.

    console.log(
      '[notify-fallback] skipped: env-not-configured (set LINE_FALLBACK_CHANNEL_ACCESS_TOKEN and LINE_FALLBACK_NOTIFY_USER_ID to enable)',
    )
    return 0
  }

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: token,
  })

  try {
    await client.pushMessage({
      to: userId,
      messages: [{ type: 'text', text: message }],
    })

    console.log('[notify-fallback] pushed')
    return 0
  } catch (err) {
    process.stderr.write(
      `[notify-fallback] error: LINE pushMessage failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    )
    return 1
  }
}

// Entrypoint guard. Equivalent to Python's `if __name__ == '__main__':` —
// allows tests / other scripts to import this module without auto-running the
// CLI. `pathToFileURL` produces the canonical form that matches
// `import.meta.url` on both POSIX and Windows (see notify-system.ts).
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runNotifyFallbackCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {

      console.error('[notify-fallback] fatal:', err)
      process.exit(1)
    })
}
