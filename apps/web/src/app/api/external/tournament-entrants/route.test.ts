import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Grade } from '@kagetra/shared/types'
import {
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
import { addDays, todayInJst } from '@/lib/jst-date'
import { getUpcomingEntrants } from '@/lib/upcoming-entrants'
import { GET } from './route'

/**
 * GET /api/external/tournament-entrants（match-tracker 連携の公開契約）。
 *
 * 母集団導出そのものの網羅は `upcoming-entrants.test.ts` が持つ。ここは
 * 契約形（AC-1）・認証（AC-2）・basis→confidence の写像（AC-3〜AC-5,AC-7）・
 * 当月境界（AC-6）・PII ゲート（AC-9）・共有モジュールとの集合一致（AC-10）。
 */

const KEY = 'route-test-external-key'

/** 当月1日（JST）。route が使う since と同じ導出。 */
const monthStart = `${todayInJst().slice(0, 8)}01`
/** 先月末日（当月境界の外）。 */
const lastMonthDay = addDays(monthStart, -1)
/** 未来日（常に母集団内）。 */
const futureDate = addDays(todayInJst(), 30)

interface Body {
  generatedAt: string
  persons: {
    userId: string
    name: string | null
    familyKana: string | null
    givenKana: string | null
    grade: Grade | null
    isGuest: boolean
    entries: {
      eventId: number
      eventDate: string
      displayName: string
      confidence: 'confirmed' | 'hoped'
    }[]
  }[]
}

function request(authorization?: string) {
  return new Request('http://localhost/api/external/tournament-entrants', {
    headers: authorization ? { authorization } : {},
  })
}

async function callApi(): Promise<{ res: Response; body: Body }> {
  const res = await GET(request(`Bearer ${KEY}`))
  const body = (await res.json()) as Body
  return { res, body }
}

async function seedConfirmedRoster(
  entryGroupId: number,
  entries: {
    userId: string | null
    grade?: Grade | null
    status?: 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled' | 'applied'
    selectionOutcome?: 'accepted' | 'waitlisted' | 'rejected' | 'unknown'
  }[],
) {
  const [roster] = await testDb
    .insert(tournamentEntryRosters)
    .values({ entryGroupId, rosterType: 'confirmed', version: 1 })
    .returning()
  for (const e of entries) {
    await testDb.insert(tournamentEntryRosterEntries).values({
      rosterId: roster!.id,
      userId: e.userId,
      grade: e.grade ?? null,
      rawName: 'raw name',
      status: e.status ?? 'confirmed',
      selectionOutcome: e.selectionOutcome ?? 'unknown',
    })
  }
}

describe('GET /api/external/tournament-entrants', () => {
  beforeEach(async () => {
    await truncateAll()
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', KEY)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('AC-1: 有効キーで 200・契約形（人単位・entries は eventDate 昇順・no-store）', async () => {
    const group = await createEntryGroup()
    const day2 = await createEvent({
      title: '契約テスト2日目',
      eventDate: addDays(futureDate, 1),
      entryGroupId: group.id,
    })
    const day1 = await createEvent({
      title: '契約テスト1日目',
      eventDate: futureDate,
      entryGroupId: group.id,
    })
    const member = await createUser({
      name: '契約 太郎',
      grade: 'B',
      familyKana: 'けいやく',
      givenKana: 'たろう',
    })
    // 名簿行の級（C）と現在の級（B）が違うケース: 契約の grade は現在の級。
    await seedConfirmedRoster(group.id, [{ userId: member.id, grade: 'C' }])

    const { res, body } = await callApi()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(body.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/,
    )

    expect(body.persons).toHaveLength(1)
    const person = body.persons[0]!
    expect(person).toEqual({
      userId: member.id,
      name: '契約 太郎',
      familyKana: 'けいやく',
      givenKana: 'たろう',
      grade: 'B',
      isGuest: false,
      entries: [
        {
          eventId: day1.id,
          eventDate: futureDate,
          displayName: '契約テスト1日目',
          confidence: 'confirmed',
        },
        {
          eventId: day2.id,
          eventDate: addDays(futureDate, 1),
          displayName: '契約テスト2日目',
          confidence: 'confirmed',
        },
      ],
    })
  })

  it('AC-2: キー欠落・不一致・env 未設定/空文字は 401 で、本文に会員情報を含まない', async () => {
    const event = await createEvent({ eventDate: futureDate })
    const member = await createUser({ name: '秘匿 太郎', grade: 'B' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const cases: Request[] = [
      request(),
      request(`Bearer wrong-${KEY}`),
      request(KEY),
    ]
    for (const req of cases) {
      const res = await GET(req)
      expect(res.status).toBe(401)
      const text = await res.text()
      expect(text).not.toContain('秘匿')
      expect(text).not.toContain(member.id)
    }

    // env 未設定 → 正しいヘッダ形式でも 401（fail-closed）。
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', undefined)
    expect((await GET(request(`Bearer ${KEY}`))).status).toBe(401)

    // env 空文字 × 空 Bearer → 401（空文字同士の一致で素通りさせない）。
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', '')
    expect((await GET(request('Bearer '))).status).toBe(401)
  })

  it('AC-3: 名簿由来の会員だけが confirmed で載り、補欠・落選・未同定・guest 行は載らない', async () => {
    const group = await createEntryGroup()
    await createEvent({ eventDate: futureDate, entryGroupId: group.id })

    const shussen = await createUser({ name: '出場 太郎', grade: 'C' })
    const hoketsu = await createUser({ name: '補欠 太郎', grade: 'C' })
    const rakusen = await createUser({ name: '落選 太郎', grade: 'C' })
    const stale = await createGuest({ name: '名残 太郎', grade: 'C' })
    await seedConfirmedRoster(group.id, [
      { userId: shussen.id, grade: 'C' },
      { userId: hoketsu.id, grade: 'C', selectionOutcome: 'waitlisted' },
      { userId: rakusen.id, grade: 'C', selectionOutcome: 'rejected' },
      { userId: null, grade: 'C' },
      { userId: stale.id, grade: 'C' },
    ])

    const { body } = await callApi()
    expect(body.persons.map((p) => p.userId)).toEqual([shussen.id])
    expect(body.persons[0]!.entries[0]!.confidence).toBe('confirmed')
  })

  it('AC-4: 確定名簿があるグループでもゲストの attend=true は hoped で合流する', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      eventDate: futureDate,
      eligibleGrades: ['C', 'D'],
      entryGroupId: group.id,
    })
    const member = await createUser({ name: '名簿 太郎', grade: 'C' })
    await seedConfirmedRoster(group.id, [{ userId: member.id, grade: 'C' }])
    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

    const { body } = await callApi()
    const guestPerson = body.persons.find((p) => p.userId === guest.id)
    expect(guestPerson).toBeDefined()
    expect(guestPerson!.isGuest).toBe(true)
    expect(guestPerson!.entries[0]!.confidence).toBe('hoped')
    const memberPerson = body.persons.find((p) => p.userId === member.id)
    expect(memberPerson!.entries[0]!.confidence).toBe('confirmed')
  })

  it('AC-5/AC-8: 確定名簿が無いグループは attend=true ∧ 対象級内（会員・ゲスト）が hoped。attend=false・級外・予定0件の人は載らない', async () => {
    const event = await createEvent({
      eventDate: futureDate,
      eligibleGrades: ['C', 'D'],
    })
    const sanka = await createUser({ name: '参加 太郎', grade: 'C' })
    const guest = await createGuest({ name: '客人 太郎', grade: 'D' })
    const fusanka = await createUser({ name: '不参 太郎', grade: 'C' })
    const kyugai = await createUser({ name: '級外 太郎', grade: 'B' })
    // 出場予定 0 件（回答なし）の会員は persons に現れない（AC-8）。
    await createUser({ name: '無回答 太郎', grade: 'C' })

    await createEventAttendance({ eventId: event.id, userId: sanka.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: fusanka.id, attend: false })
    await createEventAttendance({ eventId: event.id, userId: kyugai.id, attend: true })

    const { body } = await callApi()
    expect(body.persons.map((p) => p.userId).sort()).toEqual(
      [sanka.id, guest.id].sort(),
    )
    for (const p of body.persons) {
      expect(p.entries[0]!.confidence).toBe('hoped')
    }
  })

  it('AC-6: 当月1日(JST)以降だけが対象。先月・団体戦・中止は entries に現れない', async () => {
    const inMonth = await createEvent({ title: '当月内', eventDate: monthStart })
    const future = await createEvent({ title: '未来', eventDate: futureDate })
    const lastMonth = await createEvent({ title: '先月', eventDate: lastMonthDay })
    const team = await createEvent({
      title: '団体戦',
      eventDate: futureDate,
      kind: 'team',
    })
    const cancelled = await createEvent({
      title: '中止',
      eventDate: futureDate,
      status: 'cancelled',
    })
    const member = await createUser({ name: '境界 太郎', grade: 'B' })
    for (const e of [inMonth, future, lastMonth, team, cancelled]) {
      await createEventAttendance({ eventId: e.id, userId: member.id, attend: true })
    }

    const { body } = await callApi()
    const eventIds = body.persons[0]!.entries.map((e) => e.eventId)
    expect(eventIds.sort()).toEqual([inMonth.id, future.id].sort())
  })

  it('AC-7: 名簿と出欠の両方に該当しても同一イベントは 1 件（confirmed が正）', async () => {
    const group = await createEntryGroup()
    const event = await createEvent({
      eventDate: futureDate,
      eligibleGrades: ['C', 'D'],
      entryGroupId: group.id,
    })
    const member = await createUser({ name: '両属 太郎', grade: 'C' })
    await seedConfirmedRoster(group.id, [{ userId: member.id, grade: 'C' }])
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const { body } = await callApi()
    expect(body.persons).toHaveLength(1)
    const entries = body.persons[0]!.entries
    expect(entries).toHaveLength(1)
    expect(entries[0]!.confidence).toBe('confirmed')
  })

  it('AC-9: PII（メール・電話・生年月日・住所）がレスポンスに一切含まれない', async () => {
    const event = await createEvent({ eventDate: futureDate })
    const member = await createUser({
      name: '個情 太郎',
      grade: 'B',
      email: 'pii-test@example.com',
      phone: '090-1234-5678',
      birthDate: '1990-01-23',
      postalCode: '060-0042',
      address1: '札幌市中央区大通西1丁目',
      address2: 'テストビル 101',
    })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })

    const { res, body } = await callApi()
    expect(res.status).toBe(200)
    const text = JSON.stringify(body)
    expect(text).not.toContain('pii-test@example.com')
    expect(text).not.toContain('090-1234-5678')
    expect(text).not.toContain('1990-01-23')
    expect(text).not.toContain('060-0042')
    expect(text).not.toContain('札幌市中央区')
    expect(text).not.toContain('テストビル')

    // 許可キー以外を持たないことの構造的な検証。
    expect(Object.keys(body.persons[0]!).sort()).toEqual(
      ['entries', 'familyKana', 'givenKana', 'grade', 'isGuest', 'name', 'userId'].sort(),
    )
  })

  it('AC-10: （人×イベント）の集合が共有モジュールの出力と一致する', async () => {
    // 確定名簿グループ + 出欠グループ + ゲスト合流を混ぜた状態で突き合わせる。
    const group = await createEntryGroup()
    const rosterEvent = await createEvent({
      eventDate: futureDate,
      eligibleGrades: ['C', 'D'],
      entryGroupId: group.id,
    })
    const member = await createUser({ name: '一致 太郎', grade: 'C' })
    await seedConfirmedRoster(group.id, [{ userId: member.id, grade: 'C' }])
    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
    await createEventAttendance({ eventId: rosterEvent.id, userId: guest.id, attend: true })

    const hopeEvent = await createEvent({ eventDate: addDays(futureDate, 1) })
    const hoper = await createUser({ name: '希望 太郎', grade: 'B' })
    await createEventAttendance({ eventId: hopeEvent.id, userId: hoper.id, attend: true })
    // 0名イベント（persons には現れない）。
    await createEvent({ eventDate: addDays(futureDate, 2) })

    const { body } = await callApi()
    const apiPairs = body.persons
      .flatMap((p) => p.entries.map((e) => `${p.userId}:${e.eventId}`))
      .sort()

    const moduleEvents = await getUpcomingEntrants({ since: monthStart })
    const modulePairs = moduleEvents
      .flatMap((e) => e.entrants.map((en) => `${en.userId}:${e.id}`))
      .sort()

    expect(apiPairs).toEqual(modulePairs)
    expect(apiPairs.length).toBeGreaterThan(0)
  })
})
