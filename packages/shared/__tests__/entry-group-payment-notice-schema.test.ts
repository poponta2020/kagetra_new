import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { entryGroupPaymentNotices } from '../src/schema'

const table = getTableConfig(entryGroupPaymentNotices)

// line-bot-message-revamp 2026-09-04 改修（§3.3.5.6）で足した失敗記録の列。
const migrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0063_cool_frightful_four.sql', import.meta.url)),
  'utf8',
)

describe('entry_group_payment_notices の失敗記録', () => {
  it('試行日時と失敗理由を nullable で持つ（既存行に既定 NULL が入るだけ）', () => {
    // 非破壊 ALTER（§6）。NOT NULL や DEFAULT を付けると既存行の書き換えが要る。
    expect(entryGroupPaymentNotices.lastAttemptedAt.notNull).toBe(false)
    expect(entryGroupPaymentNotices.lastAttemptedAt.hasDefault).toBe(false)
    expect(entryGroupPaymentNotices.lastError.notNull).toBe(false)
    expect(entryGroupPaymentNotices.lastError.hasDefault).toBe(false)
  })

  it('列名は snake_case で、成功記録（last_sent_at）とは別の列', () => {
    const columns = table.columns.map((c) => c.name)
    expect(columns).toContain('last_attempted_at')
    expect(columns).toContain('last_error')
    // ★成功と試行を1列で兼ねない。last_sent_at は成功時だけ進む（AC-19 / AC-45）。
    expect(columns).toContain('last_sent_at')
  })

  it('マイグレーションが ADD COLUMN だけで既存行を触らない', () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "entry_group_payment_notices" ADD COLUMN "last_attempted_at" timestamp with time zone',
    )
    expect(migrationSql).toContain(
      'ALTER TABLE "entry_group_payment_notices" ADD COLUMN "last_error" text',
    )
    expect(migrationSql).not.toMatch(/UPDATE|DROP|NOT NULL/)
  })

  it('1グループ1行のまま（履歴は持たない）', () => {
    const uniqueColumns = table.uniqueConstraints.map((c) => c.columns.map((col) => col.name))
    expect(uniqueColumns).toEqual([['entry_group_id']])
  })
})
