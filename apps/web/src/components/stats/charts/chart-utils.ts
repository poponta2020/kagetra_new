import type { YearCountPoint } from '@/lib/stats/overview'

/**
 * 大会統計チャート（棒/ヒスト/100%積み上げ）共通の純粋ユーティリティ。SVG 描画に使う
 * 目盛計算・数値整形・年域の 0 埋めなど、db 非依存で単体テストできるものを集約する。
 */

/** 棒の値ラベル/カード用の桁区切り整数。 */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * 密な棒グラフの値ラベル用の短縮表記。1 万以上は「N.N万」（10 万以上は整数万）、
 * それ未満は桁区切り整数。y 軸目盛にも使う。
 */
export function formatCompact(n: number): string {
  if (n >= 10000) {
    const man = n / 10000
    // 10 万以上（man>=10）は整数万、1〜10 万未満は小数第1位（例：1.2万）。
    return `${man >= 10 ? Math.round(man) : man.toFixed(1)}万`
  }
  return formatInt(n)
}

/** 小数第1位（一人当たり平均・平均枚数差）。 */
export function formatDecimal1(n: number): string {
  return n.toFixed(1)
}

/**
 * 軸の上端を「きりの良い」値へ丸める（0 は 1 に）。1/2/2.5/5/10 × 10^k のいずれか。
 * y 軸目盛線と棒高さの正規化に使う。
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  let nice: number
  if (n <= 1) nice = 1
  else if (n <= 2) nice = 2
  else if (n <= 2.5) nice = 2.5
  else if (n <= 5) nice = 5
  else nice = 10
  return nice * pow
}

/**
 * 0〜niceMax(max) を等分した目盛値（昇順）。top が整数なら割り切れる本数を優先し、目盛が
 * きれいな整数になるようにする（例：top=5→6本[0..5]、top=10→6本[0,2,..,10]）。
 */
export function axisTicks(max: number, preferred = 4): number[] {
  const top = niceMax(max)
  let count = preferred
  if (Number.isInteger(top)) {
    for (const c of [preferred, 5, 3, 2]) {
      if (top % c === 0) {
        count = c
        break
      }
    }
  }
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) ticks.push((top / count) * i)
  return ticks
}

export interface LabeledValue {
  label: string
  value: number
}

/**
 * 年推移点を **連続した年域で 0 埋め** して {label=年, value} 配列に。棒グラフの x 軸を
 * 年で連続させ、欠けた年（大会が無い/中止のみ）も 0 の棒として見せるため。範囲は
 * `from`/`to` 明示（詳細のスモールマルチプルで全系列を揃える）か、無指定ならデータの min〜max。
 * データが空なら空配列。
 */
export function denseYears(
  points: readonly YearCountPoint[],
  from?: number,
  to?: number,
): LabeledValue[] {
  const byYear = new Map<number, number>()
  for (const p of points) byYear.set(p.year, p.count)
  const years = points.map((p) => p.year)
  const lo = from ?? (years.length ? Math.min(...years) : undefined)
  const hi = to ?? (years.length ? Math.max(...years) : undefined)
  if (lo == null || hi == null || lo > hi) return []
  const out: LabeledValue[] = []
  for (let y = lo; y <= hi; y++) {
    out.push({ label: String(y), value: byYear.get(y) ?? 0 })
  }
  return out
}
