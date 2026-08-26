import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type {
  AttendanceEditAttendee,
  AttendanceEditUser,
} from '@/lib/events/attendance-edit'
import { AttendanceEditSection } from './attendance-edit-section'

/**
 * admin-attendance-edit タスク2 / AC-8（表示側）: 参加者一覧・追加候補の描画と、
 * 追加・削除ボタンが eventId・userId 付きで Server Action を呼ぶことを固定する。
 * 実際の DB 変更・認可・fail-closed 検証は
 * `app/(app)/events/[id]/admin-attendance-actions.test.ts` が持つ。
 */

const ATTENDEES: AttendanceEditAttendee[] = [
  { id: 'u1', name: '山田太郎', grade: 'A', role: 'member', outOfScope: false },
  { id: 'u2', name: '外部一郎', grade: 'B', role: 'guest', outOfScope: false },
  { id: 'u3', name: '級外次郎', grade: 'D', role: 'member', outOfScope: true },
]

const CANDIDATES: AttendanceEditUser[] = [
  { id: 'c1', name: '鈴木花子', grade: 'A', role: 'member' },
  { id: 'c2', name: '佐藤三郎', grade: 'B', role: 'member' },
]

function renderSection(
  overrides: Partial<ComponentProps<typeof AttendanceEditSection>> = {},
) {
  const addAction = vi.fn().mockResolvedValue(undefined)
  const removeAction = vi.fn().mockResolvedValue(undefined)
  render(
    <AttendanceEditSection
      eventId={42}
      attendees={ATTENDEES}
      candidates={CANDIDATES}
      addAction={addAction}
      removeAction={removeAction}
      {...overrides}
    />,
  )
  return { addAction, removeAction }
}

describe('AttendanceEditSection', () => {
  it('参加者を人数つきで並べ、級添字・ゲスト印・対象外マークを出す', () => {
    renderSection()

    expect(screen.getByText(/参加者（3名）/)).toBeTruthy()
    expect(screen.getByText(/山田太郎/)).toBeTruthy()
    // 級添字（詳細ページの参加者欄と同じ最小表現）
    expect(screen.getAllByText('A').length).toBeGreaterThan(0)
    // ゲスト印
    expect(screen.getByText('ゲスト')).toBeTruthy()
    // 対象外マーク（詳細ページには出ない理由を管理者に示す）
    const mark = screen.getByText('対象外')
    expect(mark.getAttribute('title')).toMatch(/詳細ページ/)
  })

  it('削除ボタンは eventId と userId を付けて removeAction を呼ぶ', async () => {
    const { removeAction } = renderSection()

    fireEvent.click(screen.getByRole('button', { name: '級外次郎 を参加者から削除' }))

    await waitFor(() => expect(removeAction).toHaveBeenCalledWith(42, 'u3'))
  })

  it('追加ボタンは eventId と userId を付けて addAction を呼ぶ', async () => {
    const { addAction } = renderSection()

    fireEvent.click(screen.getByRole('button', { name: '鈴木花子 を参加者に追加' }))

    await waitFor(() => expect(addAction).toHaveBeenCalledWith(42, 'c1'))
  })

  it('検索入力でクライアント側の候補を絞り込む', () => {
    renderSection()

    fireEvent.change(screen.getByLabelText('追加候補を氏名で絞り込み'), {
      target: { value: '佐藤' },
    })

    expect(screen.queryByRole('button', { name: '鈴木花子 を参加者に追加' })).toBeNull()
    expect(screen.getByRole('button', { name: '佐藤三郎 を参加者に追加' })).toBeTruthy()
  })

  it('絞り込みで 0 件になったら該当なしを出す', () => {
    renderSection()

    fireEvent.change(screen.getByLabelText('追加候補を氏名で絞り込み'), {
      target: { value: 'いない人' },
    })

    expect(screen.getByText('該当する会員がいません。')).toBeTruthy()
  })

  it('参加者 0 名・候補 0 名の空表示を出す', () => {
    renderSection({ attendees: [], candidates: [] })

    expect(screen.getByText(/参加者（0名）/)).toBeTruthy()
    expect(screen.getByText('まだ参加者がいません。')).toBeTruthy()
    expect(screen.getByText('追加できる会員がいません。')).toBeTruthy()
  })

  it('Server Action が失敗したらエラーメッセージを出す', async () => {
    const removeAction = vi.fn().mockRejectedValue(new Error('Forbidden'))
    renderSection({ removeAction })

    fireEvent.click(screen.getByRole('button', { name: '山田太郎 を参加者から削除' }))

    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy())
  })
})
