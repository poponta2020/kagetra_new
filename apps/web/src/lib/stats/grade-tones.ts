import { ALL_GRADES, type Grade } from './types'

/**
 * 級（A〜E）の色トーンランプ（design-spec §8 の「虹色でない」トーンランプ）。
 * A=紺（brand）から E=水色鼠へ単調に振る。虹色（色相を回す）ではなく、色相をほぼ固定して
 * 明度/彩度だけを動かすランプなので級の順序が色で読める（A→E で明度が単調増加。
 * 値の導出は docs/features/hokumei-palette/design-spec.md §4）。級別構成の 100% 積み上げ・
 * 図詳細のスウォッチ・一人当たり平均年参加数の棒・（PR-5 の）級構成トーンドットで共有する。
 *
 * 朱（accent）はデータ装飾に使わない（design-spec §8）ため、この 5 色に朱は含めない。
 */
export const GRADE_TONES: Record<Grade, string> = {
  A: '#15387d', // 紺（brand）
  B: '#305892',
  C: '#5079a7',
  D: '#749abb',
  E: '#9bb9ce', // 水色鼠
}

/** 全級（詳細の参照系列）の中立トーン。紺でも水色でもない中立インク。 */
export const ALL_SERIES_TONE = '#3d4958' // neutral-fg（中立インク）

/** 級のトーンを返す（A〜E 以外は全級トーン）。 */
export function gradeTone(key: 'all' | Grade): string {
  return key === 'all' ? ALL_SERIES_TONE : GRADE_TONES[key]
}

/** 系列キーの表示ラベル（全級 / A級〜E級）。 */
export function seriesLabel(key: 'all' | Grade): string {
  return key === 'all' ? '全級' : `${key}級`
}

/** A〜E の [grade, tone] 一覧（凡例用）。 */
export const GRADE_TONE_ENTRIES: readonly (readonly [Grade, string])[] = ALL_GRADES.map(
  (g) => [g, GRADE_TONES[g]] as const,
)
