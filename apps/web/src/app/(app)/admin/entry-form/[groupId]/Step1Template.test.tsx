import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CellMap } from '@/lib/entry-form/cell-map'
import type { EntryFormMemberRow, EntryFormTemplateCandidate, TemplateAnalysis } from './actions'
import { Step1Template } from './Step1Template'

function member(overrides: Partial<EntryFormMemberRow> = {}): EntryFormMemberRow {
  return {
    userId: 'u1',
    displayName: '青木 悠人',
    needsNameInput: false,
    grade: 'A',
    dan: 4,
    familyName: '青木',
    givenName: '悠人',
    familyKana: 'あおき',
    givenKana: 'ゆうと',
    appearanceCount: 2,
    note: null,
    ...overrides,
  }
}

const candidate: EntryFormTemplateCandidate = {
  attachmentId: 1,
  filename: '第３回青森大会参加申込書.xlsx',
  sizeBytes: 12345,
  receivedAt: '2026-05-08T00:30:00Z',
  mailSubject: '第3回青森大会のご案内',
}

function heuristicAnalysis(overrides: Partial<TemplateAnalysis> = {}): TemplateAnalysis {
  const cellMap: CellMap = {
    sheets: [
      {
        sheetName: 'Sheet1',
        targetGrades: null,
        startRow: 12,
        columns: { grade: 'B', dan: 'E', familyName: 'F', givenName: 'G', fullKana: 'H' },
        headerCells: {},
        danFormat: 'n段',
      },
    ],
  }
  return {
    cellMap,
    source: 'heuristic',
    warnings: [],
    organizerEmail: null,
    organizerInstructions: null,
    sheetNames: ['Sheet1'],
    templateFilename: candidate.filename,
    ...overrides,
  }
}

const baseProps = {
  memberCount: 15,
  selection: null,
  onSelectionChange: vi.fn(),
  analysis: null,
  analyzing: false,
  analyzeError: null,
  cellMap: null,
  activeSheetIndex: 0,
  onActiveSheetChange: vi.fn(),
  onColumnChange: vi.fn(),
  onAddManualSheet: vi.fn(),
  onStartRowChange: vi.fn(),
  onTargetGradesChange: vi.fn(),
  onRemoveSheet: vi.fn(),
  members: [member()],
  onNext: vi.fn(),
}

describe('Step1Template — テンプレ候補（AC-4）', () => {
  it('候補が一覧表示される', () => {
    render(<Step1Template {...baseProps} candidates={[candidate]} />)
    expect(screen.getByText('第３回青森大会参加申込書.xlsx')).toBeTruthy()
    expect(screen.getByText('案内メール添付・5/8受信')).toBeTruthy()
  })

  it('候補0件はアップロード誘導が出る', () => {
    render(<Step1Template {...baseProps} candidates={[]} />)
    expect(
      screen.getByText('案内メールに xlsx 添付が見つかりませんでした。申込書ファイルをアップロードしてください。'),
    ).toBeTruthy()
    expect(screen.getByText('ファイルをアップロード…')).toBeTruthy()
  })

  it('候補を選ぶと onSelectionChange が呼ばれる', () => {
    const onSelectionChange = vi.fn()
    render(<Step1Template {...baseProps} candidates={[candidate]} onSelectionChange={onSelectionChange} />)
    fireEvent.click(screen.getByText('第３回青森大会参加申込書.xlsx'))
    expect(onSelectionChange).toHaveBeenCalledWith({
      kind: 'candidate',
      attachmentId: 1,
      filename: candidate.filename,
    })
  })
})

describe('Step1Template — 列の対応（自動判定成功）', () => {
  it('✓ 自動判定に成功 の表示と列一覧', () => {
    const analysis = heuristicAnalysis()
    // 単一子要素の入れ子（<span><b>B列</b></span> のように祖先・子で textContent が
    // 完全一致するケース）は getByText の厳密一致でも複数要素ヒットしてエラーになるため、
    // container 全体のテキストで存在確認する。
    const { container } = render(
      <Step1Template
        {...baseProps}
        candidates={[candidate]}
        selection={{ kind: 'candidate', attachmentId: 1, filename: candidate.filename }}
        analysis={analysis}
        cellMap={analysis.cellMap}
      />,
    )
    expect(screen.getByText('✓ 自動判定に成功')).toBeTruthy()
    expect(container.textContent).toContain('B列')
    expect(screen.getByText('次へ — 会員の確認（15名）')).toBeTruthy()
  })
})

describe('Step1Template — AI フォールバック', () => {
  it('source: "ai" のとき AI 告知面と「AI」タグが出る', () => {
    const analysis = heuristicAnalysis({ source: 'ai' })
    render(
      <Step1Template
        {...baseProps}
        candidates={[candidate]}
        selection={{ kind: 'candidate', attachmentId: 1, filename: candidate.filename }}
        analysis={analysis}
        cellMap={analysis.cellMap}
      />,
    )
    expect(screen.getByText('AI が列の対応を推定しました。')).toBeTruthy()
    expect(screen.getAllByText('AI').length).toBeGreaterThan(0)
  })

  it('source: "unresolved" のとき手動マッピングへの誘導が出る', () => {
    const analysis = heuristicAnalysis({ source: 'unresolved', cellMap: { sheets: [] } })
    const { container } = render(
      <Step1Template
        {...baseProps}
        candidates={[candidate]}
        selection={{ kind: 'candidate', attachmentId: 1, filename: candidate.filename }}
        analysis={analysis}
        cellMap={analysis.cellMap}
      />,
    )
    expect(container.textContent).toContain('列の対応を自動推定できませんでした。下の一覧から手動で指定してください')
  })
})

describe('Step1Template — 級別複数シート', () => {
  it('cellMap.sheets.length > 1 でシートタブが出る', () => {
    const cellMap: CellMap = {
      sheets: [
        {
          sheetName: 'C級申込書',
          targetGrades: ['C'],
          startRow: 8,
          columns: { grade: 'C', familyName: 'E' },
          headerCells: {},
          danFormat: 'n段',
        },
        {
          sheetName: 'D級申込書',
          targetGrades: ['D'],
          startRow: 8,
          columns: { grade: 'D', familyName: 'E' },
          headerCells: {},
          danFormat: 'n段',
        },
      ],
    }
    const analysis = heuristicAnalysis({ cellMap })
    const { container } = render(
      <Step1Template
        {...baseProps}
        candidates={[candidate]}
        selection={{ kind: 'candidate', attachmentId: 1, filename: candidate.filename }}
        analysis={analysis}
        cellMap={cellMap}
        members={[member({ userId: 'u1', grade: 'C' }), member({ userId: 'u2', grade: 'D' })]}
      />,
    )
    expect(container.textContent).toContain('C級申込書')
    expect(container.textContent).toContain('D級申込書')
  })
})
