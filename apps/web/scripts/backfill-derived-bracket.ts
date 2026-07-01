#!/usr/bin/env tsx
/**
 * tournament_participants.derived_bracket を級内 matches から一括 backfill。
 *
 * 過去結果を投入済みの環境（リハ DB / 将来の本番）で、既存の全参加行に順位 bracket
 * （1=優勝 / 2=準優勝 / 4 / 8 / 16 …、導出不能級は null）を埋める。順位定義は戦績詳細
 * （getPlayerRecord）と単一ソースの `deriveClassBrackets`（内部で isDerivableClass →
 * derivePlacement）を使うので、②大会詳細の級別順位・③ランキング・②歴代優勝者が同じ
 * 値を読む。新規ロードでは materialize が同ロジックで併記するため本スクリプトは既ロード
 * 環境向けの一括是正＋冪等な保険。
 *
 * メモリを抑えるため級 id をチャンク（既定 500 級）に分けて参加者と matches を読み、級
 * 単位で bracket を算出する。UPDATE は算出した bracket 値ごとにまとめ、`derived_bracket
 * IS DISTINCT FROM` ガードで冪等（再実行で差分 0）。
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/backfill-derived-bracket.ts [--dry-run]
 *
 * --dry-run: 反映予定（bracket 分布と更新予定件数）のみ表示し DB は一切変更しない。
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { deriveClassBrackets, type PlacementMatch } from '@/lib/players/placement'

const CLASS_CHUNK = 500 // 一度に読む級数（参加者/matches の SELECT を分割）
const UPDATE_CHUNK = 5000 // 1 UPDATE の id 配列サイズ上限

interface PartRow {
  id: number
  class_id: number
  derived_bracket: number | null
}
interface MatchRow {
  class_id: number
  participant_id: number
  round: number
  round_label: string | null
  result: 'win' | 'lose'
  status: 'normal' | 'walkover' | 'forfeit'
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface BackfillSummary {
  dryRun: boolean
  classes: number
  scanned: number
  derivableParticipants: number
  champions: number
  nyusho: number
  changed: number
  updated: number
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<BackfillSummary> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const { rows: classRows } = await pool.query<{ id: number }>(
      'select id from tournament_classes order by id',
    )
    const classIds = classRows.map((r) => r.id)

    // 算出結果: target bracket 値ごとに participant id をまとめる（null は別枠）。
    const byBracket = new Map<number, number[]>()
    const toNull: number[] = []
    let scanned = 0
    let derivableParticipants = 0 // 算出 bracket が非 null の参加者
    let champions = 0 // bracket = 1
    let nyusho = 0 // bracket ≤ 8
    let changed = 0 // 現行と異なる = UPDATE 予定

    for (const idsChunk of chunk(classIds, CLASS_CHUNK)) {
      const [{ rows: parts }, { rows: matchRows }] = await Promise.all([
        pool.query<PartRow>(
          'select id, class_id, derived_bracket from tournament_participants where class_id = ANY($1::int[]) order by class_id, id',
          [idsChunk],
        ),
        pool.query<MatchRow>(
          'select class_id, participant_id, round, round_label, result, status from matches where class_id = ANY($1::int[])',
          [idsChunk],
        ),
      ])

      // participant_id -> その参加者の matches。
      const matchesByPart = new Map<number, PlacementMatch[]>()
      for (const m of matchRows) {
        const arr = matchesByPart.get(m.participant_id)
        const pm: PlacementMatch = {
          round: m.round,
          roundLabel: m.round_label,
          result: m.result,
          status: m.status,
        }
        if (arr) arr.push(pm)
        else matchesByPart.set(m.participant_id, [pm])
      }

      // class_id -> 参加者 row（id 昇順で決定的）。
      const partsByClass = new Map<number, PartRow[]>()
      for (const p of parts) {
        const arr = partsByClass.get(p.class_id)
        if (arr) arr.push(p)
        else partsByClass.set(p.class_id, [p])
      }

      for (const classParts of partsByClass.values()) {
        const brackets = deriveClassBrackets(
          classParts.map((p) => ({ matches: matchesByPart.get(p.id) ?? [] })),
        )
        for (let i = 0; i < classParts.length; i++) {
          const p = classParts[i]!
          const computed = brackets[i] ?? null
          scanned++
          if (computed !== null) {
            derivableParticipants++
            if (computed === 1) champions++
            if (computed <= 8) nyusho++
          }
          if (computed !== p.derived_bracket) {
            changed++
            if (computed === null) toNull.push(p.id)
            else {
              const arr = byBracket.get(computed)
              if (arr) arr.push(p.id)
              else byBracket.set(computed, [p.id])
            }
          }
        }
      }
    }

    // 反映（dry-run はスキップ）。bracket 値ごとに IS DISTINCT FROM ガードで UPDATE。
    let updated = 0
    if (!dryRun) {
      for (const [bracket, ids] of byBracket) {
        for (const idBatch of chunk(ids, UPDATE_CHUNK)) {
          const res = await pool.query(
            'update tournament_participants set derived_bracket = $1 where id = ANY($2::int[]) and derived_bracket is distinct from $1',
            [bracket, idBatch],
          )
          updated += res.rowCount ?? 0
        }
      }
      for (const idBatch of chunk(toNull, UPDATE_CHUNK)) {
        const res = await pool.query(
          'update tournament_participants set derived_bracket = null where id = ANY($1::int[]) and derived_bracket is not null',
          [idBatch],
        )
        updated += res.rowCount ?? 0
      }
    }

    const distribution = [...byBracket.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, ids]) => `bracket=${b}:${ids.length}`)
      .join(', ')
    const head = dryRun ? '[backfill-derived-bracket] [dry-run]' : '[backfill-derived-bracket]'
    process.stdout.write(
      `${head} classes=${classIds.length}, participants scanned=${scanned}; ` +
        `derivable(non-null)=${derivableParticipants} (champions=${champions}, nyusho≤8=${nyusho}); ` +
        `rows to change=${changed}` +
        (dryRun ? ' (no changes written)' : `; updated ${updated} rows`) +
        '\n' +
        `  changed by target: ${distribution || '(none)'}${toNull.length ? `, ->null:${toNull.length}` : ''}\n`,
    )
    return {
      dryRun,
      classes: classIds.length,
      scanned,
      derivableParticipants,
      champions,
      nyusho,
      changed,
      updated,
    }
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
        `[backfill-derived-bracket] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
