import type { Grade } from '@kagetra/shared/types'
import type { GradeHeadcount } from '@/lib/entry-fee'
import {
  buildMentionMessage,
  buildTextMessage,
  type LineMessage,
  type MentionTarget,
  type MentionValue,
} from '@/lib/line-mention'

/**
 * payment-notice: 名簿確定後の振込連絡（line-bot-message-revamp §3.3）の**文面**。
 *
 * DB を触らない純関数モジュール。人数の初期値を引く（`tallyEntryFeesForGroup`）のも、
 * 保存・送信も呼び出し側（Server Action）の仕事で、ここは「級別人数 + 単価 + 期限 +
 * 支払情報 → 送るメッセージの配列」だけを持つ。
 *
 * ★**2通に分かれているのは設計上の必然**（§3.2.2 / §7-4）。`textV2` は本文中の中括弧を
 * プレースホルダ構文として解釈するため、メンション付きメッセージに自由記述
 * （`payment_info`）を混ぜられない。したがって:
 *
 * - 1通目 = `@会計` メンション + **数値由来の値だけ**（日付・人数・単価・金額）
 * - 2通目 = 支払情報の自由記述（メンションなしの `type:'text'`）
 *
 * 読みやすさのための分割ではないので、1通にまとめる「改善」をしてはならない（AC-8）。
 */

/** 級を A→E の正順に並べるための序数。 */
const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }

/** 1通目の1行目に出す素テキスト（会計が0人のときはこれがそのまま出る・AC-5）。 */
export const TREASURER_MENTION_LABEL = '@会計'

export interface PaymentNoticeInput {
  /** `@会計` のメンション対象（`line-mention-targets.ts` が解決した結果）。 */
  mention: MentionTarget
  /** 級ごとの人数と単価。人数 0 の級は含めても落とされる。 */
  rows: readonly GradeHeadcount[]
  /** 振込期限 `YYYY-MM-DD`。**NULL なら日付行ごと省略する**（§3.3.3・AC-16）。 */
  paymentDeadlineIso?: string | null
  /** 支払情報（自由記述）。**空なら2通目を送らない**（§3.3.3・AC-17）。 */
  paymentInfo?: string | null
}

export interface PaymentNoticePreview {
  /** 送信するメッセージ（1通 or 2通）。 */
  messages: LineMessage[]
  /** Σ(人数 × 単価)。 */
  totalJpy: number
  /** 明細に載った級（A→E 順）。人数 0 の級は含まない。 */
  rows: GradeHeadcount[]
}

/** 人数 0 の級を落とし、A→E 順に並べ替える。 */
export function normalizeNoticeRows(rows: readonly GradeHeadcount[]): GradeHeadcount[] {
  return rows
    .filter((r) => r.count > 0)
    .slice()
    .sort((a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade])
}

/** Σ(人数 × 単価)。 */
export function totalOfNoticeRows(rows: readonly GradeHeadcount[]): number {
  return rows.reduce((sum, r) => sum + r.count * r.unitJpy, 0)
}

/**
 * 振込連絡の2通を組み立てる。**人数が全級0なら送らせない**（§3.4・AC-18）ので
 * `null` を返す（呼び出し側はプレビューでエラーを出す）。
 *
 * 1通目の書式（§3.3.3）:
 * ```
 * @会計
 * 7/25(金)までに
 * A級：2500*3 = 7500円、
 * B級：2500*2 = 5000円
 *
 * 計12500円
 *
 * を、以下の口座に振り込んでください
 * ```
 * - 級ごとに1行。行末の `、` は**最終行には付けない**
 * - 明細と `計` の間、`計` と末尾行の間に空行を1つ置く
 * - 数値は桁区切りを入れない（`line-mention.ts` の値整形と同じ規律）
 */
export function buildPaymentNoticeMessages(
  input: PaymentNoticeInput,
): PaymentNoticePreview | null {
  const rows = normalizeNoticeRows(input.rows)
  if (rows.length === 0) return null

  const totalJpy = totalOfNoticeRows(rows)
  const values: MentionValue[] = []
  const lines: string[] = []

  // 日付行。payment_deadline が NULL ならこの行ごと省略する（AC-16）。
  if (input.paymentDeadlineIso) {
    lines.push('%sまでに')
    values.push({ dateIso: input.paymentDeadlineIso })
  }

  rows.forEach((row, i) => {
    const suffix = i === rows.length - 1 ? '' : '、'
    lines.push(`${row.grade}級：%s*%s = %s円${suffix}`)
    values.push(row.unitJpy, row.count, row.count * row.unitJpy)
  })

  lines.push('')
  lines.push('計%s円')
  values.push(totalJpy)
  lines.push('')
  lines.push('を、以下の口座に振り込んでください')

  const messages: LineMessage[] = [
    buildMentionMessage({
      mention: input.mention,
      label: TREASURER_MENTION_LABEL,
      template: lines.join('\n'),
      values,
    }),
  ]

  // 2通目は自由記述なのでメンションを持たない素の text。空なら送らない（AC-17）。
  const info = input.paymentInfo?.trim()
  if (info) messages.push(buildTextMessage(info))

  return { messages, totalJpy, rows }
}

/**
 * 保存された級別人数（`entry_group_payment_notices.grade_counts`）と、都度導出した
 * 単価（`resolveEntryFee`）を突き合わせて明細行に戻す。
 *
 * **単価は保存していない**（§3.3.2）ので、規定額が改定されれば次回の送信から
 * 新しい額になる。人数だけが再現される（AC-14）。単価が解決できない級
 * （非公認・団体戦）は明細から除外する（既存の総額計算と同じ規律・§3.4）。
 */
export function rowsFromSavedCounts(
  savedCounts: Partial<Record<Grade, number>>,
  unitPriceByGrade: Partial<Record<Grade, number>>,
): GradeHeadcount[] {
  const rows: GradeHeadcount[] = []
  for (const [grade, count] of Object.entries(savedCounts) as [Grade, number | undefined][]) {
    if (count == null || count <= 0) continue
    const unitJpy = unitPriceByGrade[grade]
    if (unitJpy == null) continue
    rows.push({ grade, count, unitJpy })
  }
  return normalizeNoticeRows(rows)
}

/** 明細行を保存形（級 → 人数）へ落とす。 */
export function savedCountsFromRows(
  rows: readonly GradeHeadcount[],
): Partial<Record<Grade, number>> {
  const out: Partial<Record<Grade, number>> = {}
  for (const row of normalizeNoticeRows(rows)) out[row.grade] = row.count
  return out
}
