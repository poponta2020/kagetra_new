import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OpenChatExtractSheet } from './OpenChatExtractSheet'
import { MailProcessForm } from './MailProcessForm'
import {
  broadcastOpenChats,
  extractOpenChatCandidatesFromMail,
  loadOpenChatBroadcastSummary,
  saveAndBroadcastOpenChats,
} from '../open-chat-actions'
import type { ProcessCandidateGroup } from '../process-candidate-utils'

/**
 * openchat-broadcast タスク9: 抽出候補シート（AC-20, AC-35, AC-36, AC-37, AC-47）。
 * Server Action は副作用（DB・LINE push）を持つので mock する。
 * ロジック（ラベル解決・重複判定）は lib/open-chat/label.ts の実物を使う
 * （純関数で副作用が無いため mock しない）。
 */
vi.mock('../open-chat-actions', () => ({
  broadcastOpenChats: vi.fn(),
  extractOpenChatCandidatesFromMail: vi.fn(),
  loadOpenChatBroadcastSummary: vi.fn(),
  saveAndBroadcastOpenChats: vi.fn(),
}))

// MailProcessForm 経由でレンダリングするテスト（ボタン無効化）が
// ../actions と next/navigation を必要とするため、ファイル全体で mock しておく。
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
const saveMock = vi.mocked(saveAndBroadcastOpenChats)
const broadcastMock = vi.mocked(broadcastOpenChats)

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
      lineLinked
      {...props}
    />,
  )
}

beforeEach(() => {
  extractMock.mockReset()
  summaryMock.mockReset()
  saveMock.mockReset()
  extractMock.mockResolvedValue([])
  summaryMock.mockResolvedValue({ broadcastCount: 0, lastSentAt: null, rows: [] })
  saveMock.mockResolvedValue({
    ok: true,
    savedCount: 1,
    broadcast: { status: 'sent', sentCount: 1 },
  })
  broadcastMock.mockReset()
  broadcastMock.mockResolvedValue({ status: 'sent', sentCount: 1 })
})

describe('OpenChatExtractSheet — 保存済みの再配信（PR #469 R1 の回帰）', () => {
  /**
   * ★保存済み URL を候補に残したまま保存 Action を呼ぶと
   * `UNIQUE(entry_group_id, url)` 違反になり、**配信処理まで到達しない**。
   * 再配信・push 失敗後の再試行がシートから一度も行えなくなるため、
   * 保存済みは候補から除き、新規ゼロなら配信だけを行う。
   */
  const saved = {
    id: 1,
    url: 'https://line.me/ti/g2/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    label: 'C級',
    isNew: false,
  }

  it('保存済みと同じ URL の候補は再掲されず、CTA が「配信する」になる', async () => {
    // 抽出は保存済みと同じ URL を返す（同じメールを開き直した状況）。
    extractMock.mockResolvedValue([
      {
        url: saved.url,
        sources: ['body'],
        unverified: false,
        grades: ['C'],
        eventDate: null,
        password: null,
      },
    ])
    summaryMock.mockResolvedValue({ broadcastCount: 1, lastSentAt: new Date(), rows: [saved] })
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText(/配信する（1件）/)).toBeTruthy()
    })
    // 保存済みの存在が見えている（「見つかりませんでした」を出さない）。
    expect(screen.getByText(/新しい候補はありません/)).toBeTruthy()
    expect(screen.queryByText('URL が見つかりませんでした')).toBeNull()
  })

  it('配信専用モードでは保存 Action を呼ばず配信 Action だけを呼ぶ', async () => {
    extractMock.mockResolvedValue([])
    summaryMock.mockResolvedValue({ broadcastCount: 1, lastSentAt: new Date(), rows: [saved] })
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(screen.getByText(/配信する（1件）/)).toBeTruthy()
    })
    fireEvent.click(screen.getByText(/配信する（1件）/))

    // 2回目以降なので確認ダイアログを挟む（AC-35）。
    await waitFor(() => {
      expect(screen.getByText('もう一度配信しますか')).toBeTruthy()
    })
    fireEvent.click(screen.getByText(/件を配信/))

    await waitFor(() => {
      expect(broadcastMock).toHaveBeenCalledWith(10)
    })
    // ★保存 Action は呼ばれない（呼ぶと UNIQUE 違反で止まる）。
    expect(saveMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('OpenChatExtractSheet — 候補ゼロ（AC-20）', () => {
  it('「見つかりませんでした」と表示し、手入力行が展開済みで1つ出る', async () => {
    extractMock.mockResolvedValue([])
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText('URL が見つかりませんでした')).toBeTruthy()
    })

    // 手入力行が最初から展開されている＝ URL 入力欄が見える。
    expect(
      screen.getByPlaceholderText('https://line.me/ti/g2/…'),
    ).toBeTruthy()
    expect(screen.getByText('手入力')).toBeTruthy()

    // URL 未入力なので CTA は無効。
    const cta = screen.getByRole('button', { name: /保存して配信/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('OpenChatExtractSheet — 折りたたみ既定（design-spec 忠実度）', () => {
  it('候補行は既定で折りたたみ、展開すると編集欄が出る', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/AAAA1111',
        sources: ['body'],
        unverified: false,
        grades: ['C'],
        eventDate: null,
        password: null,
      },
    ])
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
    extractMock.mockResolvedValue([
      {
        url: 'http://line.me/ti/g2/AAAA1111',
        sources: ['body'],
        unverified: false,
        grades: null,
        eventDate: null,
        password: null,
      },
    ])
    renderSheet()

    await waitFor(() => {
      expect(screen.getByText('http://line.me/ti/g2/AAAA1111')).toBeTruthy()
    })

    const cta = screen.getByRole('button', { name: /保存して配信/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)

    // 展開すると（手入力行と同じく）URL 欄が編集できる。
    fireEvent.click(screen.getByRole('button', { name: '展開する' }))
    const urlInput = screen.getByDisplayValue(
      'http://line.me/ti/g2/AAAA1111',
    ) as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://line.me/ti/g2/AAAA1111' } })

    expect((screen.getByRole('button', { name: /保存して配信/ }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})

describe('OpenChatExtractSheet — 保存と配信は別々に扱う', () => {
  it('配信が失敗すると、保存済みでもシートを閉じずに結果を伝える', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/FAILCASE01',
        sources: ['body'],
        unverified: false,
        grades: ['A'],
        eventDate: null,
        password: null,
      },
    ])
    saveMock.mockResolvedValue({
      ok: true,
      savedCount: 1,
      broadcast: { status: 'failed', error: 'LINE API error' },
    })
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '保存して配信（1件）' }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存して配信（1件）' }))

    await waitFor(() => {
      expect(
        screen.getByText(/1件を保存しました。配信は失敗しました/),
      ).toBeTruthy()
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('OpenChatExtractSheet — ラベル重複（AC-47）', () => {
  it('最終ラベルが重複するとCTAが無効になり、重複行にエラーが表示される', async () => {
    extractMock.mockResolvedValue([
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
    ])
    renderSheet()

    await waitFor(() => {
      expect(screen.getAllByText('オープンチャットに参加').length).toBe(2)
    })

    const cta = screen.getByRole('button', { name: /保存して配信（2件）/ })
    expect((cta as HTMLButtonElement).disabled).toBe(true)
    expect(
      screen.getAllByText(/ラベルを入力してください/).length,
    ).toBeGreaterThan(0)
  })
})

describe('OpenChatExtractSheet — LINE 未紐付け（AC-37）', () => {
  it('CTA文言が「保存する（N件）」になり、「配信は行いません」が出る', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/CCCC3333',
        sources: ['body'],
        unverified: false,
        grades: ['E'],
        eventDate: null,
        password: null,
      },
    ])
    renderSheet({ lineLinked: false })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存する（1件）' })).toBeTruthy()
    })
    expect(screen.getByText('配信は行いません')).toBeTruthy()
  })
})

describe('OpenChatExtractSheet — 再配信の確認（AC-35, AC-36, AC-53）', () => {
  it('全件のラベルが列挙され、増えた行に「（今回追加）」が付く。キャンセルで保存は呼ばれない', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/NEWURL001',
        sources: ['body'],
        unverified: false,
        grades: ['E'],
        eventDate: null,
        password: null,
      },
    ])
    summaryMock.mockResolvedValue({
      broadcastCount: 1,
      lastSentAt: new Date('2026-01-01T00:00:00Z'),
      rows: [
        { id: 1, url: 'https://line.me/ti/g2/saved1', label: 'B級', isNew: false },
        { id: 2, url: 'https://line.me/ti/g2/saved2', label: 'C級', isNew: false },
        { id: 3, url: 'https://line.me/ti/g2/saved3', label: 'D級', isNew: false },
      ],
    })
    renderSheet()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '保存して配信（1件）' }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存して配信（1件）' }))

    await waitFor(() => {
      expect(screen.getByText('もう一度配信しますか')).toBeTruthy()
    })
    expect(screen.getByText(/すでに 1 回/)).toBeTruthy()
    expect(screen.getByText(/全 4 件/)).toBeTruthy()
    expect(screen.getByText('・B級')).toBeTruthy()
    expect(screen.getByText('・C級')).toBeTruthy()
    expect(screen.getByText('・D級')).toBeTruthy()
    expect(screen.getByText('・E級（今回追加）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))

    expect(screen.queryByText('もう一度配信しますか')).toBeNull()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('確認で配信を選ぶと保存 Action が呼ばれる', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/NEWURL002',
        sources: ['body'],
        unverified: false,
        grades: ['E'],
        eventDate: null,
        password: null,
      },
    ])
    summaryMock.mockResolvedValue({
      broadcastCount: 2,
      lastSentAt: new Date('2026-01-01T00:00:00Z'),
      rows: [{ id: 1, url: 'https://line.me/ti/g2/saved1', label: 'D級', isNew: false }],
    })
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '保存して配信（1件）' }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存して配信（1件）' }))

    await waitFor(() => {
      expect(screen.getByText('もう一度配信しますか')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '2件を配信' }))

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ entryGroupId: 10, mailMessageId: 1 }),
        { broadcast: true },
      )
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('初回配信（配信済み0回）は確認を挟まず保存する', async () => {
    extractMock.mockResolvedValue([
      {
        url: 'https://line.me/ti/g2/FIRSTTIME1',
        sources: ['body'],
        unverified: false,
        grades: ['A'],
        eventDate: null,
        password: null,
      },
    ])
    summaryMock.mockResolvedValue({ broadcastCount: 0, lastSentAt: null, rows: [] })
    const onClose = vi.fn()
    renderSheet({ onClose })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '保存して配信（1件）' }),
      ).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存して配信（1件）' }))

    expect(screen.queryByText('もう一度配信しますか')).toBeNull()
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(expect.anything(), { broadcast: true })
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
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

  it('対象の大会が未選択のときボタンが無効', () => {
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

    const button = screen.getByRole('button', { name: 'オープンチャットを抽出' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('対象の大会を選ぶとボタンが有効になる', () => {
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

    fireEvent.click(screen.getByText('大会を選ぶ'))
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByText('決定'))

    const button = screen.getByRole('button', { name: 'オープンチャットを抽出' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
