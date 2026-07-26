import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  players,
  tournamentConfirmedRosterPublications,
  tournamentEntryRosters,
  tournamentEntryRosterEntries,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createUser, createEvent } from '@/test-utils/seed'
import { materializeRoster, mapEntryStatus, publishConfirmedRoster } from './materialize'
import type { ParsedRoster } from './parser'

function roster(entries: ParsedRoster['entries']): ParsedRoster {
  return { sheetName: 'x', sheetNames: ['x'], entries }
}
function entry(
  rawName: string,
  over: Partial<ParsedRoster['entries'][number]> = {},
): ParsedRoster['entries'][number] {
  return {
    rawName,
    rawKana: null,
    grade: null,
    rawAffiliation: null,
    rawDan: null,
    statusText: null,
    selectionOutcome: 'unknown',
    selectionExempt: false,
    seqNo: null,
    sourceSheetName: 'x',
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
        { entryGroupId: event.entryGroupId, rosterType: 'applicant', revision: { kind: 'initial' } },
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
    expect((await testDb.select().from(players)).find((p) => p.id === taro?.playerId)?.userId).toBe(
      member.id,
    )
    expect(taro?.status).toBe('applied') // applicant 既定
    expect(taro?.grade).toBe('A')
    const jiro = entries.find((e) => e.rawName === '他県次郎')
    expect(jiro?.userId).toBeNull() // 非会員
  })

  it('訂正取込は旧版を保持して対象版だけ supersede する', async () => {
    const event = await createEvent()
    const first = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎'), entry('B次郎')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'initial' },
      }),
    )
    const res2 = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎', { statusText: '繰上' })]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'correction', targetRosterId: first.rosterId },
      }),
    )
    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.entryGroupId, event.entryGroupId))
    expect(rosters).toHaveLength(2)
    expect(rosters.find((r) => r.id === first.rosterId)?.supersededAt).not.toBeNull()
    expect(rosters.find((r) => r.id === res2.rosterId)).toMatchObject({
      version: 2,
      supersedesRosterId: first.rosterId,
      supersededAt: null,
    })
    expect(res2.supersededRosterId).toBe(first.rosterId)
    expect(
      await testDb
        .select()
        .from(tournamentEntryRosterEntries)
        .where(eq(tournamentEntryRosterEntries.rosterId, first.rosterId)),
    ).toHaveLength(2)
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
      materializeRoster(tx, roster([entry('A太郎')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        revision: { kind: 'initial' },
      }),
    )
    await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'initial' },
      }),
    )
    const rosters = await testDb
      .select()
      .from(tournamentEntryRosters)
      .where(eq(tournamentEntryRosters.entryGroupId, event.entryGroupId))
    expect(rosters).toHaveLength(2)
    // player は同一人物で 1 行（get-or-create）
    expect(await testDb.select().from(players)).toHaveLength(1)
  })

  it('追加発表は旧版を supersede せず、selection 情報も版ごとに保持する', async () => {
    const event = await createEvent()
    const first = await testDb.transaction((tx) =>
      materializeRoster(
        tx,
        roster([
          entry('A太郎', {
            grade: 'A',
            selectionOutcome: 'accepted',
            selectionExempt: true,
          }),
        ]),
        { entryGroupId: event.entryGroupId, rosterType: 'confirmed', revision: { kind: 'initial' } },
      ),
    )
    const additional = await testDb.transaction((tx) =>
      materializeRoster(
        tx,
        roster([entry('B次郎', { grade: 'A', selectionOutcome: 'waitlisted' })]),
        { entryGroupId: event.entryGroupId, rosterType: 'confirmed', revision: { kind: 'additional' } },
      ),
    )

    const rosters = await testDb.select().from(tournamentEntryRosters)
    expect(rosters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.rosterId, version: 1, supersededAt: null }),
        expect.objectContaining({ id: additional.rosterId, version: 2, supersededAt: null }),
      ]),
    )
    const entries = await testDb.select().from(tournamentEntryRosterEntries)
    expect(entries.find((row) => row.rawName === 'A太郎')).toMatchObject({
      selectionOutcome: 'accepted',
      selectionExempt: true,
    })
    expect(entries.find((row) => row.rawName === 'B次郎')?.selectionOutcome).toBe('waitlisted')
  })

  it('複数の有効版があっても correction は明示対象だけを supersede する', async () => {
    const event = await createEvent()
    const first = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('初版')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'initial' },
      }),
    )
    const additional = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('追加版')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'additional' },
      }),
    )
    const correction = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('初版の訂正版')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'correction', targetRosterId: first.rosterId },
      }),
    )

    const rosters = await testDb.select().from(tournamentEntryRosters)
    expect(rosters.find((row) => row.id === first.rosterId)?.supersededAt).not.toBeNull()
    expect(rosters.find((row) => row.id === additional.rosterId)?.supersededAt).toBeNull()
    expect(rosters.find((row) => row.id === correction.rosterId)).toMatchObject({
      version: 3,
      supersedesRosterId: first.rosterId,
      supersededAt: null,
    })
  })

  it('正規化名が複数会員へ一致したら player と既存 roster entry のリンクを解除する', async () => {
    const firstMember = await createUser({ name: '山田 太郎' })
    const event = await createEvent()
    const first = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('山田太郎')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        revision: { kind: 'initial' },
      }),
    )
    expect((await testDb.select().from(players))[0]?.userId).toBe(firstMember.id)

    await createUser({ name: '山田太郎' })
    await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('山田 太郎')]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        revision: { kind: 'correction', targetRosterId: first.rosterId },
      }),
    )

    expect((await testDb.select().from(players))[0]?.userId).toBeNull()
    expect(
      (await testDb.select().from(tournamentEntryRosterEntries)).every(
        (row) => row.userId === null,
      ),
    ).toBe(true)
  })

  it('申込名簿を確定用途へ明示利用でき、後日の別発表も併存できる', async () => {
    const [series] = await testDb
      .insert(tournamentSeries)
      .values({ name: '発表テスト系列' })
      .returning()
    const [edition] = await testDb
      .insert(tournamentSeriesEditions)
      .values({ seriesId: series!.id, editionNumber: 1, year: 2030, status: 'held' })
      .returning()
    const event = await createEvent({ editionId: edition!.id })
    const applicant = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('A太郎', { grade: 'A' })]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        revision: { kind: 'initial' },
      }),
    )
    const confirmed = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('B次郎', { grade: 'A' })]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        revision: { kind: 'initial' },
      }),
    )

    await testDb.transaction(async (tx) => {
      await publishConfirmedRoster(tx, {
        editionId: edition!.id,
        grade: 'A',
        rosterId: applicant.rosterId,
        publishedAt: '2030-01-01',
      })
      await publishConfirmedRoster(tx, {
        editionId: edition!.id,
        grade: 'A',
        rosterId: confirmed.rosterId,
        publishedAt: '2030-01-02',
      })
    })

    const publications = await testDb.select().from(tournamentConfirmedRosterPublications)
    expect(publications.map((row) => row.rosterId)).toEqual(
      expect.arrayContaining([applicant.rosterId, confirmed.rosterId]),
    )
  })

  it('同じ名簿の確定発表日を異なる日付で再利用しない', async () => {
    const [series] = await testDb
      .insert(tournamentSeries)
      .values({ name: '発表日競合系列' })
      .returning()
    const [edition] = await testDb
      .insert(tournamentSeriesEditions)
      .values({ seriesId: series!.id, editionNumber: 1, year: 2030, status: 'held' })
      .returning()
    const event = await createEvent({ editionId: edition!.id })
    const applicant = await testDb.transaction((tx) =>
      materializeRoster(tx, roster([entry('発表日太郎', { grade: 'A' })]), {
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        revision: { kind: 'initial' },
      }),
    )

    await testDb.transaction((tx) => publishConfirmedRoster(tx, {
      editionId: edition!.id,
      grade: 'A',
      rosterId: applicant.rosterId,
      publishedAt: '2030-01-01',
    }))

    await expect(testDb.transaction((tx) => publishConfirmedRoster(tx, {
      editionId: edition!.id,
      grade: 'A',
      rosterId: applicant.rosterId,
      publishedAt: '2030-01-02',
    }))).rejects.toThrow('確定発表日が既存データと一致しません')
  })
})
