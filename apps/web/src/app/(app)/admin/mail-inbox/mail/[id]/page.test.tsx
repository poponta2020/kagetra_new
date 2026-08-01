import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  mailAttachments,
  tournamentEntryRosterFiles,
  tournamentRosterImportDrafts,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEvent,
  createMailMessage,
  createTournamentDraft,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}))
vi.mock('@/auth', () => mockAuthModule())

const { default: MailDetailPage } = await import('./page')

async function renderDetail(id: number | string) {
  const ui = await MailDetailPage({ params: Promise.resolve({ id: String(id) }) })
  return render(ui)
}

async function createAttachment(mailId: number, filename = 'roster.xlsx') {
  const [attachment] = await testDb
    .insert(mailAttachments)
    .values({
      mailMessageId: mailId,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 10,
      data: Buffer.from('x'),
      extractionStatus: 'pending',
    })
    .returning()
  return attachment!
}

describe('admin/mail-inbox/mail/[id] detail page', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('件名・本文・triage アクション（未処理）を表示する', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'detail subject',
      bodyText: 'detail body text',
      triageStatus: 'unprocessed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('detail subject')).toBeTruthy()
    expect(screen.getByText('未処理')).toBeTruthy()
    expect(screen.getByText('対応不要')).toBeTruthy()
    // mail-inbox-mailer: 「保留」ボタンは廃止（処理せず放置 = 暗黙の保留）。
  })

  it('draft があれば承認動線 [id] へのリンクを出す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'has draft',
      triageStatus: 'unprocessed',
    })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'pending_review',
    })

    await renderDetail(mail.id)

    const link = screen.getByText(/承認 \/ 却下 \/ 紐付けへ/)
    const anchor = link.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe(`/admin/mail-inbox/${draft.id}`)
  })

  it('processed メールは「未処理に戻す」のみ（保留は出さない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'done detail',
      triageStatus: 'processed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('未処理に戻す')).toBeTruthy()
    expect(screen.queryByText('保留')).toBeNull()
    expect(screen.queryByText('対応不要')).toBeNull()
  })

  it('mail-inbox-mailer: 未処理＋draft なしは 3 アクションエリアを表示', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'fresh mail',
      bodyText: '本文サンプル',
      triageStatus: 'unprocessed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('会で流す（AI 抽出）')).toBeTruthy()
    expect(screen.getByText('既存イベントに紐付ける')).toBeTruthy()
    expect(screen.getByText('対応不要')).toBeTruthy()
    // 本文は details トグルではなく即時表示。
    expect(screen.getByText('本文サンプル')).toBeTruthy()
  })

  it('mail-inbox-mailer: draft.status=ai_processing で進行中カードを表示', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'extracting',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'ai_processing',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('AI 抽出中…')).toBeTruthy()
    // 3 ボタン MailDetailActions は出ない（draft があるので分岐済み）。
    expect(screen.queryByText('会で流す（AI 抽出）')).toBeNull()
  })

  it('mail-inbox-mailer: draft.status=ai_failed で再試行ボタンを表示', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'failed',
      triageStatus: 'unprocessed',
    })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'ai_failed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('AI 抽出に失敗しました')).toBeTruthy()
    expect(screen.getByText('AI 抽出を再試行')).toBeTruthy()
    // Codex r6 blocker: 「手動でイベントを作成」リンクは /admin/events/new
    // 不在のため撤去。専用フロー実装まで非表示。
    expect(screen.queryByText('手動でイベントを作成')).toBeNull()
  })

  it('存在しない mail は notFound', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderDetail(999999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('不正な id は notFound', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderDetail('abc')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('member は /403 へ redirect', async () => {
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    await expect(renderDetail(mail.id)).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  // roster-file-adoption タスク2: 添付ごとの採用導線。
  describe('名簿ファイルの採用', () => {
    it('添付があれば「名簿ファイルとして採用」導線を出す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await testDb.insert(mailAttachments).values({
        mailMessageId: mail.id,
        filename: 'roster.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 10,
        data: Buffer.from('x'),
        extractionStatus: 'pending',
      })

      await renderDetail(mail.id)

      expect(screen.getByText('名簿ファイルとして採用')).toBeTruthy()
    })

    it('添付が無ければ「名簿ファイルの採用」セクションを出さない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      await renderDetail(mail.id)

      expect(screen.queryByText('名簿ファイルの採用')).toBeNull()
    })

    // Codex r1 blocker: 名簿は個人戦のみの仕様なので、候補に団体戦を出すと
    // 「採用は成功したのにどこにも表示されない」行き止まりへ誘導してしまう。
    // 2026-08-01 改修: 候補はイベントではなく申込グループの単位になった。
    it('採用シートの候補は個人戦の申込済みグループだけ（団体戦のみのグループは出ない）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({
        title: '個人戦の大会Y',
        kind: 'individual',
        entryStatus: 'applied',
      })
      await createEvent({ title: '団体戦の大会Z', kind: 'team', entryStatus: 'applied' })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('名簿ファイルとして採用'))

      expect(screen.getByText(/個人戦の大会Y/)).toBeTruthy()
      expect(screen.queryByText(/団体戦の大会Z/)).toBeNull()
    })

    it('申込前のグループは既定候補に出ず、「すべて表示」で出る（AC-17）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({
        title: 'まだ申し込んでいない大会',
        kind: 'individual',
        entryStatus: 'not_applied',
      })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('名簿ファイルとして採用'))

      expect(screen.queryByText(/まだ申し込んでいない大会/)).toBeNull()
      fireEvent.click(screen.getByLabelText('すべて表示'))
      expect(screen.getByText(/まだ申し込んでいない大会/)).toBeTruthy()
    })

    it('級別モードの候補はグループの eligible_grades から列挙される（AC-19）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({
        title: '級つき大会',
        kind: 'individual',
        entryStatus: 'applied',
        eligibleGrades: ['B', 'D'],
      })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('名簿ファイルとして採用'))
      fireEvent.click(screen.getByLabelText('級別名簿'))

      expect(screen.getByLabelText('級つき大会 B級')).toBeTruthy()
      expect(screen.getByLabelText('級つき大会 D級')).toBeTruthy()
      expect(screen.queryByLabelText('級つき大会 A級')).toBeNull()
    })

    it('採用済みの添付には種別・対象大会名を表示し、解除ボタンを出す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: '対象大会X' })
      const attachment = await createAttachment(mail.id)
      await testDb.insert(tournamentEntryRosterFiles).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        sourceAttachmentId: attachment.id,
        sourceMailMessageId: mail.id,
      })

      await renderDetail(mail.id)

      expect(screen.getByText('確定名簿')).toBeTruthy()
      expect(screen.getByText(/対象大会X/)).toBeTruthy()
      expect(screen.getByText('採用を解除')).toBeTruthy()
      expect(screen.queryByText('名簿ファイルとして採用')).toBeNull()
      // グループ統一（grades=NULL）の採用に級ラベルは付かない（AC-18/AC-22）。
      expect(screen.queryByText('A・B級')).toBeNull()
    })

    it('級別採用の添付には級ラベルを表示する（AC-18）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({ title: '対象大会X', eligibleGrades: ['A', 'B'] })
      const attachment = await createAttachment(mail.id)
      await testDb.insert(tournamentEntryRosterFiles).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        grades: ['A', 'B'],
        sourceAttachmentId: attachment.id,
        sourceMailMessageId: mail.id,
      })

      await renderDetail(mail.id)

      expect(screen.getByText('申込者名簿')).toBeTruthy()
      expect(screen.getByText('A・B級')).toBeTruthy()
    })
  })

  // roster-file-adoption 2026-08-01 改修 (AC-20): 決定論パース取込の UI 導線を退役。
  // 本番の実名簿では一度も機能せず、ファイル採用と並ぶと迷いを生むだけだった。
  // コード・テーブル・roster-drafts ページは温存してあり（AC-21）、消したのは
  // このページからの導線だけ。
  describe('パース取込導線の退役', () => {
    it('「大会名簿の取込」セクション・解析ボタン・ドラフト確認リンクを表示しない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({
        triageStatus: 'unprocessed',
        bodyText: '名簿本文',
      })
      const attachment = await createAttachment(mail.id)
      // ドラフトが存在していても導線は出ない（ドラフト自体は温存される）。
      await testDb.insert(tournamentRosterImportDrafts).values({
        sourceKind: 'attachment',
        sourceAttachmentId: attachment.id,
        sourceMailMessageId: mail.id,
        parserVersion: 'roster-deterministic-v1',
        status: 'pending_review',
      })

      const { container } = await renderDetail(mail.id)

      expect(screen.queryByText('大会名簿の取込')).toBeNull()
      expect(screen.queryByText('名簿として解析')).toBeNull()
      expect(screen.queryByText(/名簿ドラフト #/)).toBeNull()
      expect(
        container.querySelector('a[href^="/admin/mail-inbox/roster-drafts/"]'),
      ).toBeNull()
      // ファイル採用の導線は従来どおり出る（退役したのはパース側だけ）。
      expect(screen.getByText('名簿ファイルの採用')).toBeTruthy()
    })
  })
})
