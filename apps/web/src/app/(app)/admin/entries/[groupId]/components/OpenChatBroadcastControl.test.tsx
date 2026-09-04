import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OpenChatBroadcastControl } from './OpenChatBroadcastControl'
import {
  broadcastOpenChats,
  loadOpenChatBroadcastSummary,
} from '@/app/(app)/admin/mail-inbox/open-chat-actions'

/**
 * openchat-broadcast 2026-09-04 改修: オープンチャット配信のやり直し導線。
 *
 * ★通常の配信はメール本文・添付と同じ「実行する」に相乗りする（`processMail`）。
 * そちらが失敗したときの再送はここにしか無い（統合処理フォームは未処理のメール
 * にしか出ず、「未処理に戻す」は名簿の採用まで取り消すので代替にならない）ので、
 * **確認ダイアログ／直接送信／未紐付け時の抑止**の3分岐を押さえる。
 */
vi.mock('@/app/(app)/admin/mail-inbox/open-chat-actions', () => ({
  broadcastOpenChats: vi.fn(),
  loadOpenChatBroadcastSummary: vi.fn(),
}))

const summaryMock = vi.mocked(loadOpenChatBroadcastSummary)
const broadcastMock = vi.mocked(broadcastOpenChats)

type Summary = Awaited<ReturnType<typeof loadOpenChatBroadcastSummary>>

function summary(patch: Partial<Summary> = {}): Summary {
  return { broadcastCount: 0, lastSentAt: null, lastAttempt: null, rows: [], ...patch }
}

const rowC = {
  id: 1,
  url: 'https://line.me/ti/g2/SAVED00001',
  label: 'C級',
  isNew: false,
}
const rowD = {
  id: 2,
  url: 'https://line.me/ti/g2/SAVED00002',
  label: 'D級',
  isNew: true,
}

beforeEach(() => {
  summaryMock.mockReset()
  summaryMock.mockResolvedValue(summary())
  broadcastMock.mockReset()
  broadcastMock.mockResolvedValue({ status: 'sent', sentCount: 1 })
})

describe('OpenChatBroadcastControl', () => {
  it('保存済みが0件なら何も描画しない', async () => {
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    await waitFor(() => {
      expect(summaryMock).toHaveBeenCalledWith(10)
    })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('未配信なら確認を挟まずその場で配信する', async () => {
    summaryMock.mockResolvedValue(summary({ rows: [rowC] }))
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    const button = await waitFor(() =>
      screen.getByRole('button', { name: /オープンチャットを配信（1件）/ }),
    )
    fireEvent.click(button)

    expect(screen.queryByText('もう一度配信しますか')).toBeNull()
    await waitFor(() => {
      expect(broadcastMock).toHaveBeenCalledWith(10)
    })
    await waitFor(() => {
      expect(screen.getByText('1件を配信しました')).toBeTruthy()
    })
  })

  it('AC-35: 2回目以降は全件のラベルを列挙した確認を挟み、やめれば送らない', async () => {
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 1, lastSentAt: new Date(), rows: [rowC, rowD] }),
    )
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    const button = await waitFor(() =>
      screen.getByRole('button', { name: /オープンチャットを配信（2件）/ }),
    )
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('もう一度配信しますか')).toBeTruthy()
    })
    expect(screen.getByText(/すでに 1 回/)).toBeTruthy()
    expect(screen.getByText('・C級')).toBeTruthy()
    expect(screen.getByText('・D級（今回追加）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(screen.queryByText('もう一度配信しますか')).toBeNull()
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('確認で配信を選ぶと送る', async () => {
    summaryMock.mockResolvedValue(
      summary({ broadcastCount: 2, lastSentAt: new Date(), rows: [rowC] }),
    )
    broadcastMock.mockResolvedValue({ status: 'sent', sentCount: 1 })
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    fireEvent.click(
      await waitFor(() => screen.getByRole('button', { name: /オープンチャットを配信（1件）/ })),
    )
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: '1件を配信' })))

    await waitFor(() => {
      expect(broadcastMock).toHaveBeenCalledWith(10)
    })
  })

  it('LINE 未紐付けならボタンを押せず、理由を出す', async () => {
    summaryMock.mockResolvedValue(summary({ rows: [rowC] }))
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked={false} />)

    const button = await waitFor(() =>
      screen.getByRole('button', { name: /オープンチャットを配信（1件）/ }),
    )
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('LINE グループが未紐付けのため配信できません。')).toBeTruthy()
  })

  it('配信に失敗したら理由を出す（記録だけして黙らない）', async () => {
    summaryMock.mockResolvedValue(summary({ rows: [rowC] }))
    broadcastMock.mockResolvedValue({ status: 'failed', error: 'LINE push failed: 500' })
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    fireEvent.click(
      await waitFor(() => screen.getByRole('button', { name: /オープンチャットを配信（1件）/ })),
    )

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('配信に失敗しました')
    })
  })

  it('直近の配信が失敗していたら、押す前にその旨を出す', async () => {
    summaryMock.mockResolvedValue(
      summary({
        rows: [rowC],
        lastAttempt: { status: 'failed', errorMessage: 'boom', at: new Date() },
      }),
    )
    render(<OpenChatBroadcastControl entryGroupId={10} lineLinked />)

    await waitFor(() => {
      expect(screen.getByText(/前回の配信は届いていません/)).toBeTruthy()
    })
  })
})
