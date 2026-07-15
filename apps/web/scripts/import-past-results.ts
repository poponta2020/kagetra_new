#!/usr/bin/env tsx
/**
 * 過去大会結果の本番DB一括投入スクリプト（案A: パース/投入の分離）。
 *
 * 入力 = ハーネスが生成した payload JSON（scripts/大会結果取り込み/2025年_payload.json）。
 *   - adopt=YES のみ・F級除外・(tournamentName, eventDate) でグルーピング済み。
 *   - 各 instance.payload は ParsedResultPayload（{ parserVersion, classes }）。
 *
 * 各 instance を 1 トランザクションで materializeResultDraft に渡して投入する。
 * 冪等: 同一 (name, event_date) が既に tournaments にあれば skip（再実行で重複投入しない）。
 *   materialize は tournaments を毎回 INSERT するため、重複防止はこの呼び出し側ガードが担う。
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/import-past-results.ts [--payload <path>] [--dry-run]
 *
 * ⚠ 本番DBへの書き込みはユーザー確認必須。まず --dry-run と コピーDB で確認すること。
 */
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@kagetra/shared/schema'
import { tournaments } from '@kagetra/shared/schema'
import { ParsedResultPayloadSchema } from '@kagetra/mail-worker/result-import/schema'
import { materializeResultDraft } from '../src/lib/result-import/materialize'
import { type BulkImportInstance, instanceDbKey, planImport } from '../src/lib/result-import/bulk-import'

type Db = ReturnType<typeof drizzle<typeof schema>>

/** payload JSON を読み、各 instance の payload を Zod 検証して返す。 */
export function loadInstances(payloadPath: string): BulkImportInstance[] {
  const raw: unknown = JSON.parse(readFileSync(payloadPath, 'utf-8'))
  if (!Array.isArray(raw)) throw new Error('payload JSON はトップレベル配列である必要があります')
  const instances: BulkImportInstance[] = []
  raw.forEach((item, i) => {
    const o = item as Record<string, unknown>
    const parsed = ParsedResultPayloadSchema.safeParse(o.payload)
    if (!parsed.success) {
      throw new Error(`instance[${i}] (${String(o.instanceKey)}) の payload が不正: ${parsed.error.message}`)
    }
    const name = o.tournamentName
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`instance[${i}] の tournamentName が不正`)
    }
    instances.push({
      instanceKey: String(o.instanceKey),
      tournamentName: name,
      eventDate: typeof o.eventDate === 'string' ? o.eventDate : null,
      venue: typeof o.venue === 'string' ? o.venue : null,
      payload: parsed.data,
    })
  })
  return instances
}

/** 既存 tournaments の (name, event_date) を冪等ガード用 Set にする。 */
export async function loadExistingKeys(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ name: tournaments.name, eventDate: tournaments.eventDate })
    .from(tournaments)
  return new Set(rows.map((r) => instanceDbKey(r.name, r.eventDate)))
}

export interface ImportSummary {
  total: number
  inserted: number
  skipped: number
  participants: number
  matches: number
}

/** 投入予定の participants / matches を数える（dry-run サマリ・read-back 期待値）。 */
function countContents(instances: readonly BulkImportInstance[]): { participants: number; matches: number } {
  let participants = 0
  let matches = 0
  for (const inst of instances) {
    for (const c of inst.payload.classes) {
      participants += c.participants.length
      for (const p of c.participants) matches += p.matches.length
    }
  }
  return { participants, matches }
}

export async function runImport(
  db: Db,
  instances: readonly BulkImportInstance[],
  options: { dryRun?: boolean } = {},
): Promise<ImportSummary> {
  const existing = await loadExistingKeys(db)
  const { toInsert, toSkip } = planImport(instances, existing)
  const { participants, matches } = countContents(toInsert)

  if (options.dryRun) {
    return { total: instances.length, inserted: 0, skipped: toSkip.length, participants, matches }
  }

  let inserted = 0
  for (const inst of toInsert) {
    // 1 開催 = 1 トランザクション（途中失敗で部分投入が残らない）。
    await db.transaction(async (tx) => {
      await materializeResultDraft(tx, inst.payload, {
        tournamentName: inst.tournamentName,
        eventDate: inst.eventDate,
        venue: inst.venue,
        sourceResultDraftId: null,
      })
    })
    inserted++
  }
  return { total: instances.length, inserted, skipped: toSkip.length, participants, matches }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const pIdx = argv.indexOf('--payload')
  const payloadPath =
    pIdx >= 0 && argv[pIdx + 1]
      ? argv[pIdx + 1]!
      : resolve(here, '..', '..', '..', 'scripts', '大会結果取り込み', '2025年_payload.json')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const instances = loadInstances(payloadPath)
  process.stdout.write(`[import-past-results] payload: ${instances.length} instances from ${payloadPath}\n`)

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })
    const s = await runImport(db, instances, { dryRun })
    process.stdout.write(
      `[import-past-results] ${dryRun ? 'DRY RUN: ' : ''}total=${s.total} inserted=${s.inserted} skipped=${s.skipped} (participants=${s.participants} matches=${s.matches})\n`,
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
        `[import-past-results] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
