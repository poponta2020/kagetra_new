import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MailSearchRow } from '@/lib/member-mail/search'
import { MailList } from './MailList'
import { loadMoreMails } from './actions'
import type { MailListItem } from './actions'

/**
 * member-mail-search タスク4: `/mail` の追加読込（AC-8）。`RankingList.test.tsx` と
 * 同じ「`./actions` をモックしてクライアント側の state 遷移だけ見る」方針。
 */

vi.mock('./actions', () => ({ loadMoreMails: vi.fn() }))
const loadMoreMock = vi.mocked(loadMoreMails)

// ★ブロック必須。`() => loadMoreMock.mockReset()` は mockReset の戻り値（＝モック本体）
// を返すため、vitest がそれを beforeEach の teardown 関数として登録し、テスト終了時に
// **モックを呼んで戻り値を await** する。多重実行ガードのテストのように never-resolve な
// Promise を返す実装を差し込んでいると、そこで hookTimeout(10s) に達して落ちる。
beforeEach(() => {
  loadMoreMock.mockReset()
})

function makeItem(id: number, overrides: Partial<MailSearchRow> = {}): MailListItem {
  return {
    row: {
      id,
      subject: `件名${id}`,
      fromName: null,
      fromAddress: `mail${id}@example.jp`,
      receivedAt: new Date('2026-08-08T07:25:00Z'),
      triageStatus: 'processed',
      mailKind: null,
      attachments: [],
      subjectMatched: false,
      excerpt: null,
      ...overrides,
    },
    historySummary: null,
  }
}

describe('MailList — 空 / 一覧', () => {
  it('該当0件は空状態文言（att=false は「外す」提案なし）', () => {
    render(<MailList initialItems={[]} total={0} q="" attachmentsOnly={false} from="/mail" />)
    expect(screen.getByText('該当するメールがありません')).toBeTruthy()
    expect(screen.queryByText(/添付ありのみ」を外してみてください/)).toBeNull()
  })

  it('該当0件・att=true は「外す」提案を出す', () => {
    render(<MailList initialItems={[]} total={0} q="旭川" attachmentsOnly={true} from="/mail" />)
    expect(screen.getByText(/添付ありのみ」を外してみてください/)).toBeTruthy()
  })

  it('初期20件がすべて描画される', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem(i + 1))
    render(<MailList initialItems={items} total={40} q="" attachmentsOnly={false} from="/mail" />)
    for (const item of items) {
      expect(screen.getByText(item.row.subject!)).toBeTruthy()
    }
  })
})

describe('MailList — もっと読み込む（AC-8）', () => {
  it('初回20件＋追加20件で重複・欠落なし', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => makeItem(i + 1))
    const more = Array.from({ length: 20 }, (_, i) => makeItem(i + 21))
    loadMoreMock.mockResolvedValue(more)

    render(
      <MailList initialItems={initial} total={40} q="" attachmentsOnly={false} from="/mail" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'もっと読み込む' }))
    expect(loadMoreMock).toHaveBeenCalledWith('', false, 20)

    await waitFor(() => expect(screen.getByText('件名40')).toBeTruthy())

    // 40件すべてが1回ずつ存在すること（重複・欠落なし）。
    for (let i = 1; i <= 40; i++) {
      expect(screen.getAllByText(`件名${i}`)).toHaveLength(1)
    }
    // 全件表示に達したのでボタンは消える。
    expect(screen.queryByRole('button', { name: /もっと読み込む/ })).toBeNull()
  })

  it('追加取得が空配列を返したらボタンが消える', async () => {
    loadMoreMock.mockResolvedValue([])
    const initial = [makeItem(1), makeItem(2)]
    render(
      <MailList initialItems={initial} total={10} q="" attachmentsOnly={false} from="/mail" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'もっと読み込む' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /もっと読み込む/ })).toBeNull(),
    )
    expect(loadMoreMock).toHaveBeenCalledTimes(1)
  })

  it('多重実行ガード（連打で action が1回しか呼ばれない）', async () => {
    let resolveFn: ((v: MailListItem[]) => void) | undefined
    loadMoreMock.mockImplementation(
      () =>
        new Promise<MailListItem[]>((resolve) => {
          resolveFn = resolve
        }),
    )
    const initial = [makeItem(1), makeItem(2)]
    render(
      <MailList initialItems={initial} total={10} q="" attachmentsOnly={false} from="/mail" />,
    )

    const button = screen.getByRole('button', { name: 'もっと読み込む' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    expect(loadMoreMock).toHaveBeenCalledTimes(1)

    resolveFn?.([])
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /もっと読み込む/ })).toBeNull(),
    )
  })

  it('エラー時にメッセージが出てボタンが残り、再試行できる', async () => {
    loadMoreMock.mockRejectedValueOnce(new Error('boom'))
    const initial = [makeItem(1), makeItem(2)]
    render(
      <MailList initialItems={initial} total={10} q="" attachmentsOnly={false} from="/mail" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'もっと読み込む' }))
    await waitFor(() =>
      expect(screen.getByText('読み込みに失敗しました。もう一度お試しください。')).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: 'もっと読み込む' })).toBeTruthy()

    loadMoreMock.mockResolvedValueOnce([makeItem(3)])
    fireEvent.click(screen.getByRole('button', { name: 'もっと読み込む' }))
    await waitFor(() => expect(screen.getByText('件名3')).toBeTruthy())
    expect(
      screen.queryByText('読み込みに失敗しました。もう一度お試しください。'),
    ).toBeNull()
  })
})
