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

/** 割合軸の目盛表記（整数はそのまま・端数は小数第1位・末尾 %）。 */
export function formatPercentTick(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

/** 目盛のおおよその目標本数（実際の本数はステップ丸めで前後する）。 */
const TICK_TARGET = 5

/**
 * `rough` 以上で最小の「きりの良い」ステップ（1/2/5 × 10^k）を返す。y 軸を等間隔かつ
 * 読みやすい丸め値で刻むための基本単位。`integer=true`（件数軸）のときは 1 未満へ落とさず
 * 整数へ丸め、0.25 のような小数ステップ＝重複ラベルが出ないようにする。
 */
function niceStep(rough: number, integer: boolean): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(rough))
  const n = rough / pow // 1 <= n < 10
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  const step = mult * pow
  return integer ? Math.max(1, Math.round(step)) : step
}

/**
 * 軸の上端（0〜この値で正規化）。max を「きりの良いステップ」の整数倍へ切り上げる。
 * 0/負は 1。`integer=true` は整数上端（件数軸）を保証する。
 */
export function niceMax(max: number, integer = false): number {
  if (!Number.isFinite(max) || max <= 0) return 1
  const step = niceStep(max / TICK_TARGET, integer)
  return Math.ceil(max / step) * step
}

/**
 * 0〜niceMax(max) を「きりの良いステップ」で等間隔に刻んだ目盛値（昇順）。ステップが整数なら
 * 目盛も整数、小数軸（一人当たり平均など）でも 0/0.5/1.0… のように割り切れる値になる。
 * 旧実装（上端を preferred 等分）は上端が 1 や 2.5 のとき 0.25/0.625 など小数・重複目盛を
 * 出していたので、それを解消する。`integer=true` は件数軸（整数目盛）用。
 */
export function axisTicks(max: number, integer = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const step = niceStep(max / TICK_TARGET, integer)
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  // 浮動小数の誤差で最終目盛が欠けないよう step/2 を許容し、各値も丸める。
  for (let v = 0; v <= top + step / 2; v += step) {
    ticks.push(integer ? Math.round(v) : Number(v.toFixed(4)))
  }
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
