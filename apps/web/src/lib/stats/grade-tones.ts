import { ALL_GRADES, type Grade } from './types'

/**
 * 級（A〜E）の色トーンランプ。design-spec §8 の「藍→砂トーンランプ（虹色でない）」。
 * A=藍（brand）から E=砂（生成り）へ単調に振る。虹色（色相を回す）ではなく、藍→中立→砂の
 * 明度/彩度ランプなので級の順序が色で読める。級別構成の 100% 積み上げ・図詳細のスウォッチ・
 * 一人当たり平均年参加数の棒・（PR-5 の）級構成トーンドットで共有する。
 *
 * 朱（accent）はデータ装飾に使わない（design-spec §8）ため、この 5 色に朱は含めない。
 */
export const GRADE_TONES: Record<Grade, string> = {
  A: '#2b4e8c', // 藍（brand）
  B: '#4e658b',
  C: '#727c8b',
  D: '#95938a',
  E: '#b8aa8a', // 砂（border-strong 近似）
}

/** 全級（詳細の参照系列）の中立トーン。藍でも砂でもない中立インク寄り。 */
export const ALL_SERIES_TONE = '#5b4f33' // neutral-fg（中立インク）

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
