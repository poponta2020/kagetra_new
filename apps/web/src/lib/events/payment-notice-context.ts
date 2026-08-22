import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { entryGroupPaymentNotices, eventLineBroadcasts, events } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { db } from '@/lib/db'
import { resolveEntryFee } from '@/lib/entry-fee'
import type { GradeHeadcount } from '@/lib/entry-fee'
import { tallyEntryFeesForGroup } from '@/lib/entry-fee-tally'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { rowsFromSavedCounts } from '@/lib/payment-notice'

/**
 * payment-notice-context: 振込連絡（line-bot-message-revamp §3.3）の露出条件と
 * 初期値を**1箇所で**組む。
 *
 * 画面（`/admin/entries/[groupId]`）と Server Action の**両方**がこれを呼ぶ。
 * Server Action は client から直接叩けるので、画面が出していない状況で送られない
 * よう同じ判定を再実行する（fail-closed）。
 *
 * 露出条件（§3.3.1・AC-9/10/11）= 申込管理ボードの `payment_due` 区画と同じ:
 * ```
 * settled（確定名簿あり）∧ 事前払い（payment_type='advance'）∧ 未振込（payment_status='unpaid'）
 * ```
 * - `settled` の判定は [confirmed-roster.ts] が正典。4材料の OR をここで再実装しない。
 *   手動トグル（`confirmed_roster_override`）で進めた場合も含む（AC-10）
 * - 現地払い・支払済のグループはこの条件に入らないのでボタンが出ない（AC-11）
 * - 複数日グループでは「非中止の日に1日でも 申込済 ∧ 事前払い ∧ 未振込 があるか」で判定する。
 *   金額の母集団（`tallyEntryFeesForGroup`）も同じく非中止・事前払いの日だけを合算する
 */

export interface PaymentNoticeContext {
  /** 級ごとの人数（初期値）と単価。保存済みがあればその人数、無ければ参加費集計から。 */
  rows: GradeHeadcount[]
  /** 保存済みの人数を初期値にしたか（画面の注記に使う）。 */
  hasSavedCounts: boolean
  /** 級 → 単価。人数から金額を組み直すのに使う（単価は保存しない）。 */
  unitPriceByGrade: Partial<Record<Grade, number>>
  /** 振込期限（グループ共通。日により違えば最も早い日を採る）。 */
  paymentDeadline: string | null
  /** 支払情報（グループ共通。空なら2通目を送らない）。 */
  paymentInfo: string | null
  lastSentAt: Date | null
  hasLineBinding: boolean
}

/**
 * 露出条件を満たすなら文脈を返し、満たさなければ `null`（＝ボタンを出さない・
 * Server Action も拒否する）。
 */
export async function loadPaymentNoticeContext(
  entryGroupId: number,
): Promise<PaymentNoticeContext | null> {
  const [{ settled }, dayRows] = await Promise.all([
    loadConfirmedRosterState(entryGroupId),
    db
      .select({
        id: events.id,
        official: events.official,
        kind: events.kind,
        eligibleGrades: events.eligibleGrades,
        feeJpy: events.feeJpy,
        entryStatus: events.entryStatus,
        paymentType: events.paymentType,
        paymentStatus: events.paymentStatus,
        paymentDeadline: events.paymentDeadline,
        paymentInfo: events.paymentInfo,
      })
      .from(events)
      .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled'))),
  ])
  if (!settled) return null

  const dueDays = dayRows.filter(
    (d) =>
      d.entryStatus === 'applied' && d.paymentType === 'advance' && d.paymentStatus === 'unpaid',
  )
  if (dueDays.length === 0) return null

  // 単価は事前払いの日から解決する（振込に乗る日だけが金額を持つ）。
  const advanceDays = dayRows.filter((d) => d.paymentType === 'advance')
  const unitPriceByGrade: Partial<Record<Grade, number>> = {}
  for (const day of advanceDays) {
    const resolution = resolveEntryFee({
      official: day.official,
      kind: day.kind,
      eligibleGrades: day.eligibleGrades,
      feeJpy: day.feeJpy,
    })
    // 級別の規定額が導ける日（official な個人戦）だけを単価の出所にする。
    if (!resolution.perPersonPriced) continue
    for (const [grade, price] of Object.entries(resolution.unitPriceByGrade)) {
      if (price != null) unitPriceByGrade[grade as Grade] = price
    }
  }

  const [tally, savedRows] = await Promise.all([
    tallyEntryFeesForGroup(db, entryGroupId),
    db
      .select({
        gradeCounts: entryGroupPaymentNotices.gradeCounts,
        lastSentAt: entryGroupPaymentNotices.lastSentAt,
      })
      .from(entryGroupPaymentNotices)
      .where(eq(entryGroupPaymentNotices.entryGroupId, entryGroupId))
      .limit(1),
    ])
  const saved = savedRows[0] ?? null
  const savedCountRows = saved ? rowsFromSavedCounts(saved.gradeCounts, unitPriceByGrade) : []
  const hasSavedCounts = savedCountRows.length > 0

  // 級の集合は常に集計側（＝いま参加費が発生しうる級）を基準にし、人数だけ
  // 保存値で上書きする。保存後に対象級が増えた大会でも行が落ちないようにする。
  const baseRows = tally.headcounts
  const rows: GradeHeadcount[] = hasSavedCounts
    ? mergeSavedCounts(baseRows, savedCountRows, unitPriceByGrade)
    : baseRows

  const binding = await db
    .select({ id: eventLineBroadcasts.id })
    .from(eventLineBroadcasts)
    .where(
      and(
        eq(eventLineBroadcasts.entryGroupId, entryGroupId),
        eq(eventLineBroadcasts.status, 'linked'),
      ),
    )
    .limit(1)

  return {
    rows,
    hasSavedCounts,
    unitPriceByGrade,
    paymentDeadline: earliest(dueDays.map((d) => d.paymentDeadline)),
    paymentInfo: firstNonEmpty(dayRows.map((d) => d.paymentInfo)),
    lastSentAt: saved?.lastSentAt ?? null,
    hasLineBinding: binding.length > 0,
  }
}

/** 集計側の級集合を保ちつつ、保存済みの人数で上書きする（保存に無い級は0名）。 */
function mergeSavedCounts(
  baseRows: readonly GradeHeadcount[],
  savedRows: readonly GradeHeadcount[],
  unitPriceByGrade: Partial<Record<Grade, number>>,
): GradeHeadcount[] {
  const byGrade = new Map<Grade, GradeHeadcount>()
  for (const row of baseRows) byGrade.set(row.grade, { ...row, count: 0 })
  for (const row of savedRows) {
    const unitJpy = unitPriceByGrade[row.grade] ?? row.unitJpy
    byGrade.set(row.grade, { grade: row.grade, count: row.count, unitJpy })
  }
  return [...byGrade.values()]
}

/** 日により違う日付は**最も早い日**を採る（共通項目セクションの表示規則と同じ）。 */
function earliest(dates: readonly (string | null)[]): string | null {
  const present = dates.filter((d): d is string => d != null)
  return present.length === 0 ? null : present.slice().sort()[0]!
}

/** 日により違う自由記述は最初の非空を採る（グループ共通項目という運用前提）。 */
function firstNonEmpty(values: readonly (string | null)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed) return trimmed
  }
  return null
}
