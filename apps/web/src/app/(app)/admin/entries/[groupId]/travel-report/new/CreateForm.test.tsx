import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TravelReportFileDefaults } from '@/lib/travel-report/create'
import { CreateForm } from './CreateForm'

/**
 * S6 のフォーム。Codex R1 の指摘2件を固定する:
 * - #9: 分割を変えたらサーバー側の既定値を取り直す（手で直した項目だけ据え置く）
 * - #10: 遠征先連絡者・留守連絡先を画面で修正できる（R9 の「修正できる6項目」）
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const file = (over: Partial<TravelReportFileDefaults> = {}): TravelReportFileDefaults => ({
  dates: ['2026-11-07', '2026-11-08'],
  purpose: '帯広新人戦(AB級)への参加',
  place: '帯広市総合体育館',
  destinationContacts: [{ name: '北海太郎', phone: '090-0000-0001' }],
  homeContact: { name: '旭川さくら', phone: '090-0000-0002' },
  reportDate: '2026-09-06',
  approvalDate: null,
  memberCount: 2,
  remarkLineCount: 3,
  period: { from: '2026-11-06', to: '2026-11-09', days: 4 },
  pendingNames: [],
  ...over,
})

function setup(defaults: TravelReportFileDefaults[], reloaded?: TravelReportFileDefaults[]) {
  const createAction = vi.fn().mockResolvedValue({ ok: true, fileCount: defaults.length })
  const reloadAction = vi
    .fn()
    .mockResolvedValue({ ok: true, files: reloaded ?? defaults })
  const view = render(
    <CreateForm
      entryGroupId={42}
      defaults={defaults}
      createAction={createAction}
      reloadAction={reloadAction}
    />,
  )
  return { createAction, reloadAction, view }
}

describe('ファイル分割を変えたら既定値を取り直す（Codex R1 #9）', () => {
  it('統合すると reloadAction が新しい分割で呼ばれ、目的と場所が置き換わる', async () => {
    const a = file({ dates: ['2026-11-07', '2026-11-08'], purpose: '帯広新人戦(AB級)への参加' })
    const b = file({ dates: ['2026-11-14'], purpose: '帯広新人戦(D級)への参加', place: '別会場' })
    const merged = file({
      dates: ['2026-11-07', '2026-11-08', '2026-11-14'],
      purpose: '帯広新人戦(ABD級)への参加',
      place: '帯広市総合体育館・別会場',
      memberCount: 5,
    })
    const { reloadAction } = setup([a, b], [merged])

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))

    await waitFor(() => expect(reloadAction).toHaveBeenCalled())
    // 新しい分割（1ファイル・3日）で呼ばれる。
    expect(reloadAction).toHaveBeenCalledWith(42, [['2026-11-07', '2026-11-08', '2026-11-14']])
    await waitFor(() => {
      expect(
        (screen.getByLabelText('ファイル1の目的') as HTMLInputElement).value,
      ).toBe('帯広新人戦(ABD級)への参加')
    })
    expect((screen.getByLabelText('ファイル1の場所') as HTMLInputElement).value).toBe(
      '帯広市総合体育館・別会場',
    )
  })

  it('★手で直した目的は取り直しても据え置かれる（dirty 保持）', async () => {
    const a = file({ dates: ['2026-11-07'] })
    const b = file({ dates: ['2026-11-08'] })
    const merged = file({ dates: ['2026-11-07', '2026-11-08'], purpose: 'サーバーの既定値' })
    const { reloadAction } = setup([a, b], [merged])

    const purpose = screen.getByLabelText('ファイル1の目的') as HTMLInputElement
    fireEvent.change(purpose, { target: { value: '手で直した目的' } })

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalled())

    await waitFor(() => {
      expect((screen.getByLabelText('ファイル1の目的') as HTMLInputElement).value).toBe(
        '手で直した目的',
      )
    })
    // 手を付けていない場所は取り直した値になる。
    expect((screen.getByLabelText('ファイル1の場所') as HTMLInputElement).value).toBe(
      '帯広市総合体育館',
    )
  })

  it('reloadAction が拒否したらエラーを表示する', async () => {
    const createAction = vi.fn()
    const reloadAction = vi
      .fn()
      .mockResolvedValue({ ok: false, error: '選択した日付が現在の開催日と一致しません' })
    render(
      <CreateForm
        entryGroupId={42}
        defaults={[file({ dates: ['2026-11-07'] }), file({ dates: ['2026-11-08'] })]}
        createAction={createAction}
        reloadAction={reloadAction}
      />,
    )
    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('現在の開催日と一致しません')
    })
  })
})

describe('遠征先連絡者・留守連絡先を修正できる（Codex R1 #10 / R9）', () => {
  it('氏名と電話の入力欄があり、編集値が作成 Action へ渡る', async () => {
    const { createAction } = setup([file()])

    const name = screen.getByLabelText('ファイル1の遠征先連絡者の氏名') as HTMLInputElement
    expect(name.value).toBe('北海太郎')
    fireEvent.change(name, { target: { value: '室蘭凛' } })

    const phone = screen.getByLabelText('ファイル1の留守連絡先の電話番号') as HTMLInputElement
    expect(phone.value).toBe('090-0000-0002')
    fireEvent.change(phone, { target: { value: '090-9999-9999' } })

    fireEvent.click(screen.getByText('1 ファイルを作成する'))
    await waitFor(() => expect(createAction).toHaveBeenCalled())
    const payload = createAction.mock.calls[0]![1] as {
      destinationContacts: { name: string }[]
      homeContact: { phone: string } | null
    }[]
    expect(payload[0]!.destinationContacts[0]!.name).toBe('室蘭凛')
    expect(payload[0]!.homeContact!.phone).toBe('090-9999-9999')
  })

  it('留守連絡先が未設定でも入力欄が出て、空のままなら null で送られる', async () => {
    const { createAction } = setup([file({ homeContact: null })])
    const name = screen.getByLabelText('ファイル1の留守連絡先の氏名') as HTMLInputElement
    expect(name.value).toBe('')

    fireEvent.click(screen.getByText('1 ファイルを作成する'))
    await waitFor(() => expect(createAction).toHaveBeenCalled())
    const payload = createAction.mock.calls[0]![1] as { homeContact: unknown }[]
    expect(payload[0]!.homeContact).toBeNull()
  })

  it('連絡者を手で直すと、分割を変えても据え置かれる', async () => {
    const a = file({ dates: ['2026-11-07'] })
    const b = file({ dates: ['2026-11-08'] })
    const merged = file({
      dates: ['2026-11-07', '2026-11-08'],
      destinationContacts: [{ name: 'サーバーの既定値', phone: '090-0000-0003' }],
    })
    const { reloadAction } = setup([a, b], [merged])

    const name = screen.getByLabelText('ファイル1の遠征先連絡者の氏名') as HTMLInputElement
    fireEvent.change(name, { target: { value: '手で直した連絡者' } })

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalled())
    await waitFor(() => {
      expect(
        (screen.getByLabelText('ファイル1の遠征先連絡者の氏名') as HTMLInputElement).value,
      ).toBe('手で直した連絡者')
    })
  })
})

describe('分割操作の競合と統合時の dirty（Codex R2）', () => {
  it('★続けて分割操作をしたとき、古い再計算の応答は捨てられる', async () => {
    // 1回目の reload は遅れて解決し、2回目の分割が確定したあとに返る。
    // ホルダー経由にする（`let x: F | null = null` だと、クロージャ内の代入を
    // 制御フロー解析が追えず後段の呼び出しが型エラーになる）。
    const first: { resolve?: (v: unknown) => void } = {}
    const a = file({ dates: ['2026-11-07'], purpose: 'A' })
    const b = file({ dates: ['2026-11-08'], purpose: 'B' })
    const c = file({ dates: ['2026-11-14'], purpose: 'C' })
    const createAction = vi.fn().mockResolvedValue({ ok: true, fileCount: 1 })
    const reloadAction = vi
      .fn()
      // 1回目（ファイル1と2の統合）— あとで解決させる
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first.resolve = resolve
          }),
      )
      // 2回目（さらに3も統合）— すぐ解決
      .mockResolvedValueOnce({
        ok: true,
        files: [file({ dates: ['2026-11-07', '2026-11-08', '2026-11-14'], purpose: '最新の分割' })],
      })

    render(
      <CreateForm
        entryGroupId={42}
        defaults={[a, b, c]}
        createAction={createAction}
        reloadAction={reloadAction}
      />,
    )

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect((screen.getByLabelText('ファイル1の目的') as HTMLInputElement).value).toBe('最新の分割')
    })

    // 遅れて返った1回目の応答は捨てられ、最新の値のまま。
    first.resolve?.({
      ok: true,
      files: [file({ dates: ['2026-11-07', '2026-11-08'], purpose: '古い分割の既定値' })],
    })
    await waitFor(() => {
      expect((screen.getByLabelText('ファイル1の目的') as HTMLInputElement).value).toBe('最新の分割')
    })
  })

  it('★2番目のファイルだけ手で直した値は統合後も残る', async () => {
    const a = file({ dates: ['2026-11-07'], purpose: 'ファイル1の既定値' })
    const b = file({ dates: ['2026-11-08'], purpose: 'ファイル2の既定値' })
    const { reloadAction } = setup(
      [a, b],
      [file({ dates: ['2026-11-07', '2026-11-08'], purpose: 'サーバーの既定値' })],
    )

    // ファイル2だけを手で直す（ファイル1は未編集）。
    const purpose2 = screen.getByLabelText('ファイル2の目的') as HTMLInputElement
    fireEvent.change(purpose2, { target: { value: 'ファイル2で直した目的' } })

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalled())
    await waitFor(() => {
      expect((screen.getByLabelText('ファイル1の目的') as HTMLInputElement).value).toBe(
        'ファイル2で直した目的',
      )
    })
  })
})

describe('final レビューの指摘（再計算中の作成・連絡先の dirty 分離）', () => {
  it('★再計算が終わるまで作成ボタンを押せない', async () => {
    const first: { resolve?: (v: unknown) => void } = {}
    const createAction = vi.fn()
    const reloadAction = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first.resolve = resolve
        }),
    )
    render(
      <CreateForm
        entryGroupId={42}
        defaults={[file({ dates: ['2026-11-07'] }), file({ dates: ['2026-11-08'] })]}
        createAction={createAction}
        reloadAction={reloadAction}
      />,
    )
    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(screen.getByText('再計算しています…')).not.toBeNull())

    const button = screen.getByText('再計算しています…').closest('button')!
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(createAction).not.toHaveBeenCalled()

    first.resolve?.({
      ok: true,
      files: [file({ dates: ['2026-11-07', '2026-11-08'] })],
    })
    await waitFor(() => expect(screen.getByText('1 ファイルを作成する')).not.toBeNull())
  })

  it('★遠征先連絡者だけ直しても、留守連絡先は再計算結果で更新される', async () => {
    const a = file({ dates: ['2026-11-07'] })
    const b = file({ dates: ['2026-11-08'] })
    const merged = file({
      dates: ['2026-11-07', '2026-11-08'],
      destinationContacts: [{ name: 'サーバーの遠征先', phone: '090-1111-1111' }],
      homeContact: { name: 'サーバーの留守', phone: '090-2222-2222' },
    })
    const { reloadAction } = setup([a, b], [merged])

    const dest = screen.getByLabelText('ファイル1の遠征先連絡者の氏名') as HTMLInputElement
    fireEvent.change(dest, { target: { value: '手で直した遠征先' } })

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalled())

    await waitFor(() => {
      // 直した側は据え置き。
      expect(
        (screen.getByLabelText('ファイル1の遠征先連絡者の氏名') as HTMLInputElement).value,
      ).toBe('手で直した遠征先')
    })
    // 直していない留守連絡先は再計算結果で置き換わる。
    expect((screen.getByLabelText('ファイル1の留守連絡先の氏名') as HTMLInputElement).value).toBe(
      'サーバーの留守',
    )
  })
})

describe('再計算の応答順が逆転しても作成が禁止されたままにならない（Codex final-delta）', () => {
  it('★新しい分割の応答が先に成功し、あとから古い分割の応答が返っても作成できる', async () => {
    // 1回目（古い分割）は遅れて解決し、2回目（新しい分割）が先に解決する。
    const first: { resolve?: (v: unknown) => void } = {}
    const createAction = vi.fn().mockResolvedValue({ ok: true, fileCount: 1 })
    const reloadAction = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first.resolve = resolve
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        files: [file({ dates: ['2026-11-07', '2026-11-08', '2026-11-14'], purpose: '最新の分割' })],
      })

    render(
      <CreateForm
        entryGroupId={42}
        defaults={[
          file({ dates: ['2026-11-07'] }),
          file({ dates: ['2026-11-08'] }),
          file({ dates: ['2026-11-14'] }),
        ]}
        createAction={createAction}
        reloadAction={reloadAction}
      />,
    )

    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    fireEvent.click(screen.getByText('⇅ ファイル1と2を統合する'))
    await waitFor(() => expect(reloadAction).toHaveBeenCalledTimes(2))

    // 遅れて古い分割の応答が「成功」で返る。
    first.resolve?.({
      ok: true,
      files: [file({ dates: ['2026-11-07', '2026-11-08'], purpose: '古い分割' })],
    })

    // 作成ボタンが押せる状態に戻り、実際に作成できる（settledSplit が巻き戻らない）。
    await waitFor(() => {
      const button = screen.getByText('1 ファイルを作成する').closest('button')!
      expect(button.hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByText('1 ファイルを作成する'))
    await waitFor(() => expect(createAction).toHaveBeenCalled())
    const payload = createAction.mock.calls[0]![1] as { purpose: string }[]
    expect(payload[0]!.purpose).toBe('最新の分割')
  })
})
