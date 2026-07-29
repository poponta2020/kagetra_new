import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEvent } from '@/test-utils/seed'

/**
 * grade-entry-fee タスク2: `events.payment_type` の既定値変更と backfill（AC-26 / AC-27）。
 *
 * **なぜ apps/web に置くか**: migration は `packages/shared` にあるが、実 DB を張る
 * テストハーネス（`@/test-utils/db`）は apps/web にしかない。宣言と migration 本文の
 * 静的検査は `packages/shared/__tests__/grade-entry-fee-schema.test.ts` が持つ。
 *
 * **なぜ migration 本文を自前で実行するか**: テスト DB は `drizzle-kit push --force`
 * でスキーマだけを反映しており、migration の本文（UPDATE）は一度も走らない。しかも
 * push 後は DEFAULT が効くので NULL 行がそもそも生まれない。backfill が効くことを
 * 確かめるには、NULL 行を明示的に作って migration の UPDATE 文をそのまま流すしかない。
 */

// vitest の cwd は apps/web（他のテストの fixture 解決と同じ流儀）。
const MIGRATION_PATH = resolve(
  process.cwd(),
  '../../packages/shared/drizzle/0052_tiny_red_hulk.sql',
)

/** migration ファイルから backfill の UPDATE 文だけを取り出す（文面のコピーを避ける）。 */
function backfillStatement(): string {
  const statements = readFileSync(MIGRATION_PATH, 'utf8').split('--> statement-breakpoint')
  const update = statements.find((s) => /UPDATE\s+"events"/i.test(s))
  if (!update) throw new Error('0052 migration に backfill の UPDATE が見つからない')
  return update
}

describe('payment_type の既定値と backfill', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('AC-26: payment_type を省略した新規 INSERT は advance で入る', async () => {
    const event = await createEvent({ title: '既定値の確認' })
    expect(event.paymentType).toBe('advance')
  })

  it('明示的に null を入れれば NULL のまま入る（列は nullable のまま）', async () => {
    const event = await createEvent({ title: '明示 null', paymentType: null })
    expect(event.paymentType).toBeNull()
  })

  it('AC-27: backfill が NULL 行だけを advance にし、既存の onsite / advance は変えない', async () => {
    const nullEvent = await createEvent({ title: 'NULL 行', paymentType: null })
    const onsiteEvent = await createEvent({ title: '現地払い', paymentType: 'onsite' })
    const advanceEvent = await createEvent({ title: '事前払い', paymentType: 'advance' })

    await testDb.execute(sql.raw(backfillStatement()))

    const read = async (id: number) => {
      const [row] = await testDb
        .select({ paymentType: events.paymentType })
        .from(events)
        .where(eq(events.id, id))
      return row?.paymentType ?? null
    }
    expect(await read(nullEvent.id)).toBe('advance')
    expect(await read(onsiteEvent.id)).toBe('onsite')
    expect(await read(advanceEvent.id)).toBe('advance')
  })

  it('AC-27: backfill を2回流しても結果が変わらない（冪等）', async () => {
    const onsiteEvent = await createEvent({ title: '現地払い', paymentType: 'onsite' })
    await testDb.execute(sql.raw(backfillStatement()))
    await testDb.execute(sql.raw(backfillStatement()))
    const [row] = await testDb
      .select({ paymentType: events.paymentType })
      .from(events)
      .where(eq(events.id, onsiteEvent.id))
    expect(row?.paymentType).toBe('onsite')
  })
})
