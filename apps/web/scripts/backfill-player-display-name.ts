#!/usr/bin/env tsx
/**
 * players.display_name を「その選手の全 participations 横断の最頻表記（mode）」へ
 * 一括是正する backfill スクリプト。
 *
 * 既にロード済みの環境（メール承認由来の player が居る本番や、過去結果を投入済みの
 * リハ DB など）で、first-wins で固定された display_name（例: 生は「山﨑」なのに
 * 表示が「山崎」に化けた行）を真の最頻表記へ寄せ直す。
 *
 * 新規ロードでは materialize（materializeResultDraft 末尾）が touched player を
 * 自己補正するため本スクリプトは不要。あくまで既ロード環境向けの是正＋冪等な保険。
 * recomputePlayerDisplayNames は変化分（display_name IS DISTINCT FROM 採用表記）の
 * みを UPDATE するため、何度流しても安全（冪等）。
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/backfill-player-display-name.ts [--dry-run]
 *
 * --dry-run: 更新予定件数のみ表示し DB は一切変更しない
 *            （tx 内で recompute → 必ず ROLLBACK）。
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { recomputePlayerDisplayNames } from '@/lib/players/recompute-display-name'

/**
 * dry-run の sentinel。tx 内で recompute → これを throw して必ず ROLLBACK させる。
 * drizzle 内部の rollback 例外名に依存せず、この専用クラスだけを catch で握りつぶす。
 */
class DryRunComplete extends Error {
  constructor(readonly count: number) {
    super('dry-run complete')
    this.name = 'DryRunComplete'
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })

    if (dryRun) {
      // tx 内で recompute して件数を確保 → 必ず throw して ROLLBACK（DB 不変）。
      let count = 0
      try {
        await db.transaction(async (tx) => {
          count = await recomputePlayerDisplayNames(tx)
          throw new DryRunComplete(count)
        })
      } catch (err) {
        // 期待した rollback sentinel だけ握りつぶす。他は rethrow。
        if (!(err instanceof DryRunComplete)) throw err
      }
      process.stdout.write(
        `[backfill-player-display-name] [dry-run] would update ${count} players (no changes written)\n`,
      )
      return
    }

    const n = await recomputePlayerDisplayNames(db)
    process.stdout.write(
      `[backfill-player-display-name] updated ${n} players\n`,
    )
  } finally {
    await pool.end()
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(
        `[backfill-player-display-name] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
