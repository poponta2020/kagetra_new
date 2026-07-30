import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { events } from '../src/schema'

/**
 * grade-entry-fee タスク2: `events.payment_type` の既定値変更（AC-26 / AC-27）。
 *
 * ここは DB を持たない静的検査（宣言と migration 本文の照合）。**backfill が実際に
 * 効くこと**は `apps/web/src/lib/payment-type-backfill.test.ts` が実 DB で検証する
 * （テスト DB は `drizzle-kit push` で作られ migration 本文を実行しないため、
 * ここで挙動まで見たことにはできない）。
 */

const migrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0052_tiny_red_hulk.sql', import.meta.url)),
  'utf8',
)

describe('events.payment_type の既定値', () => {
  it('AC-26: Drizzle 定義の既定値が advance になっている', () => {
    expect(events.paymentType.hasDefault).toBe(true)
    expect(events.paymentType.default).toBe('advance')
  })

  it('列は nullable のまま（onsite からの往復・「通知しない」表現を潰さない）', () => {
    expect(events.paymentType.notNull).toBe(false)
  })

  it('AC-26: migration が DEFAULT を advance に変える', () => {
    expect(migrationSql).toContain(
      `ALTER TABLE "events" ALTER COLUMN "payment_type" SET DEFAULT 'advance'`,
    )
  })

  it('AC-27: 同じ migration 内で NULL 行だけを backfill する', () => {
    expect(migrationSql).toContain(
      `UPDATE "events" SET "payment_type" = 'advance' WHERE "payment_type" IS NULL`,
    )
    // DEFAULT 変更と backfill が別 statement として実行されること（drizzle は
    // `--> statement-breakpoint` で分割する）。
    expect(migrationSql).toContain('--> statement-breakpoint')
  })

  it('AC-27: 既存値を無条件に書き換える UPDATE を含まない', () => {
    const updates = migrationSql.match(/UPDATE\s+"events"[^;]*/gi) ?? []
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatch(/WHERE\s+"payment_type"\s+IS\s+NULL/i)
  })
})
