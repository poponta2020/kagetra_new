import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  players,
  tournamentEntryRosters,
  tournamentEntryRosterEntries,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser, createEvent } from '@/test-utils/seed'
import { materializeRoster, mapEntryStatus } from './materialize'
import type { ParsedRoster } from './parser'

function roster(entries: ParsedRoster['entries']): ParsedRoster {
  return { sheetName: 'x', entries }
}
function entry(rawName: string, over: Partial<ParsedRoster['entries'][number]> = {}) {
  return {
    rawName,
    rawKana: null,
    grade: null,
    rawAffiliation: null,
    rawDan: null,
    statusText: null,
    seqNo: null,
    ...over,
  }
}

describe('mapEntryStatus (pure)', () => {
  it('applicant 既定は applied', () => {
    expect(mapEntryStatus(null, 'applicant')).toBe('applied')
  })
  it('confirmed 既定は confirmed', () => {
    expect(mapEntryStatus(null, 'confirmed')).toBe('confirmed')
  })
  it('繰上→carried_up / 繰上辞退→carry_up_declined / 取消→cancelled / 確定→confirmed', () => {
    expect(mapEntryStatus('繰上', 'confirmed')).toBe('carried_up')
    expect(mapEntryStatus('繰上辞退', 'confirmed')).toBe('carry_up_declined')
    expect(mapEntryStatus('取消', 'confirmed')).toBe('cancelled')
    expect(mapEntryStatus('欠場', 'confirmed')).toBe('cancelled')
    expect(mapEntryStatus('確定', 'applicant')).toBe('confirmed')
  })
  it('「繰り上」表記も正しく判定する（Codex R1 blocker）', () => {
    expect(mapEntryStatus('繰り上げ', 'confirmed')).toBe('carried_up')
    // 「繰り上げ辞退」が carried_up に化けない（辞退を先に評価）
    expect(mapEntryStatus('繰り上げ辞退', 'confirmed')).toBe('carry_up_declined')
    expect(mapEntryStatus('繰り上り不参加', 'confirmed')).toBe('carry_up_declined')
  })
})

describe('materializeRoster', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('roster+entries 作成・player get-or-create・会員突合', async () => {
    const member = await createUser({ name: '札幌太郎' })
    const event = await createEvent()
    const res = await testDb.transaction((tx) =>
      materializeRoster(
        tx,
        roster([
          entry('札幌太郎', { grade: 'A', rawAffiliation: '札幌', seqNo: 1 }),
          entry('他県次郎', { grade: 'B', rawAffiliation: '他県', seqNo: 2 }),
        ]),
        { eventId: event.id, rosterType: 'applicant' },
      ),
    )
    expect(res.entryCount).toBe(2)
    expect(res.matchedUserCount).toBe(1)
    // player は 2 人分 get-or-create
    expect(await testDb.select().from(players)).toHaveLength(2)

    const entries = await testDb
      .select()
      .from(tournamentEntryRosterEntries)
      .where(eq(tournamentEntryRosterEntries.rosterId, res.rosterId))
    expect(entries).toHaveLength(2)
    const taro = entries.find((e) => e.rawName === '札幌太郎')
    expect(taro?.userId).toBe(member.id) // 会員突合
    expect(taro?.playerId).not.toBeNull()
    expect(taro?.status).toBe('applied') // applicant 既定
    expect(taro?.grade).toBe('A')
    const jiro = entries.find((e) => e.rawName === '他県次郎')
    expect(jiro?.userId).toBeNull() // 非会員
  })

  it('再取込は置換（古い名簿/entries は消える）', async () => {
    const event = await createEvent()
    await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎'), entry('B次郎')]), {
        eventId: event.id,
        rosterType: 'confirmed',
      }),
    )
    // 再取込（1 名のみ）
    const res2 = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎', { statusText: '繰上' })]), {
        eventId: event.id,
        rosterType: 'confirmed',
      }),
    )
    // confirmed 名簿は 1 つ（置換）
    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.eventId, event.id))
    expect(rosters).toHaveLength(1)
    expect(rosters[0]?.id).toBe(res2.rosterId)
    const entries = await testDb
      .select()
      .from(tournamentEntryRosterEntries)
      .where(eq(tournamentEntryRosterEntries.rosterId, res2.rosterId))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.status).toBe('carried_up') // 繰上
  })

  it('applicant と confirmed は別名簿として共存できる', async () => {
    const event = await createEvent()
    await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎')]), { eventId: event.id, rosterType: 'applicant' }),
    )
    await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎')]), { eventId: event.id, rosterType: 'confirmed' }),
    )
    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.eventId, event.id))
    expect(rosters).toHaveLength(2)
    // player は同一人物で 1 行（get-or-create）
    expect(await testDb.select().from(players)).toHaveLength(1)
  })
})
