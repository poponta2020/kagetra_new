import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  tournamentEntryRosters,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// 申込管理ボードのサーバー側（母集団・通称・参加希望者数・確定名簿の有無・認可）。
// 仕分けそのものは entry-board-utils.test.ts、描画は EntryBoardClient.test.tsx が持つ。

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: EntryManagementPage } = await import('./page')

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
  const ui = await EntryManagementPage()
  return render(ui)
}

/** 指定イベントに attend=true の出欠を n 件積む。 */
async function seedAttendees(eventId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const user = await createUser()
    await createEventAttendance({ eventId, userId: user.id, attend: true })
  }
}

/** 通称つきの edition を 1 件作って返す。 */
async function seedEditionWithShortName(shortName: string, editionNumber: number) {
  const [series] = await testDb
    .insert(tournamentSeries)
    .values({ name: `${shortName}大会シリーズ`, shortName })
    .returning()
  const [edition] = await testDb
    .insert(tournamentSeriesEditions)
    .values({ seriesId: series!.id, editionNumber, status: 'held' })
    .returning()
  return edition!
}

/** 区画見出しの h2 からその <section> を取る。 */
function sectionOf(label: string): HTMLElement {
  const section = screen
    .getByRole('heading', { name: label })
    .closest('section')
  if (!section) throw new Error(`section not found for ${label}`)
  return section
}

describe('/admin/entries（申込管理ボード）', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('認可（AC-1）', () => {
    // 閲覧は全員に開放済み（表示専用ボードなので role で絞らない）。
    it('一般会員も開ける', async () => {
      const member = await createUser({ role: 'member' })
      await setAuthSession({ id: member.id, role: 'member' })
      await renderPage()
      expect(screen.getByRole('heading', { name: '申込管理' })).toBeTruthy()
    })

    it('未ログインは /403 へリダイレクトされる', async () => {
      await setAuthSession(null)
      await expect(EntryManagementPage()).rejects.toThrow('NEXT_REDIRECT:/403')
    })

    it('admin は開ける', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      await renderPage()
      expect(screen.getByRole('heading', { name: '申込管理' })).toBeTruthy()
    })

    it('vice_admin も開ける', async () => {
      const vice = await createUser({ role: 'vice_admin' })
      await setAuthSession({ id: vice.id, role: 'vice_admin' })
      await renderPage()
      expect(screen.getByRole('heading', { name: '申込管理' })).toBeTruthy()
    })
  })

  describe('母集団（AC-4）', () => {
    beforeEach(async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
    })

    it('団体戦・中止・過去開催はどの区画にも現れない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const target = await createEvent({
        title: '対象大会',
        eventDate: future,
        internalDeadline: future,
        kind: 'individual',
      })
      await createEvent({
        title: '団体戦大会',
        eventDate: future,
        internalDeadline: future,
        kind: 'team',
      })
      await createEvent({
        title: '中止大会',
        eventDate: future,
        internalDeadline: future,
        status: 'cancelled',
      })
      await createEvent({
        title: '過去大会',
        eventDate: addDays(today, -1),
        internalDeadline: addDays(today, -10),
      })

      await renderPage()

      expect(screen.getByText('対象大会')).toBeTruthy()
      expect(screen.queryByText('団体戦大会')).toBeNull()
      expect(screen.queryByText('中止大会')).toBeNull()
      expect(screen.queryByText('過去大会')).toBeNull()
      // 対象大会が「締切前」に入っている（母集団に載ったことの確認）
      expect(
        within(sectionOf('締切前')).getByText('対象大会'),
      ).toBeTruthy()
      expect(target.id).toBeGreaterThan(0)
    })

    it('開催日が今日の大会は残る（翌日から消える）', async () => {
      const today = todayJst()
      await createEvent({
        title: '本日開催',
        eventDate: today,
        internalDeadline: today,
      })
      await renderPage()
      expect(screen.getByText('本日開催')).toBeTruthy()
    })

    it('AC-5: not_applying と「締切超過かつ出欠 0 名」は現れない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      await createEvent({
        title: '見送り大会',
        eventDate: future,
        internalDeadline: future,
        entryStatus: 'not_applying',
      })
      await createEvent({
        title: '締切超過0名',
        eventDate: future,
        internalDeadline: addDays(today, -1),
        entryStatus: 'not_applied',
      })
      // 対比: 締切超過でも出欠 1 名なら「要対応」に出る
      const alive = await createEvent({
        title: '締切超過1名',
        eventDate: future,
        internalDeadline: addDays(today, -1),
        entryDeadline: addDays(today, 2),
        entryStatus: 'not_applied',
      })
      await seedAttendees(alive.id, 1)

      await renderPage()

      expect(screen.queryByText('見送り大会')).toBeNull()
      expect(screen.queryByText('締切超過0名')).toBeNull()
      expect(within(sectionOf('要対応')).getByText('締切超過1名')).toBeTruthy()
    })
  })

  describe('表示データ', () => {
    beforeEach(async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
    })

    // AC-16: 大会名は通称 + 級。edition 未紐付けは正式名称にフォールバックする。
    it('AC-16: edition 紐付けありは通称+級、なしは title にフォールバックする', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      const edition = await seedEditionWithShortName('札幌', 6)

      await createEvent({
        title: '第6回札幌大会 A級B級',
        eventDate: future,
        internalDeadline: future,
        editionId: edition.id,
        eligibleGrades: ['A', 'B'],
      })
      await createEvent({
        title: '通称なし大会',
        eventDate: future,
        internalDeadline: future,
        editionId: null,
      })

      await renderPage()

      expect(screen.getByText('札幌AB')).toBeTruthy()
      expect(screen.queryByText('第6回札幌大会 A級B級')).toBeNull()
      expect(screen.getByText('通称なし大会')).toBeTruthy()
    })

    // AC-17: 参加希望者数は attend=true の素通し件数（/events 一覧と同じ）。
    // 対象級・isInvited では絞らない。
    it('AC-17: 参加希望者数は attend=true の素通し件数', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      const event = await createEvent({
        title: '人数集計大会',
        eventDate: future,
        internalDeadline: future,
        eligibleGrades: ['A'],
      })
      // 対象級外（E 級）・未招待も数える
      const a = await createUser({ grade: 'A' })
      const e = await createUser({ grade: 'E' })
      const notInvited = await createUser({ grade: 'B', isInvited: false })
      const absent = await createUser({ grade: 'A' })
      await createEventAttendance({ eventId: event.id, userId: a.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: e.id, attend: true })
      await createEventAttendance({
        eventId: event.id,
        userId: notInvited.id,
        attend: true,
      })
      await createEventAttendance({
        eventId: event.id,
        userId: absent.id,
        attend: false,
      })

      await renderPage()

      // 通称が引けない大会は title をそのまま表示（級は連結しない。Issue #335）
      const row = screen.getByText('人数集計大会').closest('a')
      expect(row?.textContent).toContain('（3名）')
    })

    // AC-13: 確定名簿の判定は roster_type='confirmed' かつ superseded_at IS NULL。
    // 申込者名簿・差し替え済みの版では true にならない。
    it('AC-13: applicant 名簿や superseded 済みでは確定名簿ありと判定しない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const applicantOnly = await createEvent({
        title: '申込者名簿のみ',
        eventDate: future,
        entryStatus: 'applied',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: applicantOnly.entryGroupId,
        rosterType: 'applicant',
      })

      const supersededOnly = await createEvent({
        title: '差し替え済み確定名簿',
        eventDate: future,
        entryStatus: 'applied',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: supersededOnly.entryGroupId,
        rosterType: 'confirmed',
        supersededAt: new Date(),
      })

      const confirmed = await createEvent({
        title: '有効な確定名簿',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: confirmed.entryGroupId,
        rosterType: 'confirmed',
      })

      await renderPage()

      const waiting = sectionOf('申込済み・抽選待ち')
      expect(within(waiting).getByText('申込者名簿のみ')).toBeTruthy()
      expect(within(waiting).getByText('差し替え済み確定名簿')).toBeTruthy()
      expect(
        within(sectionOf('名簿確定・振込待ち')).getByText('有効な確定名簿'),
      ).toBeTruthy()
    })

    it('複数版のうち superseded_at IS NULL が 1 つでもあれば確定名簿ありと判定する', async () => {
      const today = todayJst()
      const event = await createEvent({
        title: '版が2つある大会',
        eventDate: addDays(today, 10),
        entryStatus: 'applied',
        paymentType: 'onsite',
      })
      await testDb.insert(tournamentEntryRosters).values([
        { entryGroupId: event.entryGroupId, rosterType: 'confirmed', version: 1, supersededAt: new Date() },
        { entryGroupId: event.entryGroupId, rosterType: 'confirmed', version: 2 },
      ])

      await renderPage()

      expect(within(sectionOf('完了')).getByText('版が2つある大会')).toBeTruthy()
    })
  })

  describe('空状態（AC-25）', () => {
    beforeEach(async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
    })

    it('母集団 0 件なら画面全体の空状態を出す', async () => {
      await renderPage()
      expect(screen.getByText('管理対象の大会はありません')).toBeTruthy()
      expect(screen.queryByRole('heading', { name: '締切前' })).toBeNull()
    })

    it('大会はあるが全件が非表示条件に該当するときも空状態を出す', async () => {
      const today = todayJst()
      await createEvent({
        title: '見送り大会',
        eventDate: addDays(today, 10),
        entryStatus: 'not_applying',
      })
      await createEvent({
        title: '締切超過0名',
        eventDate: addDays(today, 10),
        internalDeadline: addDays(today, -1),
        entryStatus: 'not_applied',
      })

      await renderPage()

      expect(screen.getByText('管理対象の大会はありません')).toBeTruthy()
    })

    it('1 件でも残れば 5 区画すべてが描画される', async () => {
      const today = todayJst()
      await createEvent({
        title: '残る大会',
        eventDate: addDays(today, 10),
        internalDeadline: addDays(today, 5),
      })

      await renderPage()

      for (const label of [
        '締切前',
        '要対応',
        '申込済み・抽選待ち',
        '名簿確定・振込待ち',
        '完了',
      ]) {
        expect(screen.getByRole('heading', { name: label })).toBeTruthy()
      }
      expect(screen.queryByText('管理対象の大会はありません')).toBeNull()
    })
  })

  // タスク6（AC-14/AC-15）: entry_group_id が同じ複数日は 1 グループ=1カードに
  // 集約されて描画される。母集団クエリの entryGroupId の取り回し自体を固定する。
  describe('申込グループのカード集約（AC-14, AC-15）', () => {
    beforeEach(async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
    })

    it('同じ entry_group_id の複数日は1枚のカードにまとまり、代表イベントへのリンクを持つ', async () => {
      const today = todayJst()
      const group = await createEntryGroup()
      const nearer = await createEvent({
        entryGroupId: group.id,
        title: '多摩A',
        eligibleGrades: ['A'],
        eventDate: addDays(today, 5), // 今日以降で最も近い → 代表
        internalDeadline: addDays(today, 3),
      })
      await createEvent({
        entryGroupId: group.id,
        title: '多摩B',
        eligibleGrades: ['B'],
        eventDate: addDays(today, 12),
        internalDeadline: addDays(today, 3),
      })

      await renderPage()

      const section = sectionOf('締切前')
      // グループ表示名（多摩A+多摩B → 多摩AB）は1回だけ
      expect(within(section).getAllByText('多摩AB')).toHaveLength(1)
      const headerLink = within(section).getByText('多摩AB').closest('a')
      expect(headerLink?.getAttribute('href')).toBe(`/events/${nearer.id}`)
    })

    // r3 review should_fix: 表示名・代表イベントはボードの表示対象（今日以降・
    // 非 cancelled・individual）ではなく**グループの全イベント**から導出する。
    // でないと過去日や cancelled を含むグループでボードだけ別名・別リンクになる。
    it('r3: 表示対象外の日（過去日）を含むグループでも、名前はグループ全体から導出する', async () => {
      const today = todayJst()
      const group = await createEntryGroup()
      // 過去日 = ボードの母集団（eventDate >= today）に入らない。
      await createEvent({
        entryGroupId: group.id,
        title: '多摩A',
        eligibleGrades: ['A'],
        eventDate: addDays(today, -10),
        internalDeadline: addDays(today, -20),
      })
      const nearer = await createEvent({
        entryGroupId: group.id,
        title: '多摩B',
        eligibleGrades: ['B'],
        eventDate: addDays(today, 5), // 今日以降で最も近い → 代表
        internalDeadline: addDays(today, 3),
      })
      await createEvent({
        entryGroupId: group.id,
        title: '多摩C',
        eligibleGrades: ['C'],
        eventDate: addDays(today, 12),
        internalDeadline: addDays(today, 3),
      })

      await renderPage()

      const section = sectionOf('締切前')
      // 表示されるのは B・C の2日だが、名前は非表示の A も含めた「多摩ABC」。
      // （表示対象だけから導出していた頃は「多摩BC」になっていた）
      expect(within(section).getAllByText('多摩ABC')).toHaveLength(1)
      expect(within(section).queryByText('多摩BC')).toBeNull()
      // 代表イベントは今日以降で最も近い日 = 多摩B。
      const headerLink = within(section).getByText('多摩ABC').closest('a')
      expect(headerLink?.getAttribute('href')).toBe(`/events/${nearer.id}`)
    })
  })

  describe('行の遷移先（AC-26）', () => {
    it('行が /events/[id] へのリンクになっている', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const today = todayJst()
      const event = await createEvent({
        title: 'リンク確認大会',
        eventDate: addDays(today, 10),
        internalDeadline: addDays(today, 5),
      })

      await renderPage()

      const row = screen.getByText('リンク確認大会').closest('a')
      expect(row?.getAttribute('href')).toBe(`/events/${event.id}`)
    })
  })
})
