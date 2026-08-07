import { describe, it, expect } from 'vitest'
import {
  buildAutoOpenChatLabel,
  findDuplicateOpenChatLabelIds,
  formatOpenChatGradeLabel,
  resolveOpenChatLabel,
  OPEN_CHAT_DEFAULT_LABEL,
  type OpenChatDuplicateCheckRow,
} from './label'

// 2026-06-20 は土曜日（requirements.md §3.2.1 の例と同じ日付）。
const SATURDAY = '2026-06-20'

describe('formatOpenChatGradeLabel', () => {
  it('単一級 → "C級"', () => {
    expect(formatOpenChatGradeLabel(['C'])).toBe('C級')
  })

  it('複数級は A→E 昇順で「・」連結（重複入力・逆順入力も正規化される）', () => {
    expect(formatOpenChatGradeLabel(['B', 'A'])).toBe('A・B級')
    expect(formatOpenChatGradeLabel(['A', 'A', 'B'])).toBe('A・B級')
  })

  it('空配列 → 空文字', () => {
    expect(formatOpenChatGradeLabel([])).toBe('')
  })
})

describe('buildAutoOpenChatLabel（AC-21, AC-22, AC-24 の4分岐）', () => {
  it('級・開催日ともにあり → "6/20(土) C級"', () => {
    expect(buildAutoOpenChatLabel(['C'], SATURDAY)).toBe('6/20(土) C級')
  })

  it('級のみ → "C級"', () => {
    expect(buildAutoOpenChatLabel(['C'], null)).toBe('C級')
  })

  it('開催日のみ → "6/20(土)"', () => {
    expect(buildAutoOpenChatLabel(null, SATURDAY)).toBe('6/20(土)')
  })

  it('どちらも無し → "オープンチャットに参加"（AC-22・AC-24: 全級・全日共通）', () => {
    expect(buildAutoOpenChatLabel(null, null)).toBe(OPEN_CHAT_DEFAULT_LABEL)
    expect(buildAutoOpenChatLabel([], null)).toBe(OPEN_CHAT_DEFAULT_LABEL)
  })

  it('複数級 + 開催日の組み合わせも級ラベルの整形規則に従う', () => {
    expect(buildAutoOpenChatLabel(['A', 'B'], SATURDAY)).toBe('6/20(土) A・B級')
  })
})

describe('resolveOpenChatLabel（AC-23: 自由ラベル優先 + isAuto の区別）', () => {
  it('自由ラベルがあればそれが最終ラベルになり isAuto=false', () => {
    const resolved = resolveOpenChatLabel({ grades: ['C'], eventDate: SATURDAY, freeLabel: '選抜の部' })
    expect(resolved).toEqual({ label: '選抜の部', isAuto: false })
  })

  it('自由ラベルが空文字・空白のみなら自動生成にフォールバックし isAuto=true', () => {
    expect(resolveOpenChatLabel({ grades: ['C'], eventDate: null, freeLabel: '' })).toEqual({
      label: 'C級',
      isAuto: true,
    })
    expect(resolveOpenChatLabel({ grades: ['C'], eventDate: null, freeLabel: '   ' })).toEqual({
      label: 'C級',
      isAuto: true,
    })
  })

  it('自由ラベル・級・開催日すべて未指定 → 既定ラベル', () => {
    expect(resolveOpenChatLabel({ grades: null, eventDate: null, freeLabel: null })).toEqual({
      label: OPEN_CHAT_DEFAULT_LABEL,
      isAuto: true,
    })
  })
})

describe('findDuplicateOpenChatLabelIds（AC-47, AC-48, AC-49）', () => {
  it('AC-48: 級・開催日とも未指定の行が2つ以上あると重複として検出される（自動ラベルが同一になるため）', () => {
    const rows: OpenChatDuplicateCheckRow<number>[] = [
      { id: 0, grades: null, eventDate: null, freeLabel: null },
      { id: 1, grades: null, eventDate: null, freeLabel: null },
    ]
    expect(findDuplicateOpenChatLabelIds(rows)).toEqual(new Set([0, 1]))
  })

  it('AC-47: 3行以上でも同一最終ラベルの行だけがまとめて重複扱いになる', () => {
    const rows: OpenChatDuplicateCheckRow<number>[] = [
      { id: 0, grades: null, eventDate: null, freeLabel: null },
      { id: 1, grades: ['C'], eventDate: SATURDAY, freeLabel: null },
      { id: 2, grades: null, eventDate: null, freeLabel: null },
    ]
    expect(findDuplicateOpenChatLabelIds(rows)).toEqual(new Set([0, 2]))
  })

  it('AC-49: 片方に自由ラベルを入れると重複が解消する', () => {
    const rows: OpenChatDuplicateCheckRow<number>[] = [
      { id: 0, grades: null, eventDate: null, freeLabel: null },
      { id: 1, grades: null, eventDate: null, freeLabel: '1年の部' },
    ]
    expect(findDuplicateOpenChatLabelIds(rows)).toEqual(new Set())
  })

  it('級のみ同じで開催日が違う2行は重複しない', () => {
    const rows: OpenChatDuplicateCheckRow<number>[] = [
      { id: 0, grades: ['C'], eventDate: '2026-06-20', freeLabel: null },
      { id: 1, grades: ['C'], eventDate: '2026-06-21', freeLabel: null },
    ]
    expect(findDuplicateOpenChatLabelIds(rows)).toEqual(new Set())
  })

  it('全行の最終ラベルが異なれば重複なし', () => {
    const rows: OpenChatDuplicateCheckRow<string>[] = [
      { id: 'a', grades: ['A'], eventDate: null, freeLabel: null },
      { id: 'b', grades: ['B'], eventDate: null, freeLabel: null },
      { id: 'c', grades: null, eventDate: SATURDAY, freeLabel: null },
    ]
    expect(findDuplicateOpenChatLabelIds(rows)).toEqual(new Set())
  })

  it('空配列の入力は重複なし', () => {
    expect(findDuplicateOpenChatLabelIds([])).toEqual(new Set())
  })
})
