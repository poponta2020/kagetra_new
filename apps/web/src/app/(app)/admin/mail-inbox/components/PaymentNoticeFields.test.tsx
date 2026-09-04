import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MailProcessForm } from './MailProcessForm'
import { loadPaymentNoticeDraft, type PaymentNoticeDraft } from '../payment-notice-actions'
import { loadOpenChatBroadcastSummary } from '../open-chat-actions'
import { processMail } from '../actions'
import type { ProcessCandidateGroup } from '../process-candidate-utils'

/**
 * 統合処理フォームの「会計へ振込連絡」セクション（line-bot-message-revamp §3.3.5 /
 * AC-31・AC-32・AC-34・AC-35・AC-37・AC-38・AC-41・AC-42・AC-42b）。
 *
 * Server Action は副作用（DB・LINE push）を持つので mock する。文面のプレビューは
 * pure な `@/lib/payment-notice` の実物を使う（送信経路と同じ関数なので、見た目と
 * 実際が食い違わないことをここで確かめられる）。
 */

vi.mock('../payment-notice-actions', () => ({
  loadPaymentNoticeDraft: vi.fn(),
}))
vi.mock('../open-chat-actions', () => ({
  loadOpenChatBroadcastSummary: vi.fn(),
}))
vi.mock('../actions', () => ({
  dismissMail: vi.fn(),
  processMail: vi.fn(),
  releaseRosterFile: vi.fn(),
  triggerExtractDraft: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const draftMock = vi.mocked(loadPaymentNoticeDraft)
const summaryMock = vi.mocked(loadOpenChatBroadcastSummary)
const processMailMock = vi.mocked(processMail)

function draft(patch: Partial<PaymentNoticeDraft> = {}): PaymentNoticeDraft {
  return {
    canSend: true,
    unavailableReason: null,
    unavailableMessage: null,
    rows: [
      { grade: 'A', count: 2, unitJpy: 2500 },
      { grade: 'B', count: 0, unitJpy: 2500 },
    ],
    hasSavedCounts: false,
    paymentDeadline: '2026-07-25',
    paymentDeadlineKind: 'fixed',
    paymentInfo: '〇〇銀行 普通 1234567',
    lastSentAt: null,
    lastAttemptedAt: null,
    lastError: null,
    ...patch,
  }
}

const baseGroup: ProcessCandidateGroup = {
  groupId: 100,
  displayName: '東京東会大会BCD級',
  representativeEventId: 1,
  days: [
    {
      eventDate: '2026-06-28',
      entryStatus: 'applied',
      eligibleGrades: ['B', 'C', 'D'],
      kind: 'individual',
    },
  ],
  files: [],
  lineLinked: true,
}

function renderForm() {
  render(
    <MailProcessForm
      mailId={1}
      attachments={[]}
      candidateGroups={[baseGroup]}
      cutoffStr="2026-01-01"
      receivedDateStr="2026-01-01"
      aiExtractAttachments={[]}
      pdfSizeLimitKb={8000}
    />,
  )
}

/** 種別を選ぶ。 */
function selectKind(label: string) {
  fireEvent.click(screen.getByText(label))
}

/** 候補グループを1つ選ぶ。 */
function selectGroup() {
  fireEvent.click(screen.getByText('大会を選ぶ'))
  fireEvent.click(screen.getByRole('radio'))
  fireEvent.click(screen.getByText('決定'))
}

describe('MailProcessForm — 会計へ振込連絡', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    summaryMock.mockResolvedValue({
      broadcastCount: 0,
      lastSentAt: null,
      lastAttempt: null,
      rows: [],
    })
    draftMock.mockResolvedValue(draft())
    processMailMock.mockResolvedValue({ ok: true })
  })

  it('種別＝確定名簿 ∧ グループ選択済みでセクションが出る（AC-31）', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await waitFor(() => expect(draftMock).toHaveBeenCalledWith(100))
    expect(screen.getByText('会計へ振込連絡')).toBeTruthy()
  })

  it('種別が申込名簿・未選択のときは出ない（AC-32）', async () => {
    renderForm()
    selectKind('申込名簿')
    selectGroup()
    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith(100))
    expect(screen.queryByText('会計へ振込連絡')).toBeNull()
    expect(draftMock).not.toHaveBeenCalled()
  })

  it('グループ未選択ではセクションが出ない（AC-32）', () => {
    renderForm()
    selectKind('確定名簿')
    expect(screen.queryByText('会計へ振込連絡')).toBeNull()
  })

  it('未送信のグループはチェックが既定 ON（AC-41）', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    const checkbox = await screen.findByLabelText(/会計へ振込連絡を送る/)
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })

  it('送信済みのグループはチェックが既定 OFF で送信日時が出る（AC-41）', async () => {
    // 訂正名簿・級別分割で確定名簿メールが複数通届くのは日常なので、意図したときだけ再送する。
    draftMock.mockResolvedValue(draft({ lastSentAt: new Date('2026-07-20T10:00:00Z') }))
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    const checkbox = await screen.findByLabelText(/会計へ振込連絡を送る/)
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/送信済/)).toBeTruthy()
  })

  it('級ごとの人数だけ編集でき、単価の入力欄が無い（AC-37）', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByLabelText('A級の人数')
    expect(screen.getByLabelText('B級の人数')).toBeTruthy()
    // 単価は表示のみ。入力欄にしない。
    expect(screen.queryByLabelText(/単価/)).toBeNull()
    // 人数0の級にも入力欄が出る（確定名簿に合わせて増やせるように）。
    expect((screen.getByLabelText('B級の人数') as HTMLInputElement).value).toBe('0')
  })

  it('送信できないときは理由を出し、入力欄は出さない（AC-34 / AC-35）', async () => {
    draftMock.mockResolvedValue(
      draft({
        canSend: false,
        unavailableReason: 'no_line_binding',
        unavailableMessage: 'LINE グループが紐付いていません',
        rows: [],
      }),
    )
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByText(/振込連絡は送れません: LINE グループが紐付いていません/)
    expect(screen.queryByLabelText('A級の人数')).toBeNull()
    // セクション自体は残す（黙って消さない）。
    expect(screen.getByText('会計へ振込連絡')).toBeTruthy()
  })

  it('チェック ON で振込先が空だと実行できない（AC-38）', async () => {
    draftMock.mockResolvedValue(draft({ paymentInfo: null }))
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByLabelText('A級の人数')
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '実行する' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )

    fireEvent.change(screen.getByPlaceholderText(/〇〇銀行/), {
      target: { value: '△△銀行 普通 7654321' },
    })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '実行する' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })

  it('チェック OFF なら振込先が空でも実行でき、send: false が渡る（AC-42）', async () => {
    draftMock.mockResolvedValue(draft({ paymentInfo: null }))
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    const checkbox = await screen.findByLabelText(/会計へ振込連絡を送る/)
    fireEvent.click(checkbox)
    // 畳まれるので人数の入力欄は消える。
    expect(screen.queryByLabelText('A級の人数')).toBeNull()

    const run = screen.getByRole('button', { name: '実行する' }) as HTMLButtonElement
    expect(run.disabled).toBe(false)
    fireEvent.click(run)
    await waitFor(() => expect(processMailMock).toHaveBeenCalled())
    expect(processMailMock.mock.calls[0]![1].paymentNotice).toMatchObject({
      send: false,
      paymentDeadline: '2026-07-25',
      paymentInfo: null,
    })
  })

  it('種別が確定名簿でなければ paymentNotice を渡さない（AC-42b）', async () => {
    renderForm()
    selectKind('申込名簿')
    selectGroup()
    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith(100))
    fireEvent.click(screen.getByRole('button', { name: '実行する' }))
    await waitFor(() => expect(processMailMock).toHaveBeenCalled())
    expect(processMailMock.mock.calls[0]![1].paymentNotice).toBeNull()
  })

  it('送信できない状態でも paymentNotice を渡さない（サーバーの fail-closed と揃える）', async () => {
    draftMock.mockResolvedValue(
      draft({ canSend: false, unavailableReason: 'paid', unavailableMessage: '支払済みです', rows: [] }),
    )
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByText(/振込連絡は送れません/)
    fireEvent.click(screen.getByRole('button', { name: '実行する' }))
    await waitFor(() => expect(processMailMock).toHaveBeenCalled())
    expect(processMailMock.mock.calls[0]![1].paymentNotice).toBeNull()
  })

  it('入力した人数・支払締切・振込先がそのまま渡る', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByLabelText('A級の人数')
    fireEvent.change(screen.getByLabelText('A級の人数'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('B級の人数'), { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: '実行する' }))
    await waitFor(() => expect(processMailMock).toHaveBeenCalled())
    expect(processMailMock.mock.calls[0]![1].paymentNotice).toEqual({
      send: true,
      counts: { A: 3, B: 1 },
      paymentDeadline: '2026-07-25',
      paymentDeadlineKind: 'fixed',
      paymentInfo: '〇〇銀行 普通 1234567',
    })
  })

  it('プレビューが送信経路と同じ文面を出す', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByLabelText('A級の人数')
    // 初期値は A:2 / B:0 → B級の行は出ない。
    expect(screen.getByText(/A級：2500\*2 = 5000円/)).toBeTruthy()
    expect(screen.getByText(/計5000円/)).toBeTruthy()
    // 2通目は支払情報だけ（振込先の入力欄にも同じ文字列が入っているので pre で絞る）。
    const previews = [...document.querySelectorAll('pre')].map((el) => el.textContent)
    expect(previews).toContain('〇〇銀行 普通 1234567')
  })

  it('人数が全級0だと実行できない', async () => {
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByLabelText('A級の人数')
    fireEvent.change(screen.getByLabelText('A級の人数'), { target: { value: '0' } })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: '実行する' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )
  })

  it('ドラフトの取得に失敗したら実行させない', async () => {
    draftMock.mockRejectedValue(new Error('boom'))
    renderForm()
    selectKind('確定名簿')
    selectGroup()
    await screen.findByText(/振込連絡の情報を読み込めませんでした/)
    expect(
      (screen.getByRole('button', { name: '実行する' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
