#!/usr/bin/env -S tsx
/**
 * Seed or rotate the `line_channels` row with `status='system'`.
 *
 * Idempotent: if a system row exists, UPDATE the access_token / bot_id /
 * notification_user_id (token rotation 用途). Otherwise INSERT.
 *
 * Args (env fallback in `LINE_SYSTEM_*`):
 *   --channel-id=...                   (LINE_SYSTEM_CHANNEL_ID)        required
 *   --channel-secret=...               (LINE_SYSTEM_CHANNEL_SECRET)    required
 *   --access-token=...                 (LINE_SYSTEM_CHANNEL_ACCESS_TOKEN) required
 *   --bot-id=...                       (LINE_SYSTEM_BOT_ID)            required
 *   --notification-line-user-id=...    (LINE_SYSTEM_NOTIFICATION_USER_ID) optional
 *   --note=...                         (任意)                          optional
 *   --dry-run                          UPDATE/INSERT を print のみ、commit しない
 *   --help / -h                        usage 表示
 *
 * Usage:
 *   pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts \
 *     --channel-id=2007xxxx --channel-secret=... --access-token=... \
 *     --bot-id=@xxxx --notification-line-user-id=Uxxxxxxxx
 *
 * Or with env file already sourced:
 *   pnpm --filter @kagetra/mail-worker exec tsx scripts/seed-system-channel.ts
 */
import { pathToFileURL } from 'node:url'
import { eq } from 'drizzle-orm'
import { lineChannels } from '@kagetra/shared/schema'
import { closeDb, getDb } from '../src/db.js'

interface SeedArgs {
  channelId: string
  channelSecret: string
  accessToken: string
  botId: string
  notificationLineUserId: string | null
  note: string | null
  dryRun: boolean
  help: boolean
}

interface RawArgs {
  channelId: string | null
  channelSecret: string | null
  accessToken: string | null
  botId: string | null
  notificationLineUserId: string | null
  note: string | null
  dryRun: boolean
  help: boolean
}

function printUsage(): void {
   
  console.log(`Usage: tsx apps/mail-worker/scripts/seed-system-channel.ts [options]

Seed or rotate the line_channels row with status='system'. Idempotent:
existing system row is UPDATE'd (token rotation 用途), absent row is INSERT'd.

Required (env fallback in parens):
  --channel-id=<id>                     (LINE_SYSTEM_CHANNEL_ID)
  --channel-secret=<secret>             (LINE_SYSTEM_CHANNEL_SECRET)
  --access-token=<token>                (LINE_SYSTEM_CHANNEL_ACCESS_TOKEN)
  --bot-id=<bot-id>                     (LINE_SYSTEM_BOT_ID)

Optional:
  --notification-line-user-id=<userId>  (LINE_SYSTEM_NOTIFICATION_USER_ID)
                                        admin's LINE userId for push targets.
                                        未指定時は通知が skip される。
  --note=<text>                         freeform memo (DB column line_channels.note)
  --dry-run                             print intended INSERT/UPDATE; no commit
  --help, -h                            show this help

Requires DATABASE_URL in env (loaded via dotenv from repo root).
`)
}

/**
 * Parse argv + env into a raw set (nullable). Validation happens in
 * `validateArgs` so `--help` / `--dry-run` can short-circuit before we yell
 * about missing required fields.
 *
 * Unknown flags fail loudly — a typo like `--notification-line-userid` would
 * otherwise silently fall back to env (or null) and the operator would think
 * the row was seeded with their argument when it wasn't.
 */
function parseArgs(argv: readonly string[]): RawArgs {
  const raw: RawArgs = {
    channelId: process.env.LINE_SYSTEM_CHANNEL_ID ?? null,
    channelSecret: process.env.LINE_SYSTEM_CHANNEL_SECRET ?? null,
    accessToken: process.env.LINE_SYSTEM_CHANNEL_ACCESS_TOKEN ?? null,
    botId: process.env.LINE_SYSTEM_BOT_ID ?? null,
    notificationLineUserId:
      process.env.LINE_SYSTEM_NOTIFICATION_USER_ID ?? null,
    note: null,
    dryRun: false,
    help: false,
  }
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      raw.help = true
    } else if (a === '--dry-run') {
      raw.dryRun = true
    } else if (a.startsWith('--channel-id=')) {
      raw.channelId = a.slice('--channel-id='.length)
    } else if (a.startsWith('--channel-secret=')) {
      raw.channelSecret = a.slice('--channel-secret='.length)
    } else if (a.startsWith('--access-token=')) {
      raw.accessToken = a.slice('--access-token='.length)
    } else if (a.startsWith('--bot-id=')) {
      raw.botId = a.slice('--bot-id='.length)
    } else if (a.startsWith('--notification-line-user-id=')) {
      raw.notificationLineUserId = a.slice(
        '--notification-line-user-id='.length,
      )
    } else if (a.startsWith('--note=')) {
      raw.note = a.slice('--note='.length)
    } else {
      throw new Error(`unknown flag: ${a}`)
    }
  }
  return raw
}

function validateArgs(raw: RawArgs): SeedArgs {
  const missing: string[] = []
  if (!raw.channelId) missing.push('--channel-id (or LINE_SYSTEM_CHANNEL_ID)')
  if (!raw.channelSecret)
    missing.push('--channel-secret (or LINE_SYSTEM_CHANNEL_SECRET)')
  if (!raw.accessToken)
    missing.push('--access-token (or LINE_SYSTEM_CHANNEL_ACCESS_TOKEN)')
  if (!raw.botId) missing.push('--bot-id (or LINE_SYSTEM_BOT_ID)')
  if (missing.length > 0) {
    throw new Error(`missing required args: ${missing.join(', ')}`)
  }
  // After the missing-check, the four required fields are non-null. The
  // explicit `as string` keeps strict mode + noUncheckedIndexedAccess happy
  // without broadening the SeedArgs type.
  return {
    channelId: raw.channelId as string,
    channelSecret: raw.channelSecret as string,
    accessToken: raw.accessToken as string,
    botId: raw.botId as string,
    notificationLineUserId: raw.notificationLineUserId,
    note: raw.note,
    dryRun: raw.dryRun,
    help: raw.help,
  }
}

/**
 * Redact secrets before logging. The dry-run path prints the would-be values
 * for operator verification; we strip access_token + channel_secret because
 * a copy-paste of journalctl output into Slack/issue comments would leak
 * them otherwise.
 */
function redactForLog(args: SeedArgs): Record<string, unknown> {
  return {
    channelId: args.channelId,
    channelSecret: '<redacted>',
    accessToken: '<redacted>',
    botId: args.botId,
    notificationLineUserId: args.notificationLineUserId,
    note: args.note,
  }
}

export async function runSeed(args: SeedArgs): Promise<'inserted' | 'updated' | 'dry-run-insert' | 'dry-run-update'> {
  const db = getDb()
  try {
    const existing = await db
      .select({ id: lineChannels.id })
      .from(lineChannels)
      .where(eq(lineChannels.status, 'system'))

    if (args.dryRun) {
      if (existing.length === 0) {
         
        console.log('[dry-run] would INSERT new system channel:')
         
        console.log(redactForLog(args))
        return 'dry-run-insert'
      }
       
      console.log(
        `[dry-run] would UPDATE existing system channel id=${existing[0]?.id ?? '<unknown>'}:`,
      )
       
      console.log(redactForLog(args))
      return 'dry-run-update'
    }

    if (existing.length === 0) {
      await db.insert(lineChannels).values({
        channelId: args.channelId,
        channelSecret: args.channelSecret,
        channelAccessToken: args.accessToken,
        botId: args.botId,
        status: 'system',
        notificationLineUserId: args.notificationLineUserId,
        note: args.note,
      })
       
      console.log('Inserted new system channel')
      return 'inserted'
    }

    await db
      .update(lineChannels)
      .set({
        channelId: args.channelId,
        channelSecret: args.channelSecret,
        channelAccessToken: args.accessToken,
        botId: args.botId,
        notificationLineUserId: args.notificationLineUserId,
        note: args.note,
        updatedAt: new Date(),
      })
      .where(eq(lineChannels.status, 'system'))
     
    console.log(
      `Updated existing system channel id=${existing[0]?.id ?? '<unknown>'}`,
    )
    return 'updated'
  } finally {
    await closeDb()
  }
}

async function main(): Promise<number> {
  let raw: RawArgs
  try {
    raw = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n\n`,
    )
    printUsage()
    return 1
  }
  if (raw.help) {
    printUsage()
    return 0
  }
  let args: SeedArgs
  try {
    args = validateArgs(raw)
  } catch (err) {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n\n`,
    )
    printUsage()
    return 1
  }
  await runSeed(args)
  return 0
}

// Entrypoint guard. Equivalent to Python's `if __name__ == '__main__':` —
// allows tests / other scripts to import this module without auto-running
// the CLI. `pathToFileURL` produces the canonical `file://` form for the
// current platform: `file:///C:/path/to/x.ts` on Windows,
// `file:///path/to/x.ts` on POSIX. Hand-rolled slash counts got it wrong on
// Windows (PR3 r3 review) — the CLI silently exited 0 instead of running.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main()
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
       
      console.error('[seed-system-channel] fatal:', err)
      process.exit(1)
    })
}

export { main as runSeedCli, parseArgs, validateArgs }
