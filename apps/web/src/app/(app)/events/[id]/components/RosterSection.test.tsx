import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RosterSection, type RosterEntryView, type RosterView } from './RosterSection'

function entry(
  id: number,
  rawName: string,
  overrides: Partial<RosterEntryView> = {},
): RosterEntryView {
  return {
    id,
    rawName,
    grade: 'A',
    rawAffiliation: null,
    status: 'confirmed',
    userId: null,
    user: null,
    ...overrides,
  }
}

function roster(
  id: number,
  version: number,
  entries: RosterEntryView[],
  overrides: Partial<RosterView> = {},
): RosterView {
  return {
    id,
    version,
    rosterType: 'confirmed',
    publishedAt: null,
    entries,
    ...overrides,
  }
}

describe('RosterSection', () => {
  it('同種の有効版が複数あっても version が最大の名簿だけを表示する', () => {
    render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [entry(1, '旧版太郎')]),
          roster(2, 3, [entry(2, '最新版花子')]),
          roster(3, 2, [entry(3, '中間次郎')]),
        ]}
        currentUserId={null}
      />,
    )

    expect(screen.getByText('最新版花子')).toBeTruthy()
    expect(screen.queryByText('旧版太郎')).toBeNull()
    expect(screen.queryByText('中間次郎')).toBeNull()
  })

  it('AC-30: 団体戦（kind="team"）では何も描画しない', () => {
    const { container } = render(
      <RosterSection
        kind="team"
        rosters={[roster(1, 1, [entry(1, '太郎')])]}
        currentUserId={null}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('AC-19: 級の若い順（A→E、級なしは最後）に並ぶ', () => {
    const { container } = render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [
            entry(1, '無級花子', { grade: null }),
            entry(2, 'E級次郎', { grade: 'E' }),
            entry(3, 'A級太郎', { grade: 'A' }),
            entry(4, 'C級三郎', { grade: 'C' }),
          ]),
        ]}
        currentUserId={null}
      />,
    )

    const names = Array.from(container.querySelectorAll('table.roster-table td:first-child')).map(
      (td) => td.textContent,
    )
    expect(names).toEqual(['A級太郎', 'C級三郎', 'E級次郎', '無級花子'])
  })

  it('AC-20: 級タブで絞り込める。初期選択は「全体」で全件表示される', () => {
    render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [
            entry(1, 'C級一郎', { grade: 'C' }),
            entry(2, 'C級二郎', { grade: 'C' }),
            entry(3, 'D級三郎', { grade: 'D' }),
          ]),
        ]}
        currentUserId={null}
      />,
    )

    const allTab = screen.getByRole('tab', { name: /全体/ })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
    // タブの「on」相当クラス（藍・text-brand）が初期選択の全体に付く。
    expect(allTab.className).toContain('text-brand')
    expect(screen.getByText('C級一郎')).toBeTruthy()
    expect(screen.getByText('C級二郎')).toBeTruthy()
    expect(screen.getByText('D級三郎')).toBeTruthy()

    const dTab = screen.getByRole('tab', { name: /D/ })
    fireEvent.click(dTab)

    expect(dTab.getAttribute('aria-selected')).toBe('true')
    expect(dTab.className).toContain('text-brand')
    expect(allTab.getAttribute('aria-selected')).toBe('false')
    expect(allTab.className).not.toContain('text-brand')
    expect(screen.queryByText('C級一郎')).toBeNull()
    expect(screen.queryByText('C級二郎')).toBeNull()
    expect(screen.getByText('D級三郎')).toBeTruthy()
  })

  it('AC-21: 確定名簿が未取込のとき、指定文言が1行だけ表示される', () => {
    render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [entry(1, '太郎')], { rosterType: 'applicant' }),
        ]}
        currentUserId={null}
      />,
    )

    const matches = screen.getAllByText(
      'まだ取り込まれていません。メール取り込みで登録されると、申込者名簿と同じ形式で確定した出場者が並びます。',
    )
    expect(matches).toHaveLength(1)
  })

  it('AC-14: どのロールでも取込フォーム（ファイル入力）が描画されない', () => {
    const { container } = render(
      <RosterSection
        kind="individual"
        rosters={[roster(1, 1, [entry(1, '太郎')], { rosterType: 'applicant' })]}
        currentUserId={null}
      />,
    )
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })

  it('会員突合済みの行は名前が藍・所属の後ろに「・会員」が出る（バッジ要素は使わない）', () => {
    render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [
            entry(1, '会員花子', {
              rawAffiliation: '北大かるた会',
              userId: 'u1',
              user: { id: 'u1', name: '会員花子' },
            }),
          ]),
        ]}
        currentUserId={null}
      />,
    )

    const nameCell = screen.getByText('会員花子', { selector: 'td' })
    expect(nameCell.className).toContain('text-brand-fg')
    expect(screen.getByText('・会員')).toBeTruthy()
    // バッジ（rounded の chip 要素）は使わない。
    expect(document.querySelector('.rounded, [class*="badge"]')).toBeNull()
  })

  it('取消（cancelled）は朱の「取消」＋氏名が落ちる／繰上（carried_up）は朱にしない', () => {
    render(
      <RosterSection
        kind="individual"
        rosters={[
          roster(1, 1, [
            entry(1, '取消太郎', { rawAffiliation: '広島かるた会', status: 'cancelled' }),
            entry(2, '繰上花子', { rawAffiliation: '仙台かるた会', status: 'carried_up' }),
          ]),
        ]}
        currentUserId={null}
      />,
    )

    const cancelledName = screen.getByText('取消太郎', { selector: 'td' })
    expect(cancelledName.className).toContain('text-neutral-fg')
    const cancelledLabel = screen.getByText('取消')
    expect(cancelledLabel.className).toContain('text-accent-fg')

    const carriedUpName = screen.getByText('繰上花子', { selector: 'td' })
    expect(carriedUpName.className).not.toContain('text-accent-fg')
    const carriedUpLabel = screen.getByText('繰上', { exact: true })
    expect(carriedUpLabel).toBeTruthy()
    expect(carriedUpLabel.className).not.toContain('text-accent-fg')
  })
})

// -----------------------------------------------------------------------------
// AC-15 機械ガード: 廃止した名簿 Excel 取込の Server Action（旧 `upload` +
// `Roster`）識別子がリポジトリ（apps/web/src）のどこからも import されて
// いないことをソースレベルで検証する。page-padding.test.ts の
// 「ソースレベル機械ガード」と同種の実装（実際に全ページを認可/DB スタブして
// レンダリングするのはコストが見合わない）。
//
// このテストファイル自身が git grep で誤検知しないよう、探索対象の文字列・
// describe/it のタイトルとも該当識別子を連続した文字列として書かない
// （分割して構築する）。
// -----------------------------------------------------------------------------
describe('AC-15: 名簿 Excel 取込アクションの削除ガード', () => {
  it('廃止した取込アクションの識別子が apps/web/src のどこにも存在しない', () => {
    const needle = 'upload' + 'Roster'
    const webSrcDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '..',
    )

    const offenders: string[] = []
    function walk(dir: string) {
      for (const dirent of readdirSync(dir, { withFileTypes: true })) {
        if (dirent.name === 'node_modules') continue
        const full = join(dir, dirent.name)
        if (dirent.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(dirent.name)) continue
        const source = readFileSync(full, 'utf-8')
        if (source.includes(needle)) offenders.push(full)
      }
    }
    walk(webSrcDir)

    expect(offenders).toEqual([])
  })
})
