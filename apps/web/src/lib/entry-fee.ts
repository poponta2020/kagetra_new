import { officialEntryFeeJpy } from '@kagetra/shared'
import type { EventKind, Grade } from '@kagetra/shared/types'
import { resolveTargetGrades } from '@/lib/event-grade-broadcast'
import { formatFeeAmount } from '@/lib/event-lifecycle-notify'

/**
 * grade-entry-fee: 参加費の単価解決・同単価グルーピング・表示整形。
 *
 * **このモジュールは DB を触らない**（純関数のみ）。単価解決を
 * `buildLifecycleMessage`（通知文面のユニットテスト）とイベント詳細画面の双方から
 * 使うため、db を import すると文面テストが DB 依存になる。集計クエリは
 * `entry-fee-tally.ts` が持つ。
 *
 * 単価の決め方（requirements §3.2.1）:
 *
 * ```
 * official = true かつ kind = 'individual' → 級別規定額を常に導出（events.fee_jpy は見ない）
 * それ以外（非公認 / kind = 'team'）        → events.fee_jpy をそのまま
 * ```
 *
 * **`feeJpy ?? derived` ではない。** official な個人戦では格納値を一切参照しない。
 * 公認大会の参加料は協会規定で大会ごとの裁量が無く、本番の格納値は多級イベントで
 * 実際に誤っている（スカラー1本では表現できない）ため。
 */

/**
 * 単価解決の入力。`events` の4列だけを取り出した形にして、Drizzle の行型に
 * 依存させない（画面・通知バッチ・Server Action の3経路から同じ形で渡せる）。
 */
export interface EntryFeeSource {
  official: boolean
  kind: EventKind
  eligibleGrades: Grade[] | null | undefined
  feeJpy: number | null | undefined
}

/** 同一単価でまとめた級のグループ。`grades` は A→E 順。 */
export interface UnitPriceGroup {
  grades: Grade[]
  feeJpy: number
}

export interface EntryFeeResolution {
  /** 対象級（A→E 順）。`eligibleGrades` が NULL / 空配列なら全級。 */
  targetGrades: Grade[]
  /** 級 → 単価。解決できなかった級はキーを持たない（0 を入れない）。 */
  unitPriceByGrade: Partial<Record<Grade, number>>
  /** 同一単価でまとめたグループ（A→E 順）。単価が解決できた級だけを含む。 */
  groups: UnitPriceGroup[]
  /** 単価が1つに定まる（＝単一料金）ならその額。多級・未解決なら null。 */
  singleUnitJpy: number | null
  /** 多級のときだけの級別表記（例 `A・B級 2,500円 / C級 2,000円`）。単一料金・未解決なら null。 */
  unitPricesLabel: string | null
  /** 人数 × 単価で総額を出してよいか。official な個人戦だけ true（requirements §3.2.2）。 */
  perPersonPriced: boolean
}

/** 級を A→E の正順に並べるための序数。 */
const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }

/**
 * 級の並びを `A・B級` の形にする。`grades` は A→E 順で渡すこと。
 * 空配列では `級` だけが残らないよう空文字を返す（呼び出し側は空グループを作らない）。
 */
export function formatGradesLabel(grades: readonly Grade[]): string {
  return grades.length > 0 ? `${grades.join('・')}級` : ''
}

/** 級を A→E 順にまとめ、同一単価のものを1グループに畳む。 */
function groupGradesByUnitPrice(
  grades: readonly Grade[],
  unitPriceByGrade: Partial<Record<Grade, number>>,
): UnitPriceGroup[] {
  // Map の挿入順は「最初に現れた級」の順 = A→E 順になる（grades が A→E 順のため）。
  const byPrice = new Map<number, Grade[]>()
  for (const grade of grades) {
    const price = unitPriceByGrade[grade]
    if (price == null) continue
    const bucket = byPrice.get(price)
    if (bucket) bucket.push(grade)
    else byPrice.set(price, [grade])
  }
  return [...byPrice].map(([feeJpy, gs]) => ({ grades: gs, feeJpy }))
}

/** 級別単価の表記（例 `A・B級 2,500円 / C級 2,000円`）。グループが無ければ null。 */
export function formatUnitPricesLabel(groups: readonly UnitPriceGroup[]): string | null {
  if (groups.length === 0) return null
  return groups
    .map((g) => `${formatGradesLabel(g.grades)} ${formatFeeAmount(g.feeJpy)}`)
    .join(' / ')
}

/**
 * イベント1件の単価を解決する。対象級の決定は `resolveTargetGrades`
 * （イベント詳細・級別配信と同じ実装）に委ね、ここで再定義しない。
 */
export function resolveEntryFee(src: EntryFeeSource): EntryFeeResolution {
  const targetGrades = resolveTargetGrades(src.eligibleGrades ?? null)
  const perPersonPriced = src.official && src.kind === 'individual'
  const storedFee = src.feeJpy ?? null

  const unitPriceByGrade: Partial<Record<Grade, number>> = {}
  for (const grade of targetGrades) {
    // official な個人戦は格納値を見ない。それ以外は級によらず fee_jpy 一律。
    const price = perPersonPriced ? officialEntryFeeJpy(grade) : storedFee
    if (price != null) unitPriceByGrade[grade] = price
  }

  const groups = groupGradesByUnitPrice(targetGrades, unitPriceByGrade)
  return {
    targetGrades,
    unitPriceByGrade,
    groups,
    singleUnitJpy: groups.length === 1 ? groups[0]!.feeJpy : null,
    unitPricesLabel: groups.length > 1 ? formatUnitPricesLabel(groups) : null,
    perPersonPriced,
  }
}

/**
 * 級1つぶんの単価。対象級外・級未設定・単価未解決では null。
 * 「その級がいくら払うか」だけを返し、表示可否の判断はしない。
 */
export function entryFeeForGrade(
  src: EntryFeeSource,
  grade: Grade | null | undefined,
): number | null {
  if (grade == null) return null
  return resolveEntryFee(src).unitPriceByGrade[grade] ?? null
}

/**
 * 会員向け「あなたの参加費」に出す額（requirements §3.2.5）。
 * `kind='team'` では **必ず null**（1チーム単価を個人の額と誤読させないため）。
 * 出欠の回答状況は問わない（申し込む前に金額を知りたいため）。
 */
export function memberEntryFeeJpy(
  src: EntryFeeSource,
  grade: Grade | null | undefined,
): number | null {
  if (src.kind !== 'individual') return null
  return entryFeeForGrade(src, grade)
}

/** 級ごとの人数と単価。`entry-fee-tally.ts` が集計した結果を整形へ渡すための形。 */
export interface GradeHeadcount {
  grade: Grade
  count: number
  unitJpy: number
}

export interface FeeTallySummary {
  /** Σ(人数 × 単価)。対象が居なければ 0。 */
  totalJpy: number
  /** 内訳（例 `A・B級 2名×2,500 / C級 3名×2,000`）。対象が居なければ null。 */
  breakdownLabel: string | null
}

/**
 * 級別の人数と単価から総額と内訳ラベルを組み立てる。
 *
 * 同一単価の級はまとめ、**人数が 0 の級は内訳に出さない**（`A・B級 2名×2,500` の
 * `A・B` は「その単価帯で実際に参加する級」を指す）。複数日グループの合算では
 * 同じ級の行が複数来うるので、級単位で合算してからまとめる。
 */
export function summarizeFeeTally(rows: readonly GradeHeadcount[]): FeeTallySummary {
  const countByGrade = new Map<Grade, { count: number; unitJpy: number }>()
  for (const row of rows) {
    if (row.count <= 0) continue
    const cur = countByGrade.get(row.grade)
    if (cur) cur.count += row.count
    else countByGrade.set(row.grade, { count: row.count, unitJpy: row.unitJpy })
  }
  if (countByGrade.size === 0) return { totalJpy: 0, breakdownLabel: null }

  const sorted = [...countByGrade].sort(([a], [b]) => GRADE_ORDER[a] - GRADE_ORDER[b])
  const byPrice = new Map<number, { grades: Grade[]; count: number }>()
  let totalJpy = 0
  for (const [grade, { count, unitJpy }] of sorted) {
    totalJpy += count * unitJpy
    const bucket = byPrice.get(unitJpy)
    if (bucket) {
      bucket.grades.push(grade)
      bucket.count += count
    } else {
      byPrice.set(unitJpy, { grades: [grade], count })
    }
  }

  const breakdownLabel = [...byPrice]
    .map(
      // 内訳の金額は円を付けない（`2名×2,500`）。桁区切りの流儀は formatFeeAmount と揃える。
      ([unitJpy, b]) => `${formatGradesLabel(b.grades)} ${b.count}名×${unitJpy.toLocaleString('ja-JP')}`,
    )
    .join(' / ')
  return { totalJpy, breakdownLabel }
}
