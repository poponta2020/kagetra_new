import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OpenChatExtractSheet } from './OpenChatExtractSheet'
import { MailProcessForm } from './MailProcessForm'
import {
  broadcastOpenChats,
  extractOpenChatCandidatesFromMail,
  loadOpenChatBroadcastSummary,
  saveOpenChats,
} from '../open-chat-actions'
import { processMail } from '../actions'
import type { ProcessCandidateGroup } from '../process-candidate-utils'

/**
 * openchat-broadcast タスク9 + 2026-09-04 改修: 抽出候補シート（AC-20, AC-47）と、
 * 統合処理フォームの「オープンチャットの招待リンクも送る」（AC-35 の代替）。
 *
 * ★シートは**保存だけ**を行い、LINE へは送らない。配信はメール本文・添付と同じ
 * タイミング（`processMail`）に相乗りする。
 *
 * Server Action は副作用（DB・LINE push）を持つので mock する。
 * ロジック（ラベル解決・重複判定）は lib/open-chat/label.ts の実物を使う
 * （純関数で副作用が無いため mock しない）。
 */
vi.mock('../open-chat-actions', () => ({
  broadcastOpenChats: vi.fn(),
  extractOpenChatCandidatesFromMail: vi.fn(),
  loadOpenChatBroadcastSummary: vi.fn(),
  saveOpenChats: vi.fn(),
}))

// MailProcessForm 経由でレンダリングするテストが ../actions と next/navigation を
// 必要とするため、ファイル全体で mock しておく。
vi.mock('../actions', () => ({
  dismissMail: vi.fn(),
  processMail: vi.fn(),
  releaseRosterFile: vi.fn(),
  triggerExtractDraft: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const extractMock = vi.mocked(extractOpenChatCandidatesFromMail)
const summaryMock = vi.mocked(loadOpenChatBroadcastSummary)
const saveMock = vi.mocked(saveOpenChats)
const broadcastMock = vi.mocked(broadcastOpenChats)
const processMailMock = vi.mocked(processMail)

type Summary = Awaited<ReturnType<typeof loadOpenChatBroadcastSummary>>

/** サマリーの既定値。テストは必要な項目だけ上書きする。 */
function summary(patch: Partial<Summary> = {}): Summary {
  return { broadcastCount: 0, lastSentAt: null, lastAttempt: null, rows: [], ...patch }
}

function renderSheet(
  props: Partial<React.ComponentProps<typeof OpenChatExtractSheet>> = {},
) {
  render(
    <OpenChatExtractSheet
      open
      onClose={vi.fn()}
      mailMessageId={1}
      entryGroupId={10}
      entryGroupDisplayName="東京東会大会BCD級"
      groupEventDates={['2026-06-20', '2026-06-21']}
      {...props}
    />,
  )
}

beforeEach(() => {
  extractMock.mockReset()
  summaryMock.mockReset()
  saveMock.mockReset()
  extractMock.mockResolvedValue({ candidates: [], qrUnreadAttachments: [] })
  summaryMock.mockResolvedValue(summary())
  saveMock.mockResolvedValue({ ok: true, savedCount: 1 })
  broadcastMock.mockReset()
  broadcastMock.mockResolvedValue({ status: 'sent', sentCount: 1 })
  processMailMock.mockReset()
  processMailMock.mockResolvedValue({ ok: true })
})

describe('OpenChatExtractSheet — 保存済みは候補に再掲しない（PR #469 R1 の回帰）', () => {
  /**
   * ★保存済み URL を候補に残したまま保存 Action を呼ぶと
   * `UNIQUE(entry_group_id, url)` 違反になり、保存自体が失敗する。
   */
  const saved = {
    id: 1,
    url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    label: 'C級',
    isNew: false,
  }

  it('保存済みと同じ URL の候補は再掲されず、追加するものが無いので CTA は無効', async () => {
    // 抽出は保存済みと同じ URL を返す（同じメールを開き直した状況）。
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: saved.url,
          sources: ['body'],
          unverified: false,
          grades: ['C'],
          eventDate: null,
          password: null,
        },
      ],
    })
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 1, lastSentAt: new Date(), rows: [saved] }),
    )
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText(/新しい候補はありません/)).toBeTruthy()
    })
    const cta = screen.getByRole('button', { name: '保存する（0件）' })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('追加するオープンチャットがありません')).toBeTruthy()
    // 保存済みの存在が見えている（「見つかりませんでした」を出さない）。
    expect(screen.queryByText('URL が見つかりませんでした')).toBeNull()
  })

  it('シートからは配信 Action を一切呼ばない（配信はメール実行側の責務）', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'https://line.me/ti/g2/NEWURL0001',
          sources: ['body'],
          unverified: false,
          grades: ['A'],
          eventDate: null,
          password: null,
        },
      ],
    })
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 1, lastSentAt: new Date(), rows: [saved] }),
    )
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存する（1件）' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存する（1件）' }))

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ entryGroupId: 10, mailMessageId: 1 }),
      )
    })
    // ★2回目以降でも確認ダイアログは出ない（送らないので確認するものが無い）。
    expect(screen.queryByText('もう一度配信しますか')).toBeNull()
    expect(broadcastMock).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })
})

describe('OpenChatExtractSheet — 候補ゼロ（AC-20）', () => {
  it('「見つかりませんでした」と表示し、手入力行が展開済みで1つ出る', async () => {
    extractMock.mockResolvedValue({ candidates: [], qrUnreadAttachments: [] })
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText('URL が見つかりませんでした')).toBeTruthy()
    })

    // 手入力行が最初から展開されている＝ URL 入力欄が見える。
    expect(screen.getByPlaceholderText('https://line.me/ti/g2/…')).toBeTruthy()
    expect(screen.getByText('手入力')).toBeTruthy()

    // URL 未入力なので CTA は無効。
    const cta = screen.getByRole('button', { name: /保存する/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('OpenChatExtractSheet — 折りたたみ既定（design-spec 忠実度）', () => {
  it('候補行は既定で折りたたみ、展開すると編集欄が出る', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'https://line.me/ti/g2/AAAA1111',
          sources: ['body'],
          unverified: false,
          grades: ['C'],
          eventDate: null,
          password: null,
        },
      ],
    })
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText('https://line.me/ti/g2/AAAA1111')).toBeTruthy()
    })

    // 折りたたみ時は編集欄（対象級ラベル）が無い。
    expect(screen.queryByText('対象級')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展開する' }))

    expect(screen.getByText('対象級')).toBeTruthy()
    expect(screen.getByText('開催日')).toBeTruthy()
    expect(screen.getByText('ラベル')).toBeTruthy()
    expect(screen.getByText('パスワード')).toBeTruthy()
  })
})

describe('OpenChatExtractSheet — extract.ts が http:// を拾った場合の詰み回避', () => {
  it('抽出候補の URL が https:// でなくても、展開すれば直せる', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'http://line.me/ti/g2/AAAA1111',
          sources: ['body'],
          unverified: false,
          grades: null,
          eventDate: null,
          password: null,
        },
      ],
    })
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText('http://line.me/ti/g2/AAAA1111')).toBeTruthy()
    })

    const cta = screen.getByRole('button', { name: /保存する/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)

    // 展開すると（手入力行と同じく）URL 欄が編集できる。
    fireEvent.click(screen.getByRole('button', { name: '展開する' }))
    const urlInput = screen.getByDisplayValue(
      'http://line.me/ti/g2/AAAA1111',
    ) as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://line.me/ti/g2/AAAA1111' } })

    expect((screen.getByRole('button', { name: /保存する/ }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})

describe('OpenChatExtractSheet — 保存の失敗', () => {
  it('保存に失敗したらシートを閉じずに理由を出す', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'https://line.me/ti/g2/FAILCASE01',
          sources: ['body'],
          unverified: false,
          grades: ['A'],
          eventDate: null,
          password: null,
        },
      ],
    })
    saveMock.mockResolvedValue({ ok: false, error: 'すでに登録されている URL があります' })
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存する（1件）' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存する（1件）' }))

    await waitFor(() => {
      expect(screen.getByText('すでに登録されている URL があります')).toBeTruthy()
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('OpenChatExtractSheet — ラベル重複（AC-47）', () => {
  it('最終ラベルが重複するとCTAが無効になり、重複行にエラーが表示される', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'https://line.me/ti/g2/AAAA1111',
          sources: ['body'],
          unverified: false,
          grades: null,
          eventDate: null,
          password: null,
        },
        {
          url: 'https://line.me/ti/g2/BBBB2222',
          sources: ['body'],
          unverified: false,
          grades: null,
          eventDate: null,
          password: null,
        },
      ],
    })
    renderSheet()

    await waitFor(() => {
      expect(screen.getAllByText('オープンチャットに参加').length).toBe(2)
    })

    const cta = screen.getByRole('button', { name: /保存する（2件）/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText(/ラベルを入力してください/).length).toBeGreaterThan(0)
  })
})

describe('OpenChatExtractSheet — final レビューの回帰（PR #469）', () => {
  const saved = {
    id: 1,
    url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    label: 'C級',
    isNew: false,
  }

  it('処理中は「閉じる」も背景クリックも効かない', async () => {
    extractMock.mockResolvedValue({
      qrUnreadAttachments: [],
      candidates: [
        {
          url: 'https://line.me/ti/g2/PENDING001',
          sources: ['body'],
          unverified: false,
          grades: ['A'],
          eventDate: null,
          password: null,
        },
      ],
    })
    // 解決しない Promise で pending を維持する。
    saveMock.mockImplementation(() => new Promise(() => {}))
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存する（1件）' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存する（1件）' }))

    await waitFor(() => {
      expect(screen.getByText('閉じる').hasAttribute('disabled')).toBe(true)
    })
    fireEvent.click(screen.getByText('閉じる'))
    // 実行中に閉じると、失敗結果が誰にも表示されないまま消える。
    expect(onClose).not.toHaveBeenCalled()
  })

  it('大会を切り替えたとき、前の大会の保存済み状態を持ち越さない', async () => {
    // 大会A: 保存済み1件。
    extractMock.mockResolvedValue({ candidates: [], qrUnreadAttachments: [] })
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 3, lastSentAt: new Date(), rows: [saved] }),
    )
    const { rerender } = render(
      <OpenChatExtractSheet
        open
        onClose={vi.fn()}
        mailMessageId={1}
        entryGroupId={10}
        entryGroupDisplayName="大会A"
        groupEventDates={['2026-06-20']}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(/配信済み 3 回/)).toBeTruthy()
    })

    // 大会B: 読み込みが失敗する。Aの保存済み・配信回数が残ってはいけない。
    summaryMock.mockRejectedValue(new Error('boom'))
    extractMock.mockRejectedValue(new Error('boom'))
    rerender(
      <OpenChatExtractSheet
        open
        onClose={vi.fn()}
        mailMessageId={2}
        entryGroupId={20}
        entryGroupDisplayName="大会B"
        groupEventDates={['2026-07-01']}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/抽出に失敗しました/)).toBeTruthy()
    })
    expect(screen.queryByText(/配信済み 3 回/)).toBeNull()
    expect(screen.queryByText('C級')).toBeNull()
  })
})

describe('MailProcessForm — オープンチャット抽出ボタン（要件 §3.2.8）', () => {
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

  /** 候補グループを1つ選ぶ（サマリーの読み込み完了まで待つ）。 */
  async function selectGroup() {
    fireEvent.click(screen.getByText('大会を選ぶ'))
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByText('決定'))
    await waitFor(() => {
      expect(summaryMock).toHaveBeenCalledWith(100)
    })
  }

  it('対象の大会が未選択のときボタンが無効', () => {
    renderForm()

    const button = screen.getByRole('button', { name: 'オープンチャットを抽出' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('対象の大会を選ぶとボタンが有効になる', async () => {
    renderForm()
    await selectGroup()

    const button = screen.getByRole('button', { name: 'オープンチャットを抽出' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('MailProcessForm — オープンチャットをメール配信に相乗りさせる', () => {
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

  const savedRow = {
    id: 1,
    url: 'https://line.me/ti/g2/SAVED00001',
    label: 'C級',
    isNew: false,
  }

  function renderForm() {
    render(
      <MailProcessForm
        mailId={7}
        attachments={[]}
        candidateGroups={[baseGroup]}
        cutoffStr="2026-01-01"
        receivedDateStr="2026-01-01"
        aiExtractAttachments={[]}
        pdfSizeLimitKb={8000}
      />,
    )
  }

  async function selectGroupAndEnableBroadcast() {
    fireEvent.click(screen.getByText('大会を選ぶ'))
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByText('決定'))
    await waitFor(() => {
      expect(summaryMock).toHaveBeenCalledWith(100)
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /LINE で配信する/ }))
  }

  it('★Codex R1: サマリーの読み込みが終わるまで「実行する」を押せない', async () => {
    // 大会を切り替えた直後に押せてしまうと、前の大会の件数で組んだ
    // includeOpenChat が新しい大会へ渡り、配信済みの全件が再送され得る。
    summaryMock.mockImplementation(() => new Promise(() => {}))
    renderForm()

    fireEvent.click(screen.getByText('大会を選ぶ'))
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByText('決定'))

    await waitFor(() => {
      expect(summaryMock).toHaveBeenCalledWith(100)
    })
    const submit = screen.getByRole('button', { name: '読み込み中…' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(submit)
    expect(processMailMock).not.toHaveBeenCalled()
  })

  it('保存済みが1件も無ければチェックボックスは出ない', async () => {
    summaryMock.mockResolvedValue(summary())
    renderForm()
    await selectGroupAndEnableBroadcast()

    expect(screen.queryByRole('checkbox', { name: /オープンチャットの招待リンク/ })).toBeNull()
  })

  it('未配信なら既定 ON で、実行すると includeOpenChat: true が渡る', async () => {
    summaryMock.mockResolvedValue(summary({ rows: [savedRow] }))
    renderForm()
    await selectGroupAndEnableBroadcast()

    const checkbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /オープンチャットの招待リンクも送る（1件）/ }),
    )
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/未配信。保存済みの全件を Flex 1通で送ります/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '実行する' }))

    await waitFor(() => {
      expect(processMailMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ broadcast: true, includeOpenChat: true }),
      )
    })
  })

  it('★AC-35 の代替: 既に配信済みなら既定 OFF（意図しない全件再送を防ぐ）', async () => {
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 2, lastSentAt: new Date(), rows: [savedRow] }),
    )
    renderForm()
    await selectGroupAndEnableBroadcast()

    const checkbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /オープンチャットの招待リンクも送る（1件）/ }),
    )
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/配信済み 2 回/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '実行する' }))

    await waitFor(() => {
      expect(processMailMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ includeOpenChat: false }),
      )
    })
  })

  it('★配信済みでも、前回配信より後に増えた行があれば既定 ON（新しいリンクを黙って落とさない）', async () => {
    // 級別・部門別の URL が別メールで後から届く実運用のケース。
    summaryMock.mockResolvedValue(
      summary({
        broadcastCount: 1,
        lastSentAt: new Date('2026-01-01T00:00:00Z'),
        rows: [savedRow, { id: 2, url: 'https://line.me/ti/g2/SAVED00002', label: 'D級', isNew: true }],
      }),
    )
    renderForm()
    await selectGroupAndEnableBroadcast()

    const checkbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /オープンチャットの招待リンクも送る（2件）/ }),
    )
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/前回以降に 1 件増えたので/)).toBeTruthy()
  })

  it('前回の配信が失敗していたら、その旨をチェックボックスの脇に出す', async () => {
    summaryMock.mockResolvedValue(
      summary({
        broadcastCount: 0,
        lastAttempt: { status: 'failed', errorMessage: 'LINE push failed: 500', at: new Date() },
        rows: [savedRow],
      }),
    )
    renderForm()
    await selectGroupAndEnableBroadcast()

    await waitFor(() => {
      expect(screen.getByText(/前回の配信は届いていません/)).toBeTruthy()
    })
  })
})
