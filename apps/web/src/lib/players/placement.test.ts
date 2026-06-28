import { describe, expect, it } from 'vitest'
import {
  derivePlacement,
  isChampion,
  isDerivableClass,
  isNyusho,
  type ClassMatchRow,
  type PlacementMatch,
} from './placement'

/**
 * 1試合分のヘルパ。order は [round, result, roundLabel?, status?]。
 * 単純トーナメント前提の順位導出（design-spec §6 / requirements R1 周辺）の検証。
 */
function m(
  round: number,
  result: 'win' | 'lose',
  roundLabel: string | null = null,
  status: 'normal' | 'walkover' | 'forfeit' = 'normal',
): PlacementMatch {
  return { round, roundLabel, result, status }
}

describe('derivePlacement — 数値 round（4ラウンド=16人ブラケット, classMaxRound=4）', () => {
  it('決勝に勝ち → 優勝 (bracket 1)', () => {
    const ms = [m(1, 'win'), m(2, 'win'), m(3, 'win'), m(4, 'win')]
    expect(derivePlacement(ms, 4)).toEqual({ label: '優勝', bracket: 1 })
  })

  it('決勝で負け → 準優勝 (bracket 2)', () => {
    const ms = [m(1, 'win'), m(2, 'win'), m(3, 'win'), m(4, 'lose')]
    expect(derivePlacement(ms, 4)).toEqual({ label: '準優勝', bracket: 2 })
  })

  it('準決勝で負け → ベスト4 (bracket 4)', () => {
    const ms = [m(1, 'win'), m(2, 'win'), m(3, 'lose')]
    expect(derivePlacement(ms, 4)).toEqual({ label: 'ベスト4', bracket: 4 })
  })

  it('準々決勝で負け → ベスト8 (bracket 8)', () => {
    const ms = [m(1, 'win'), m(2, 'lose')]
    expect(derivePlacement(ms, 4)).toEqual({ label: 'ベスト8', bracket: 8 })
  })

  it('1回戦で負け → ベスト16 (bracket 16)', () => {
    const ms = [m(1, 'lose')]
    expect(derivePlacement(ms, 4)).toEqual({ label: 'ベスト16', bracket: 16 })
  })

  it('シード（1回戦bye, 2回戦から）で決勝負け → 準優勝', () => {
    const ms = [m(2, 'win'), m(3, 'win'), m(4, 'lose')]
    expect(derivePlacement(ms, 4)).toEqual({ label: '準優勝', bracket: 2 })
  })

  it('複数 round bye の第1シードが決勝まで全勝 → 優勝（Codex R4）', () => {
    // 64人枠の第1シードが4回戦から出場し決勝(6回戦)まで全勝。開始 round が遅くても可。
    expect(derivePlacement([m(4, 'win'), m(5, 'win'), m(6, 'win')], 6)).toEqual({
      label: '優勝',
      bracket: 1,
    })
  })

  it('複数 round bye の選手が準決勝で敗退 → ベスト4', () => {
    expect(derivePlacement([m(4, 'win'), m(5, 'lose')], 6)).toEqual({
      label: 'ベスト4',
      bracket: 4,
    })
  })
})

describe('derivePlacement — 意味ラベル（決勝/準決勝/準々決勝）を優先', () => {
  it('roundLabel「準々決勝」で負け → ベスト8（数値 round に依らない）', () => {
    const ms = [m(1, 'win', '2回戦'), m(2, 'lose', '準々決勝')]
    expect(derivePlacement(ms, 9 /* 数値はあてにならない値 */)).toEqual({
      label: 'ベスト8',
      bracket: 8,
    })
  })

  it('roundLabel「準決勝」で負け → ベスト4', () => {
    const ms = [m(1, 'win', '1回戦'), m(2, 'win', '準々決勝'), m(3, 'lose', '準決勝')]
    expect(derivePlacement(ms, 3)).toEqual({ label: 'ベスト4', bracket: 4 })
  })

  it('roundLabel「決勝」で勝ち → 優勝', () => {
    const ms = [m(1, 'win', '準決勝'), m(2, 'win', '決勝')]
    expect(derivePlacement(ms, 2)).toEqual({ label: '優勝', bracket: 1 })
  })

  it('roundLabel「決勝」で負け → 準優勝', () => {
    const ms = [m(1, 'win', '準決勝'), m(2, 'lose', '決勝')]
    expect(derivePlacement(ms, 2)).toEqual({ label: '準優勝', bracket: 2 })
  })
})

describe('derivePlacement — walkover / forfeit', () => {
  it('不戦勝（walkover, result=win）を挟んでも進出として扱う', () => {
    const ms = [m(1, 'win', null, 'walkover'), m(2, 'win'), m(3, 'win'), m(4, 'win')]
    expect(derivePlacement(ms, 4)).toEqual({ label: '優勝', bracket: 1 })
  })

  it('棄権（forfeit, result=lose）で準決勝敗退 → ベスト4', () => {
    const ms = [m(1, 'win'), m(2, 'win'), m(3, 'lose', null, 'forfeit')]
    expect(derivePlacement(ms, 4)).toEqual({ label: 'ベスト4', bracket: 4 })
  })
})

describe('derivePlacement — 導出不能は null（呼び出し側で final_rank フォールバック）', () => {
  it('roundLabel にリーグ戦のサイン → null', () => {
    const ms = [m(1, 'win', '予選リーグ'), m(2, 'lose', '予選リーグ')]
    expect(derivePlacement(ms, 2)).toBeNull()
  })

  it('順位戦のサイン → null', () => {
    expect(derivePlacement([m(1, 'lose', '順位決定戦')], 3)).toBeNull()
  })

  it('2敗以上（3位決定戦/別形式の気配） → null', () => {
    const ms = [m(1, 'win'), m(2, 'lose'), m(3, 'lose')]
    expect(derivePlacement(ms, 3)).toBeNull()
  })

  it('敗北が最終試合でない（敗北後に勝ち＝データ不整合） → null', () => {
    const ms = [m(1, 'win'), m(2, 'lose'), m(4, 'win')]
    expect(derivePlacement(ms, 4)).toBeNull()
  })

  it('最終試合に勝っているが決勝でない（データ欠け） → null', () => {
    const ms = [m(1, 'win'), m(2, 'win')] // classMaxRound 4 なのに2回戦で止まり勝ち
    expect(derivePlacement(ms, 4)).toBeNull()
  })

  it('試合なし → null', () => {
    expect(derivePlacement([], 4)).toBeNull()
  })

  it('classMaxRound がプレイした round より小さい（不整合） → null', () => {
    expect(derivePlacement([m(3, 'lose')], 2)).toBeNull()
  })

  it('同一 round に複数試合（異常） → null', () => {
    const ms = [m(1, 'win'), m(2, 'lose'), m(2, 'win')]
    expect(derivePlacement(ms, 4)).toBeNull()
  })

  it('最終以外の round でも同一 round 重複 → null', () => {
    // 重複が最大 round でなくても検出する（Codex R1 should_fix）。
    expect(derivePlacement([m(1, 'win'), m(1, 'win'), m(2, 'win')], 2)).toBeNull()
  })

  it('出場 round にギャップ（データ欠け）→ null', () => {
    expect(derivePlacement([m(1, 'win'), m(3, 'lose')], 3)).toBeNull()
  })
})

describe('isNyusho / isChampion', () => {
  it('入賞＝ベスト8以上（bracket<=8）', () => {
    expect(isNyusho({ label: '優勝', bracket: 1 })).toBe(true)
    expect(isNyusho({ label: '準優勝', bracket: 2 })).toBe(true)
    expect(isNyusho({ label: 'ベスト4', bracket: 4 })).toBe(true)
    expect(isNyusho({ label: 'ベスト8', bracket: 8 })).toBe(true)
    expect(isNyusho({ label: 'ベスト16', bracket: 16 })).toBe(false)
    expect(isNyusho(null)).toBe(false)
  })

  it('優勝＝bracket 1', () => {
    expect(isChampion({ label: '優勝', bracket: 1 })).toBe(true)
    expect(isChampion({ label: '準優勝', bracket: 2 })).toBe(false)
    expect(isChampion(null)).toBe(false)
  })
})

describe('isDerivableClass — 級全体がシングルイリミか', () => {
  const cm = (
    participantId: number,
    result: 'win' | 'lose',
    roundLabel: string | null = null,
  ): ClassMatchRow => ({ participantId, result, roundLabel })

  it('クリーンなシングルイリミ（敗北数=参加者-1）→ true', () => {
    // 4人: 敗者3（優勝者のみ無敗）。
    const rows = [
      cm(1, 'win', '準決勝'), cm(2, 'lose', '準決勝'),
      cm(3, 'win', '準決勝'), cm(4, 'lose', '準決勝'),
      cm(1, 'win', '決勝'), cm(3, 'lose', '決勝'),
    ]
    expect(isDerivableClass(rows)).toBe(true)
  })

  it('非ブラケットラベル（予選リーグ）→ false', () => {
    expect(isDerivableClass([cm(1, 'win', '予選リーグ'), cm(2, 'lose', '予選リーグ')])).toBe(false)
  })

  it('リーグ戦（通常ラベルでも敗北数 ≠ 参加者-1）→ false', () => {
    // 3人総当たり: 敗北3 ≠ 2。round_label が「N回戦」でも構造で弾く。
    const rows = [
      cm(1, 'win', '1回戦'), cm(2, 'lose', '1回戦'),
      cm(1, 'win', '2回戦'), cm(3, 'lose', '2回戦'),
      cm(2, 'win', '3回戦'), cm(3, 'lose', '3回戦'),
    ]
    expect(isDerivableClass(rows)).toBe(false)
  })

  it('3位決定戦で敗北が1多い（+1）→ false', () => {
    // クリーン4人(敗者3) に 3位決定戦(敗者+1=4) を足すと P-1 を超える。
    const rows = [
      cm(1, 'win', '準決勝'), cm(2, 'lose', '準決勝'),
      cm(3, 'win', '準決勝'), cm(4, 'lose', '準決勝'),
      cm(1, 'win', '決勝'), cm(3, 'lose', '決勝'),
      cm(2, 'win', null), cm(4, 'lose', null), // 3位決定戦（ラベル無しでも数で弾く）
    ]
    expect(isDerivableClass(rows)).toBe(false)
  })

  it('敗北数が参加者-1 より少ない（データ欠け）→ false', () => {
    // 4人だが敗者1しか記録が無い＝不完全（決勝勝者が一意に定まらない）→ 導出不能。
    const rows = [
      cm(1, 'win', '準決勝'), cm(2, 'lose', '準決勝'),
      cm(3, 'win', '準決勝'), cm(4, 'win', '準決勝'),
      cm(1, 'win', '決勝'), cm(3, 'win', '決勝'),
    ]
    expect(isDerivableClass(rows)).toBe(false)
  })

  it('参加者1人/空 → false', () => {
    expect(isDerivableClass([cm(1, 'win', '1回戦')])).toBe(false)
    expect(isDerivableClass([])).toBe(false)
  })
})
