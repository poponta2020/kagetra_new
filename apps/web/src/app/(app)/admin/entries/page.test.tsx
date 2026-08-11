import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  mailAttachments,
  mailMessages,
  tournamentEntryRosterFiles,
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
  createGuest,
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

/**
 * roster-file-adoption: グループへ「原本ファイル採用」を 1 件積む。
 * ファイル実体は複製せず mail_attachments を正とするので、添付も一緒に作る。
 */
async function seedRosterFile(
  entryGroupId: number,
  rosterType: 'applicant' | 'confirmed',
  filename: string,
  /** 取込単位。null（既定）= グループ統一 / 配列 = 級別採用。 */
  grades: ('A' | 'B' | 'C' | 'D' | 'E')[] | null = null,
) {
  const [mail] = await testDb
    .insert(mailMessages)
    .values({
      messageId: `<roster-file-${crypto.randomUUID()}@kagetra.test>`,
      fromAddress: 'organizer@example.com',
      toAddresses: ['kagetra@example.com'],
      subject: '名簿送付',
      receivedAt: new Date(),
    })
    .returning()
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mail!.id,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 3,
      data: Buffer.from('xls'),
    })
    .returning()
  await testDb.insert(tournamentEntryRosterFiles).values({
    entryGroupId,
    rosterType,
    grades,
    sourceAttachmentId: attachment!.id,
    sourceMailMessageId: mail!.id,
  })
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

    // role 判定を外したことでガードの境界は `session.user.id` の有無だけに
    // なった。LINE ログイン済みだが会員行に未紐付け（JWT に id が入らない）
    // セッションを直接組んで、ガードが `!session` だけに弱まっていないことを
    // 固定する。setAuthSession は id 必須なので auth モックを直に使う。
    it('セッションはあるが会員未紐付け（user.id なし）は /403 へリダイレクトされる', async () => {
      const { auth } = (await import('@/auth')) as unknown as {
        auth: ReturnType<typeof vi.fn>
      }
      auth.mockResolvedValue({
        user: { role: 'member', lineUserId: 'U-unbound' },
        expires: new Date(Date.now() + 60_000).toISOString(),
      })
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

    // guest-role タスク6 追加スコープ (AC-10): このページは PR #378 で role 判定を
    // 外し「ログイン済みなら誰でも」になっているため、middleware の早期ゲートに
    // 加えて Node 側でもゲストを明示的に弾く（降格直後の stale な JWT 対策）。
    it('guest-role AC-10: ゲストは /403 へリダイレクトされる', async () => {
      const guest = await createGuest()
      await setAuthSession({ id: guest.id, role: 'guest' })
      await expect(EntryManagementPage()).rejects.toThrow('NEXT_REDIRECT:/403')
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
      // 対比: 締切超過でも出欠 1 名なら「要申込」に出る
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
      expect(within(sectionOf('要申込')).getByText('締切超過1名')).toBeTruthy()
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

    // guest-role タスク6 E3 (AC-19): 参加希望者数は「会として何人ぶん申し込む
    // 必要があるか」を見る数値なので、ゲストは数えない（参加者欄の「誰が出るか」
    // とは問いが違う。requirements §7）。
    it('guest-role AC-19: 参加希望者数にゲストは数えられない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      const event = await createEvent({
        title: 'ゲスト混在大会',
        eventDate: future,
        internalDeadline: future,
        eligibleGrades: ['A'],
      })
      const member = await createUser({ grade: 'A' })
      const guest = await createGuest({ grade: 'A' })
      await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

      await renderPage()

      const row = screen.getByText('ゲスト混在大会').closest('a')
      expect(row?.textContent).toContain('（1名）')
    })

    it('guest-role AC-19/AC-20: ゲストだけが参加希望している大会は参加希望者0名になる', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      const event = await createEvent({
        title: 'ゲストのみ大会',
        eventDate: future,
        internalDeadline: future,
        eligibleGrades: ['A'],
      })
      const guest = await createGuest({ grade: 'A' })
      await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

      await renderPage()

      const row = screen.getByText('ゲストのみ大会').closest('a')
      // このボードは 0 名のとき「（0名）」ではなく**人数チップごと出さない**
      // （EntryBoardClient の `attendCount > 0 &&`）。ゲストしか希望していない
      // 大会は会として申し込む相手がいないので、会員が誰も希望していない大会と
      // まったく同じ見え方になるのが正しい。
      expect(row?.textContent).not.toMatch(/（\d+名）/)
    })

    // AC-13: 確定名簿の判定は roster_type='confirmed' かつ superseded_at IS NULL。
    // 申込者名簿・差し替え済みの版では true にならない。
    // 名簿の有無が区画を左右するのは事前払い・未振込の大会だけになった
    // （2026-07-27。AC-13b）ので、判定結果が見える条件を明示して置く。
    it('AC-13: applicant 名簿や superseded 済みでは確定名簿ありと判定しない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const applicantOnly = await createEvent({
        title: '申込者名簿のみ',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: applicantOnly.entryGroupId,
        rosterType: 'applicant',
      })

      const supersededOnly = await createEvent({
        title: '差し替え済み確定名簿',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
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

      const waiting = sectionOf('申込完了・抽選待ち')
      expect(within(waiting).getByText('申込者名簿のみ')).toBeTruthy()
      expect(within(waiting).getByText('差し替え済み確定名簿')).toBeTruthy()
      expect(
        within(sectionOf('名簿確定・要振込')).getByText('有効な確定名簿'),
      ).toBeTruthy()
    })

    // roster-file-adoption AC-3/AC-4: 「確定名簿がある」の定義は
    // **パース済み ∪ confirmed のファイル採用**。パース不能な原本を採用しただけで
    // 事前払い・未振込の大会が「申込完了・抽選待ち」→「名簿確定・要振込」へ進む。
    // applicant のファイル採用は分類を動かさない。
    it('AC-3/AC-4: confirmed のファイル採用は分類を進め、applicant のファイル採用は進めない', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const confirmedFile = await createEvent({
        title: 'ファイル採用（確定）',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await seedRosterFile(confirmedFile.entryGroupId, 'confirmed', '参加者一覧.xlsx')

      const applicantFile = await createEvent({
        title: 'ファイル採用（申込）',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await seedRosterFile(applicantFile.entryGroupId, 'applicant', '申込者一覧.xlsx')

      await renderPage()

      expect(
        within(sectionOf('名簿確定・要振込')).getByText('ファイル採用（確定）'),
      ).toBeTruthy()
      expect(
        within(sectionOf('申込完了・抽選待ち')).getByText('ファイル採用（申込）'),
      ).toBeTruthy()
    })

    // 2026-08-01 改修: 級別採用（grades 非 NULL）も 1 行として数える。要件は
    // 「一部の級の確定名簿だけでもフェーズは進む」（級単位の細分化はしない）で、
    // groupIdsWithConfirmedRoster のクエリが grades を見ない形のままなのが担保。
    // その担保が将来の変更で崩れないようにここで固定する。
    it('AC-3: 級別（grades 非 NULL）の confirmed ファイル採用でも分類が進む', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const gradeFile = await createEvent({
        title: '級別ファイル採用（確定）',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        eligibleGrades: ['A', 'B'],
      })
      // A 級ぶんだけ確定名簿が届いた状態（B 級は未取込）。
      await seedRosterFile(gradeFile.entryGroupId, 'confirmed', 'A級確定名簿.xlsx', ['A'])

      await renderPage()

      expect(
        within(sectionOf('名簿確定・要振込')).getByText('級別ファイル採用（確定）'),
      ).toBeTruthy()
    })

    it('AC-3: パース済みとファイル採用は OR（どちらか一方でも確定名簿ありになる）', async () => {
      const today = todayJst()
      const future = addDays(today, 10)

      const both = await createEvent({
        title: 'パース済みとファイルの両方',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: both.entryGroupId,
        rosterType: 'confirmed',
      })
      await seedRosterFile(both.entryGroupId, 'confirmed', '確定名簿原本.xlsx')

      // 差し替え済みのパース済み版しか無くても、ファイル採用があれば進む
      // （ファイル採用は版管理を持たないので superseded の概念が無い）。
      const supersededPlusFile = await createEvent({
        title: '差し替え済み＋ファイル',
        eventDate: future,
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: supersededPlusFile.entryGroupId,
        rosterType: 'confirmed',
        supersededAt: new Date(),
      })
      await seedRosterFile(supersededPlusFile.entryGroupId, 'confirmed', '差し替え後原本.xlsx')

      await renderPage()

      const section = sectionOf('名簿確定・要振込')
      expect(within(section).getByText('パース済みとファイルの両方')).toBeTruthy()
      expect(within(section).getByText('差し替え済み＋ファイル')).toBeTruthy()
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

    // AC-12b: 本改修の主目的をサーバー側の経路（母集団クエリ＋確定名簿クエリ）
    // でも固定する。名簿を 1 件も入れずに振込済にした大会が完了へ抜ける。
    it('AC-12b: 確定名簿が未取込でも、事前払い・振込済なら完了に入る', async () => {
      const today = todayJst()
      await createEvent({
        title: '名簿未取込の振込済大会',
        eventDate: addDays(today, 10),
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'paid',
      })

      await renderPage()

      expect(
        within(sectionOf('完了')).getByText('名簿未取込の振込済大会'),
      ).toBeTruthy()
      expect(
        within(sectionOf('申込完了・抽選待ち')).queryByText('名簿未取込の振込済大会'),
      ).toBeNull()
    })

    // mail-ai-extract-refinements タスク12 (§3.2.7 / AC-42): payment_deadline が
    // null のとき、状態（events.payment_deadline_kind）で「後日連絡」「締切未設定」を
    // 出し分ける。サーバーの select に列が乗っていることをここで固定する
    // （純関数側の分岐は entry-board-utils.test.ts）。
    it('AC-42: payment_deadline_kind=later_notice は「後日連絡」と表示される', async () => {
      const today = todayJst()
      const event = await createEvent({
        title: '後日連絡大会',
        eventDate: addDays(today, 10),
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        paymentDeadlineKind: 'later_notice',
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
      })

      await renderPage()

      const section = sectionOf('名簿確定・要振込')
      expect(within(section).getByText('後日連絡大会')).toBeTruthy()
      expect(within(section).getByText('後日連絡')).toBeTruthy()
    })

    it('AC-42: payment_deadline_kind=unspecified（既定）は従来どおり「締切未設定」', async () => {
      const today = todayJst()
      const event = await createEvent({
        title: '締切情報なし大会',
        eventDate: addDays(today, 10),
        entryStatus: 'applied',
        paymentType: 'advance',
        paymentStatus: 'unpaid',
        // paymentDeadlineKind 未指定 = createEvent の既定（unspecified）
      })
      await testDb.insert(tournamentEntryRosters).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
      })

      await renderPage()

      const section = sectionOf('名簿確定・要振込')
      expect(within(section).getByText('締切情報なし大会')).toBeTruthy()
      expect(within(section).getByText('締切未設定')).toBeTruthy()
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
        '要申込',
        '申込完了・抽選待ち',
        '名簿確定・要振込',
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

  // タスク2（AC-16b, AC-16c）: グループ表示名は「各可視日の通称ベース名を作ってから
  // 畳む」順序で導出する（要件 §3.2.5 手順1〜3）。deriveEntryGroupName に events.title
  // をそのまま渡していた頃は、通称の畳み方と title の畳み方がずれるケースがあった。
  describe('グループ表示名の導出（AC-16b, AC-16c）', () => {
    beforeEach(async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
    })

    it('AC-16b: 単独イベント・通称ありの表示名は通称+級のまま（回帰）', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      const edition = await seedEditionWithShortName('厚別', 3)
      await createEvent({
        title: '第3回厚別大会',
        eventDate: future,
        internalDeadline: future,
        editionId: edition.id,
        eligibleGrades: ['A', 'B'],
      })

      await renderPage()

      expect(screen.getByText('厚別AB')).toBeTruthy()
      expect(screen.queryByText('第3回厚別大会')).toBeNull()
    })

    it('単独イベント・通称なし（edition 未紐付け）は title へフォールバックする', async () => {
      const today = todayJst()
      const future = addDays(today, 10)
      await createEvent({
        title: '通称未設定大会',
        eventDate: future,
        internalDeadline: future,
        editionId: null,
      })

      await renderPage()

      expect(screen.getByText('通称未設定大会')).toBeTruthy()
    })

    it('AC-16c: 複数日グループの表示名は通称ベースで畳まれる（title だけでは畳めない場合も）', async () => {
      const today = todayJst()
      const group = await createEntryGroup()
      const edition = await seedEditionWithShortName('杉並', 10)
      await createEvent({
        entryGroupId: group.id,
        editionId: edition.id,
        title: '第10回杉並大会 B級の部',
        eligibleGrades: ['B'],
        eventDate: addDays(today, 5),
        internalDeadline: addDays(today, 3),
      })
      await createEvent({
        entryGroupId: group.id,
        editionId: edition.id,
        title: '第10回杉並大会 A級の部',
        eligibleGrades: ['A'],
        eventDate: addDays(today, 12),
        internalDeadline: addDays(today, 3),
      })

      await renderPage()

      const section = sectionOf('締切前')
      // title ベースの畳み込みは共通接頭辞の残りが「B級の部」「A級の部」で
      // 単一の級文字ではないため失敗する（groupName は代表イベントの title へ
      // フォールバックするはず）。通称ベース（杉並B / 杉並A）なら畳めて「杉並AB」。
      expect(within(section).getAllByText('杉並AB')).toHaveLength(1)
      expect(within(section).queryByText('第10回杉並大会 B級の部')).toBeNull()
      expect(within(section).queryByText('第10回杉並大会 A級の部')).toBeNull()
    })

    it('AC-16c: 通称ベースで畳めない組み合わせは groupName（title 由来）へフォールバックする', async () => {
      const today = todayJst()
      const group = await createEntryGroup()
      const edition = await seedEditionWithShortName('杉並', 20)
      const nearer = await createEvent({
        entryGroupId: group.id,
        editionId: edition.id,
        title: '臨時開催イベント甲',
        eligibleGrades: ['A', 'B'],
        eventDate: addDays(today, 5), // 今日以降で最も近い → 代表
        internalDeadline: addDays(today, 3),
      })
      await createEvent({
        entryGroupId: group.id,
        editionId: edition.id,
        title: '臨時開催イベント乙',
        eligibleGrades: ['C'],
        eventDate: addDays(today, 12),
        internalDeadline: addDays(today, 3),
      })

      await renderPage()

      const section = sectionOf('締切前')
      // 通称ベースでは「杉並AB」+「杉並C」で残りが単一の級文字ではなく畳めない。
      // title ベースでも共通接頭辞「臨時開催イベント」の残りが「甲」「乙」で級文字
      // ではないため畳めない → groupName は代表イベント（開催日が近い方）の
      // title へフォールバックする。
      expect(within(section).getAllByText('臨時開催イベント甲')).toHaveLength(1)
      expect(within(section).queryByText(/杉並/)).toBeNull()
      const headerLink = within(section).getByText('臨時開催イベント甲').closest('a')
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
