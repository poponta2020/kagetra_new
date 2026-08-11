import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Grade } from '@kagetra/shared/types'
import {
  tournamentEntryRosterEntries,
  tournamentEntryRosters,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * ホーム `/dashboard`「会の出場予定」のサーバー側（母集団・確定/希望の切り替え・
 * チップの級の出所・未回答アラート）。実装手順書 タスク2。
 *
 * 表示の分岐（空状態・もっと見る展開・自分ハイライト）は HomeTimeline.test.tsx、
 * 純関数は home-timeline-utils.test.ts が持つ。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: DashboardPage } = await import('./page')

/** JST today（page.tsx と同じ計算）。 */
function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function renderPage() {
  return render(await DashboardPage())
}

/** 姓が `familyName` の会員を作る（`users.name` は UNIQUE なので名で散らす）。 */
let memberSeq = 0
async function createMember(familyName: string, grade: Grade | null) {
  memberSeq += 1
  return createUser({ name: `${familyName} 太郎${memberSeq}`, grade })
}

/** 大会表示名の行（`<a>`）を取る。 */
function rowOf(displayName: string): HTMLElement {
  const anchor = screen.getByText(displayName).closest('a')
  if (!anchor) throw new Error(`row not found: ${displayName}`)
  return anchor
}

/** 未回答アラート行（朱の行）。「未回答」バッジを持つ `<a>` を上から順に返す。 */
function alertRows(): HTMLElement[] {
  return screen.queryAllByText('未回答').map((el) => {
    const anchor = el.closest('a')
    if (!anchor) throw new Error('alert row not found')
    return anchor
  })
}

/** 通称つきの edition を 1 件作って返す。 */
async function seedEditionWithShortName(shortName: string) {
  const [series] = await testDb
    .insert(tournamentSeries)
    .values({ name: `${shortName}大会シリーズ`, shortName })
    .returning()
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({ seriesId: series!.id, editionNumber: 1, status: 'held' })
    .returning()
  return edition!
}

/** 確定名簿を 1 版作り、行を積む。 */
async function seedConfirmedRoster(
  entryGroupId: number,
  entries: {
    userId: string
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
  return roster!
}

describe('/dashboard（会の出場予定）', () => {
  beforeEach(async () => {
    await truncateAll()
    memberSeq = 0
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('認可', () => {
    it('未ログインは /403 へリダイレクトされる', async () => {
      await setAuthSession(null)
      await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/403')
    })

    it('セッションはあるが会員未紐付け（user.id なし）は /403 へリダイレクトされる', async () => {
      const { auth } = (await import('@/auth')) as unknown as {
        auth: ReturnType<typeof vi.fn>
      }
      auth.mockResolvedValue({
        user: { role: 'member', lineUserId: 'U-unbound' },
        expires: new Date(Date.now() + 60_000).toISOString(),
      })
      await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/403')
    })

    // guest-role AC-9: middleware の早期ゲート（Edge・stale になりうる）に
    // 加えた Node 側の実防御。
    it('ゲストは /403 へリダイレクトされる', async () => {
      const guest = await createGuest()
      await setAuthSession({ id: guest.id, role: 'guest' })
      await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/403')
    })
  })

  describe('確定名簿がある大会（確定パス）', () => {
    it('確定ピルが出て、補欠・落選・繰上り辞退・取消は出場者に含まれない', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      const shussen = await createMember('出場', 'C')
      const kuriage = await createMember('繰上', 'D')
      const hoketsu = await createMember('補欠', 'C')
      const rakusen = await createMember('落選', 'D')
      const jitai = await createMember('辞退', 'C')
      const torikeshi = await createMember('取消', 'D')

      await seedConfirmedRoster(group.id, [
        { userId: shussen.id, grade: 'C', status: 'confirmed' },
        { userId: kuriage.id, grade: 'D', status: 'carried_up' },
        {
          userId: hoketsu.id,
          grade: 'C',
          status: 'confirmed',
          selectionOutcome: 'waitlisted',
        },
        {
          userId: rakusen.id,
          grade: 'D',
          status: 'confirmed',
          selectionOutcome: 'rejected',
        },
        { userId: jitai.id, grade: 'C', status: 'carry_up_declined' },
        { userId: torikeshi.id, grade: 'D', status: 'cancelled' },
      ])

      await renderPage()

      const row = rowOf(event.title)
      expect(row.textContent).toContain('確定')
      expect(row.textContent).not.toContain('希望')
      expect(row.textContent).toContain('出場C')
      expect(row.textContent).toContain('繰上D')
      expect(row.textContent).not.toContain('補欠')
      expect(row.textContent).not.toContain('落選')
      expect(row.textContent).not.toContain('辞退')
      expect(row.textContent).not.toContain('取消')
      // 人数は出場する 2 名だけ
      expect(row.textContent).toContain('2')
    })

    it('昇級して対象級外になった会員も名簿に載っていれば残り、チップの級は名簿行の grade になる', async () => {
      const viewer = await createUser({ grade: 'A' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      // C 級で申し込んだあと B 級へ昇級した会員（users.grade が eligible_grades 外）。
      const shokyu = await createMember('昇級', 'B')
      await seedConfirmedRoster(group.id, [
        { userId: shokyu.id, grade: 'C', status: 'confirmed' },
      ])

      await renderPage()

      const row = rowOf(event.title)
      // 名簿に載っている以上ホームからも消えない
      expect(row.textContent).toContain('昇級')
      // 級は「その大会で出る級」= 名簿行の C。現在の users.grade（B）ではない
      expect(row.textContent).toContain('昇級C')
      expect(row.textContent).not.toContain('昇級B')
    })

    it('名簿行の grade が null のときだけ users.grade へフォールバックする', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      const kyuunashi = await createMember('級無', 'D')
      await seedConfirmedRoster(group.id, [
        { userId: kyuunashi.id, grade: null, status: 'confirmed' },
      ])

      await renderPage()
      expect(rowOf(event.title).textContent).toContain('級無D')
    })

    it('会員として同定できていない名簿行（user_id が null）は出場者に含まれない', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      const member = await createMember('会員', 'C')
      const [roster] = await testDb
        .insert(tournamentEntryRosters)
        .values({ entryGroupId: group.id, rosterType: 'confirmed', version: 1 })
        .returning()
      await testDb.insert(tournamentEntryRosterEntries).values([
        {
          rosterId: roster!.id,
          userId: member.id,
          grade: 'C',
          rawName: '会員 太郎',
          status: 'confirmed',
        },
        {
          rosterId: roster!.id,
          userId: null,
          grade: 'C',
          rawName: '他会 花子',
          status: 'confirmed',
        },
      ])

      await renderPage()
      const row = rowOf(event.title)
      expect(row.textContent).toContain('会員C')
      expect(row.textContent).not.toContain('他会')
      expect(row.textContent).toContain('1')
    })

    // guest-role AC-22（回帰込み）: 確定名簿はゲストを構造的に含まないので、
    // ゲストは attend=true から別に合流する。会員は名簿ベースのまま変わらない。
    it('確定名簿があっても attend=true のゲストがゲスト印つきで合流し、会員は名簿ベースのまま変わらない', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      const meibo = await createMember('名簿', 'C')
      await seedConfirmedRoster(group.id, [
        { userId: meibo.id, grade: 'C', status: 'confirmed' },
      ])

      // ★合流が「ゲストだけ」であることの決め手。抽選に落ちた（＝確定名簿に
      // 載らなかった）会員は attend=true のまま残るので、合流を role で絞らず
      // 「名簿に居ない attend=true」で拾うと、この会員が確定パスに復活して
      // しまう。AC-22 の後半（会員は名簿ベースのまま変わらない）はこの行が
      // 無いと素通りする。
      const rakusen = await createMember('落選', 'C')
      await createEventAttendance({
        eventId: event.id,
        userId: rakusen.id,
        attend: true,
      })

      const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
      await createEventAttendance({
        eventId: event.id,
        userId: guest.id,
        attend: true,
      })

      await renderPage()
      const row = rowOf(event.title)
      expect(row.textContent).toContain('確定')
      // 会員は名簿ベースのまま（ゲスト印は付かない）
      expect(row.textContent).toContain('名簿C')
      // 落選した会員は attend=true でも確定パスには現れない
      expect(row.textContent).not.toContain('落選')
      // ゲストは出欠回答から合流し、ゲスト印が付く
      expect(row.textContent).toContain('客人Cゲスト')
      // 人数は名簿1名 + ゲスト1名の2名（落選会員は数えない）
      expect(row.textContent).toContain('2')
    })

    it('差し替え済み（superseded）の確定名簿は使わず、希望へフォールバックする', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const group = await createEntryGroup()
      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        entryGroupId: group.id,
      })

      const oldOne = await createMember('旧版', 'C')
      const hoping = await createMember('希望', 'C')
      const [roster] = await testDb
        .insert(tournamentEntryRosters)
        .values({
          entryGroupId: group.id,
          rosterType: 'confirmed',
          version: 1,
          supersededAt: new Date(),
        })
        .returning()
      await testDb.insert(tournamentEntryRosterEntries).values({
        rosterId: roster!.id,
        userId: oldOne.id,
        grade: 'C',
        rawName: '旧版 太郎',
        status: 'confirmed',
      })
      await createEventAttendance({
        eventId: event.id,
        userId: hoping.id,
        attend: true,
      })

      await renderPage()
      const row = rowOf(event.title)
      expect(row.textContent).toContain('希望')
      expect(row.textContent).toContain('希望C')
      expect(row.textContent).not.toContain('旧版')
    })
  })

  describe('確定名簿が無い大会（希望フォールバック）', () => {
    it('出欠 attend=true が出場者になり、希望ピルが出る', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
      })

      const yes = await createMember('参加', 'C')
      const no = await createMember('不参', 'D')
      await createEventAttendance({ eventId: event.id, userId: yes.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: no.id, attend: false })

      await renderPage()

      const row = rowOf(event.title)
      expect(row.textContent).toContain('希望')
      expect(row.textContent).not.toContain('確定')
      expect(row.textContent).toContain('参加C')
      expect(row.textContent).not.toContain('不参')
    })

    // guest-role AC-21: 確定名簿が無いグループ（希望パス）ではゲストも
    // 会員と同じ出欠回答から拾われ、ゲスト印つきで載る。
    it('出欠 attend=true のゲストがゲスト印つきで載る', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
      })

      const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
      await createEventAttendance({
        eventId: event.id,
        userId: guest.id,
        attend: true,
      })

      await renderPage()
      const row = rowOf(event.title)
      expect(row.textContent).toContain('希望')
      expect(row.textContent).toContain('客人Cゲスト')
    })

    it('対象級外の stale な attend=true は除外される（希望パスのみの絞り）', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const event = await createEvent({
        title: '石狩CD',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
      })

      const target = await createMember('対象', 'C')
      const stale = await createMember('級外', 'B')
      const notInvited = await createUser({
        name: '未招 太郎',
        grade: 'C',
        isInvited: false,
      })
      await createEventAttendance({ eventId: event.id, userId: target.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: stale.id, attend: true })
      await createEventAttendance({
        eventId: event.id,
        userId: notInvited.id,
        attend: true,
      })

      await renderPage()

      const row = rowOf(event.title)
      expect(row.textContent).toContain('対象C')
      expect(row.textContent).not.toContain('級外')
      expect(row.textContent).not.toContain('未招')
    })

    it('eligible_grades が空/null なら級で絞らない（招待済み全員が対象）', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const event = await createEvent({
        title: '級指定なし大会',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: null,
      })
      const anyGrade = await createMember('全級', 'E')
      await createEventAttendance({
        eventId: event.id,
        userId: anyGrade.id,
        attend: true,
      })

      await renderPage()
      expect(rowOf(event.title).textContent).toContain('全級E')
    })
  })

  describe('母集団', () => {
    it('出場者 0 名の大会はホームに載らない', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      await createEvent({
        title: '誰も出ない大会',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C'],
      })

      await renderPage()
      expect(screen.queryByText('誰も出ない大会')).toBeNull()
      expect(screen.getByText('出場予定の大会はありません')).toBeTruthy()
    })

    it('団体戦・中止・過去開催は載らない', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })
      const today = todayJst()

      const member = await createMember('出場', 'C')
      for (const [title, overrides] of [
        ['団体戦大会', { kind: 'team' as const, eventDate: addDays(today, 5) }],
        ['中止大会', { status: 'cancelled' as const, eventDate: addDays(today, 5) }],
        ['過去大会', { eventDate: addDays(today, -1) }],
      ] as const) {
        const e = await createEvent({ title, eligibleGrades: ['C'], ...overrides })
        await createEventAttendance({
          eventId: e.id,
          userId: member.id,
          attend: true,
        })
      }

      await renderPage()
      expect(screen.queryByText('団体戦大会')).toBeNull()
      expect(screen.queryByText('中止大会')).toBeNull()
      expect(screen.queryByText('過去大会')).toBeNull()
    })

    it('通称が引ければ「通称 + 対象級」、引けなければ title を出す', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })

      const edition = await seedEditionWithShortName('石狩')
      const withShortName = await createEvent({
        title: '第10回石狩かるた大会（C・D級）',
        eventDate: addDays(todayJst(), 5),
        eligibleGrades: ['C', 'D'],
        editionId: edition.id,
      })
      const withoutEdition = await createEvent({
        title: '多摩A',
        eventDate: addDays(todayJst(), 6),
        eligibleGrades: ['A'],
      })

      const c = await createMember('丙級', 'C')
      const a = await createMember('甲級', 'A')
      await createEventAttendance({
        eventId: withShortName.id,
        userId: c.id,
        attend: true,
      })
      await createEventAttendance({
        eventId: withoutEdition.id,
        userId: a.id,
        attend: true,
      })

      await renderPage()
      expect(screen.getByText('石狩CD')).toBeTruthy()
      expect(screen.getByText('多摩A')).toBeTruthy()
    })

    it('今日開催は今日カードへ、明日以降はタイムラインへ振り分ける', async () => {
      const viewer = await createUser({ grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })
      const today = todayJst()

      const todayEvent = await createEvent({
        title: '本日大会',
        eventDate: today,
        location: '市民体育センター',
        eligibleGrades: ['C'],
      })
      const futureEvent = await createEvent({
        title: '未来大会',
        eventDate: addDays(today, 3),
        eligibleGrades: ['C'],
      })
      const member = await createMember('出場', 'C')
      await createEventAttendance({
        eventId: todayEvent.id,
        userId: member.id,
        attend: true,
      })
      await createEventAttendance({
        eventId: futureEvent.id,
        userId: member.id,
        attend: true,
      })

      await renderPage()
      // 今日カードにだけ「本日」帯と会場が出る
      expect(screen.getByText('本日')).toBeTruthy()
      expect(rowOf('本日大会').textContent).toContain('市民体育センター')
      expect(rowOf('未来大会').textContent).not.toContain('市民体育センター')
    })
  })

  describe('未回答アラート', () => {
    /** 自分の級が対象・基準締切が `daysLeft` 日後の大会を 1 件作る。 */
    async function seedAlertEvent(
      title: string,
      daysLeft: number,
      overrides: Parameters<typeof createEvent>[0] = {},
    ) {
      const today = todayJst()
      return createEvent({
        title,
        eventDate: addDays(today, 30),
        eligibleGrades: ['C'],
        internalDeadline: addDays(today, daysLeft),
        ...overrides,
      })
    }

    beforeEach(async () => {
      const viewer = await createUser({ name: '閲覧 太郎', grade: 'C' })
      await setAuthSession({ id: viewer.id, role: 'member' })
    })

    it('7日前・当日は出る／8日前・締切超過は出ない', async () => {
      await seedAlertEvent('8日前大会', 8)
      await seedAlertEvent('7日前大会', 7)
      await seedAlertEvent('当日大会', 0)
      await seedAlertEvent('超過大会', -1)

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts.some((t) => t.includes('7日前大会'))).toBe(true)
      expect(texts.some((t) => t.includes('当日大会'))).toBe(true)
      expect(texts.some((t) => t.includes('8日前大会'))).toBe(false)
      expect(texts.some((t) => t.includes('超過大会'))).toBe(false)
    })

    it('回答済み（不参加を含む）の大会は出ない', async () => {
      const { auth } = (await import('@/auth')) as unknown as {
        auth: ReturnType<typeof vi.fn>
      }
      const viewerId = (await auth()).user.id as string

      const answeredYes = await seedAlertEvent('参加回答済み', 3)
      const answeredNo = await seedAlertEvent('不参加回答済み', 3)
      await seedAlertEvent('未回答大会', 3)
      await createEventAttendance({
        eventId: answeredYes.id,
        userId: viewerId,
        attend: true,
      })
      await createEventAttendance({
        eventId: answeredNo.id,
        userId: viewerId,
        attend: false,
      })

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts.some((t) => t.includes('未回答大会'))).toBe(true)
      expect(texts.some((t) => t.includes('参加回答済み'))).toBe(false)
      expect(texts.some((t) => t.includes('不参加回答済み'))).toBe(false)
    })

    it('自分の級が対象外の大会は出ない（級指定なしは出る）', async () => {
      await seedAlertEvent('対象外大会', 3, { eligibleGrades: ['A', 'B'] })
      await seedAlertEvent('級指定なし大会', 3, { eligibleGrades: null })

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts.some((t) => t.includes('級指定なし大会'))).toBe(true)
      expect(texts.some((t) => t.includes('対象外大会'))).toBe(false)
    })

    it('会内締切が無ければ大会申込締切で代替し、どちらも無ければ出ない', async () => {
      const today = todayJst()
      await createEvent({
        title: '本締切のみ大会',
        eventDate: addDays(today, 30),
        eligibleGrades: ['C'],
        internalDeadline: null,
        entryDeadline: addDays(today, 2),
      })
      await createEvent({
        title: '締切なし大会',
        eventDate: addDays(today, 30),
        eligibleGrades: ['C'],
      })

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts.some((t) => t.includes('本締切のみ大会'))).toBe(true)
      expect(texts.some((t) => t.includes('締切なし大会'))).toBe(false)
    })

    // アラートは「自分が手を動かす必要がある」状態表示なので、回答できない人には
    // 出さない。回答可否の判定は `/events/[id]` の canRespond / submitAttendance と
    // 揃える（一般会員は is_invited 必須・管理者はバイパス）。
    it('is_invited=false の一般会員にはアラートを出さない（回答できないため）', async () => {
      const notInvited = await createUser({
        name: '未招 太郎',
        grade: 'C',
        isInvited: false,
      })
      await setAuthSession({ id: notInvited.id, role: 'member' })
      await seedAlertEvent('未回答大会', 3)

      await renderPage()
      expect(alertRows()).toHaveLength(0)
    })

    it('is_invited=false でも管理者・副管理者にはアラートを出す（回答をバイパスできるため）', async () => {
      for (const role of ['admin', 'vice_admin'] as const) {
        await truncateAll()
        const admin = await createUser({
          name: `管理 ${role}`,
          grade: 'C',
          role,
          isInvited: false,
        })
        await setAuthSession({ id: admin.id, role })
        await seedAlertEvent('未回答大会', 3)

        const { unmount } = await renderPage()
        const texts = alertRows().map((r) => r.textContent ?? '')
        expect(texts.some((t) => t.includes('未回答大会'))).toBe(true)
        unmount()
      }
    })

    it('出場者 0 名でアラートは出る（タイムラインに載らない大会でも鳴らす）', async () => {
      await seedAlertEvent('誰も答えていない大会', 3)

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts.some((t) => t.includes('誰も答えていない大会'))).toBe(true)
      // タイムライン側は空のまま（出場者 0 名なので載らない）
      expect(screen.getByText('出場予定の大会はありません')).toBeTruthy()
    })

    it('基準締切の早い順に並ぶ', async () => {
      await seedAlertEvent('後の締切大会', 5)
      await seedAlertEvent('先の締切大会', 1)

      await renderPage()
      const texts = alertRows().map((r) => r.textContent ?? '')
      expect(texts).toHaveLength(2)
      expect(texts[0]).toContain('先の締切大会')
      expect(texts[1]).toContain('後の締切大会')
    })
  })
})
