#!/usr/bin/env tsx
/**
 * tournament_participants.dan_rank を生 dan から normalizeDan で導出して一括 backfill。
 *
 * 過去結果を投入済みの環境（リハ DB / 将来の本番）で、生 dan（"初段"/"初"/"3段"/
 * "弐"/"無" 等の揺れ）から正規化済みの段位ランク 1–10（段位なし/記号は null）を埋める。
 * 新規ロードでは materialize（materializeResultDraft）が dan_rank を併記するため本
 * スクリプトは既ロード環境向けの一括是正。
 *
 * distinct な生 dan 値ごとに 1 度だけ UPDATE する（生 dan の異なり値は数十種なので
 * 行数 37 万でも UPDATE は数十回）。`dan_rank IS DISTINCT FROM` ガードで冪等。
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/backfill-dan-rank.ts [--dry-run]
 *
 * --dry-run: 反映予定（生値→ランクの対応と件数）のみ表示し DB は一切変更しない。
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { normalizeDan } from '@kagetra/mail-worker/result-import/normalize'

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const { rows } = await pool.query<{ dan: string; n: string }>(
      `select dan, count(*)::text n from tournament_participants where dan is not null group by dan order by count(*) desc`,
    )
    let updated = 0
    let toRank = 0
    let toNull = 0
    const samples: string[] = []
    for (const { dan, n } of rows) {
      const rank = normalizeDan(dan)
      const cnt = parseInt(n, 10)
      if (rank == null) toNull += cnt
      else toRank += cnt
      if (samples.length < 50) samples.push(`  "${dan}" -> ${rank ?? 'null'}  (${cnt} rows)`)
      if (!dryRun) {
        const res = await pool.query(
          `update tournament_participants set dan_rank = $1 where dan = $2 and dan_rank is distinct from $1`,
          [rank, dan],
        )
        updated += res.rowCount ?? 0
      }
    }
    const head = dryRun ? '[backfill-dan-rank] [dry-run]' : '[backfill-dan-rank]'
    process.stdout.write(
      `${head} distinct dan values=${rows.length}; rows->rank(1-10)=${toRank}, rows->null(no dan)=${toNull}` +
        (dryRun ? ' (no changes written)' : `; updated ${updated} rows`) +
        '\n' +
        samples.join('\n') +
        '\n',
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
        `[backfill-dan-rank] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
