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

  it('mail-inbox-mailer: 未処理＋draft なしは統合処理フォームを表示', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const mail = await createMailMessage({
      subject: 'fresh mail',
      bodyText: '本文サンプル',
      triageStatus: 'unprocessed',
    })

    await renderDetail(mail.id)

    expect(screen.getByText('処理')).toBeTruthy()
    expect(screen.getByRole('button', { name: '未選択' })).toBeTruthy()
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
    // 統合処理フォームは出ない（draft があるので分岐済み）。
    expect(screen.queryByRole('button', { name: '確定名簿' })).toBeNull()
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

  // ─────────────────────────────────────────────────────────────────────
  // mail-inbox-mailer 2026-08-02 改修: 統合処理フォーム
  // ─────────────────────────────────────────────────────────────────────
  describe('統合処理フォーム', () => {
    it('AC-1/AC-3: 種別セグメント 4 つを出し、既定（未選択）では対象の大会が出る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      await renderDetail(mail.id)

      for (const label of ['未選択', '大会案内', '申込名簿', '確定名簿']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy()
      }
      expect(screen.getByText('対象の大会')).toBeTruthy()
      expect(screen.getByText('大会を選ぶ')).toBeTruthy()
      expect(screen.getByText('対応不要')).toBeTruthy()
      // 旧 3 ボタン導線は無い。
      expect(screen.queryByText('既存イベントに紐付ける')).toBeNull()
      expect(screen.queryByText('会で流す（AI 抽出）')).toBeNull()
    })

    it('AC-3/AC-4: 種別 = 大会案内 では対象・名簿・配信の欄が DOM ごと消え、AI 抽出だけが出る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '大会案内' }))

      expect(screen.queryByText('対象の大会')).toBeNull()
      expect(screen.queryByText('採用する名簿ファイル')).toBeNull()
      expect(screen.queryByText('LINE 配信')).toBeNull()
      expect(screen.queryByText('実行する')).toBeNull()
      expect(screen.getByText('AI で大会を読み取る')).toBeTruthy()
    })

    it('AC-4: 未選択・名簿種別では AI 抽出の導線が出ない', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })

      await renderDetail(mail.id)
      expect(screen.queryByText('AI で大会を読み取る')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))
      expect(screen.queryByText('AI で大会を読み取る')).toBeNull()
      expect(screen.getByText('採用する名簿ファイル')).toBeTruthy()
    })

    it('AC-5/AC-6: 候補は申込グループ単位で、未選択には団体戦のみのグループも出る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({ title: '個人戦の大会Y', kind: 'individual', entryStatus: 'applied' })
      await createEvent({ title: '団体戦の大会Z', kind: 'team', entryStatus: 'applied' })

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('大会を選ぶ'))

      expect(screen.getByText(/個人戦の大会Y/)).toBeTruthy()
      expect(screen.getByText(/団体戦の大会Z/)).toBeTruthy()
    })

    it('AC-6: 名簿種別の候補は個人戦を持つグループだけ', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({ title: '個人戦の大会Y', kind: 'individual', entryStatus: 'applied' })
      await createEvent({ title: '団体戦の大会Z', kind: 'team', entryStatus: 'applied' })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '申込名簿' }))
      fireEvent.click(screen.getByText('大会を選ぶ'))

      expect(screen.getByText(/個人戦の大会Y/)).toBeTruthy()
      expect(screen.queryByText(/団体戦の大会Z/)).toBeNull()
    })

    it('AC-7: 名簿種別の候補は既定で申込済みに絞られ、「すべて表示」で解除できる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({
        title: '申込前の大会W',
        kind: 'individual',
        entryStatus: 'not_applied',
      })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))
      fireEvent.click(screen.getByText('大会を選ぶ'))

      expect(screen.queryByText(/申込前の大会W/)).toBeNull()
      fireEvent.click(screen.getByLabelText(/すべて表示/))
      expect(screen.getByText(/申込前の大会W/)).toBeTruthy()
    })

    it('AC-8/AC-9: 大会を選ぶと級チップが出て、グループの対象級だけ押せる', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({
        title: '対象大会V',
        kind: 'individual',
        entryStatus: 'applied',
        eligibleGrades: ['A', 'B'],
      })
      await createAttachment(mail.id, '確定名簿.xlsx')

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))
      fireEvent.click(screen.getByText('大会を選ぶ'))
      fireEvent.click(screen.getByText(/対象大会V/))
      fireEvent.click(screen.getByRole('button', { name: '決定' }))
      // 添付を採用対象にすると級チップが生える。
      fireEvent.click(screen.getByRole('checkbox', { name: /確定名簿\.xlsx/ }))

      // 「取込単位（グループ統一 / 級別）」のラジオは存在しない（design-spec）。
      expect(screen.queryByText('グループ統一名簿')).toBeNull()
      expect(screen.queryByText('級別名簿')).toBeNull()
      expect(
        screen.getByText('級を選ばなければ、そのファイルはグループ全体の名簿として採用します。'),
      ).toBeTruthy()
      // A〜E の 5 チップ。対象級（A・B）だけ押せる。
      for (const grade of ['A', 'B', 'C', 'D', 'E']) {
        expect(screen.getByRole('button', { name: grade })).toBeTruthy()
      }
      expect(
        screen.getByRole('button', { name: 'A' }).hasAttribute('disabled'),
      ).toBe(false)
      expect(
        screen.getByRole('button', { name: 'E' }).hasAttribute('disabled'),
      ).toBe(true)
    })

    it('AC-18: LINE 未紐付けのグループでは配信を選べず理由が出る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createEvent({ title: '未紐付け大会U', kind: 'individual' })

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('大会を選ぶ'))
      fireEvent.click(screen.getByText(/未紐付け大会U/))
      fireEvent.click(screen.getByRole('button', { name: '決定' }))

      const checkbox = screen.getByRole('checkbox', { name: /LINE で配信する/ })
      expect((checkbox as HTMLInputElement).disabled).toBe(true)
      expect(screen.getByText(/LINE グループがまだ紐付いていません/)).toBeTruthy()
      // 配信 OFF なので本文添付の欄も出ない。
      expect(screen.queryByText('メール本文を添付する')).toBeNull()
    })

    it('AC-20: 「試合結果の取込」は種別 = 未選択 のときだけ出る', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createAttachment(mail.id, 'results.xlsx')

      await renderDetail(mail.id)
      expect(screen.getByText('試合結果の取込')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))
      expect(screen.queryByText('試合結果の取込')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '未選択' }))
      expect(screen.getByText('試合結果の取込')).toBeTruthy()
    })

    it('AC-13: 採用済みの添付は選択肢に出さず、採用状態と解除ボタンを出す', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({
        title: '対象大会X',
        kind: 'individual',
        entryStatus: 'applied',
      })
      const attachment = await createAttachment(mail.id, '採用済み.xlsx')
      await testDb.insert(tournamentEntryRosterFiles).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'confirmed',
        sourceAttachmentId: attachment.id,
        sourceMailMessageId: mail.id,
      })

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))

      expect(screen.getByText('確定名簿', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText(/対象大会X/)).toBeTruthy()
      expect(screen.getByText('採用を解除')).toBeTruthy()
      // 採用済みは選択チェックボックスを出さない。
      expect(screen.queryByRole('checkbox', { name: /採用済み\.xlsx/ })).toBeNull()
      // グループ統一（grades=NULL）の採用に級ラベルは付かない。
      expect(screen.queryByText('A・B級')).toBeNull()
    })

    it('級別採用の添付には級ラベルを表示する', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      const event = await createEvent({
        title: '対象大会X',
        kind: 'individual',
        entryStatus: 'applied',
        eligibleGrades: ['A', 'B'],
      })
      const attachment = await createAttachment(mail.id)
      await testDb.insert(tournamentEntryRosterFiles).values({
        entryGroupId: event.entryGroupId,
        rosterType: 'applicant',
        grades: ['A', 'B'],
        sourceAttachmentId: attachment.id,
        sourceMailMessageId: mail.id,
      })

      await renderDetail(mail.id)
      fireEvent.click(screen.getByRole('button', { name: '申込名簿' }))

      expect(screen.getByText('申込者名簿')).toBeTruthy()
      expect(screen.getByText('A・B級')).toBeTruthy()
    })

    it('種別を変えて選択済みの大会が新しい母集団に無ければ落とす', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      // 団体戦のみのグループ = 未選択では選べるが名簿種別では選べない。
      await createEvent({ title: '団体戦の大会Z', kind: 'team', entryStatus: 'applied' })
      await createAttachment(mail.id)

      await renderDetail(mail.id)
      fireEvent.click(screen.getByText('大会を選ぶ'))
      fireEvent.click(screen.getByText(/団体戦の大会Z/))
      fireEvent.click(screen.getByRole('button', { name: '決定' }))
      expect(screen.getByText('変更')).toBeTruthy()

      // 名簿種別へ切り替えると、その大会は候補外なので選択が外れる。
      fireEvent.click(screen.getByRole('button', { name: '確定名簿' }))
      expect(screen.getByText('大会を選ぶ')).toBeTruthy()
      expect(screen.queryByText('変更')).toBeNull()
    })

    it('AC-26: 詳細の区分ピルも手動種別（未選択なら出ない）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const withKind = await createMailMessage({
        subject: 'kind detail',
        triageStatus: 'unprocessed',
        mailKind: 'applicant_roster',
      })

      const { unmount } = await renderDetail(withKind.id)
      expect(screen.getAllByText('申込名簿').length).toBeGreaterThan(0)
      unmount()

      const noKind = await createMailMessage({
        subject: 'no kind detail',
        triageStatus: 'processed',
        mailKind: null,
      })
      await renderDetail(noKind.id)
      expect(screen.queryByText('大会案内')).toBeNull()
      expect(screen.queryByText('申込名簿')).toBeNull()
      expect(screen.queryByText('ノイズ')).toBeNull()
    })

    it('AC-23: AI ドラフトが未完了のあいだは処理フォームを出さない（種別を変更できない）', async () => {
      const admin = await createAdmin()
      await setAuthSession({ id: admin.id, role: 'admin' })
      const mail = await createMailMessage({ triageStatus: 'unprocessed' })
      await createTournamentDraft({ messageId: mail.id, status: 'pending_review' })

      await renderDetail(mail.id)

      expect(screen.queryByRole('button', { name: '確定名簿' })).toBeNull()
      expect(screen.queryByText('実行する')).toBeNull()
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
      // 名簿の採用導線は統合処理フォーム側に移った（退役したのはパース側だけ）。
      expect(screen.getByRole('button', { name: '確定名簿' })).toBeTruthy()
    })
  })
})
