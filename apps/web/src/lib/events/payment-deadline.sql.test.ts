import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { events } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup } from '@/test-utils/seed'

/**
 * `events_payment_deadline_kind_consistent` の DB 側の挙動（AC-40）と、
 * migration 0052 の backfill 順序（AC-41）を固定する。
 *
 * なぜ順序をファイル内容で見るのか: vitest の global-setup は
 * `drizzle-kit push --force` で**最終スキーマを直接 push する**ため、migration
 * ファイルの backfill SQL はテストスイートで一度も実行されない。順序を実 DB で
 * 再現するテストは書けないので、代わりに「UPDATE が ADD CONSTRAINT より前にある」
 * という不変条件をファイルに対して固定する。順序を誤ると既存行が制約違反になり、
 * 本番 `db:migrate` がその場で止まる（ローカルでは検出できない類の事故）。
 */
// vitest は apps/web を cwd に走る（`import.meta.url` はこの設定下で file: URL に
// ならないため使えない）。
const MIGRATION_PATH = resolve(
  process.cwd(),
  '../../packages/shared/drizzle/0052_payment_deadline_kind_and_selected_attachments.sql',
)

describe('migration 0052 — backfill は CHECK 追加より前', () => {
  const sqlText = readFileSync(MIGRATION_PATH, 'utf8')

  it('AC-41: payment_deadline を持つ既存行を fixed へ倒す UPDATE が入っている', () => {
    expect(sqlText).toContain(
      `UPDATE "events" SET "payment_deadline_kind" = 'fixed' WHERE "payment_deadline" IS NOT NULL;`,
    )
  })

  it('AC-41: その UPDATE は CHECK 追加より前にある（逆だと既存行で制約違反）', () => {
    const updateAt = sqlText.indexOf('UPDATE "events" SET "payment_deadline_kind"')
    const checkAt = sqlText.indexOf('events_payment_deadline_kind_consistent')
    expect(updateAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(-1)
    expect(updateAt).toBeLessThan(checkAt)
  })
})

describe('events_payment_deadline_kind_consistent（AC-40）', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  async function insertRaw(paymentDeadline: string | null, kind: string) {
    const group = await createEntryGroup()
    return testDb.insert(events).values({
      entryGroupId: group.id,
      title: 'CHECK 検証',
      eventDate: '2030-01-01',
      kind: 'individual',
      paymentDeadline,
      // 意図的に正規化を通さず生の組み合わせを投げる（DB 側の最終防衛線の確認）。
      paymentDeadlineKind: kind as 'fixed' | 'later_notice' | 'unspecified',
    })
  }

  it('日付ありで fixed は通る', async () => {
    await expect(insertRaw('2030-06-01', 'fixed')).resolves.toBeDefined()
  })

  it('日付なしで later_notice / unspecified は通る', async () => {
    await expect(insertRaw(null, 'later_notice')).resolves.toBeDefined()
    await expect(insertRaw(null, 'unspecified')).resolves.toBeDefined()
  })

  it('日付ありなのに fixed でない組み合わせを拒否する', async () => {
    await expect(insertRaw('2030-06-01', 'later_notice')).rejects.toThrow()
    await expect(insertRaw('2030-06-01', 'unspecified')).rejects.toThrow()
  })

  it('日付なしなのに fixed の組み合わせを拒否する', async () => {
    await expect(insertRaw(null, 'fixed')).rejects.toThrow()
  })
})
