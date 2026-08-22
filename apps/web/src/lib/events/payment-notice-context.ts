import 'server-only'
import { and, asc, eq, ne } from 'drizzle-orm'
import { entryGroupPaymentNotices, eventLineBroadcasts, events } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { db } from '@/lib/db'
import { resolveEntryFee } from '@/lib/entry-fee'
import type { GradeHeadcount } from '@/lib/entry-fee'
import { tallyEntryFees } from '@/lib/entry-fee-tally'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'

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
 * - 複数日グループでは「非中止の日に1日でも 申込済 ∧ 事前払い ∧ 未振込 があるか」で判定する
 *
 * ★**金額・単価・支払情報はすべて「未振込の日」（`dueDays`）だけから引く**
 * （レビュー指摘。旧実装は `tallyEntryFeesForGroup` をそのまま使っていた）。
 * あちらの母集団は「非中止 ∧ 事前払い」で、**支払済みの日を除外しない**。日ごとに
 * 支払済みトグルを進められる以上、同一グループに未振込日と支払済み日が混在しうるので、
 * そのまま使うと支払済み分まで振込依頼に載り**二重請求**になる。
 */

export interface PaymentNoticeContext {
  /**
   * 級ごとの人数（初期値）と単価。保存済みがあればその人数、無ければ参加費集計から。
   *
   * ★**単価が解決できる対象級はすべて含める（人数0でも行を出す）**（レビュー指摘）。
   * 出欠回答が0人の級を落とすと入力欄自体が消え、「集計の母集団は確定名簿ではないから
   * 人数を人間が直す」というこの機能の目的（§3.3.2）が果たせない級が出る。
   * 文面側は `normalizeNoticeRows` が人数0の行を落とすので、送信結果は変わらない。
   */
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
      .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))
      // 支払期限・支払情報の代表値をどの日から採るかを決定的にする（順序を指定しないと
      // 日により値が違うグループで実行ごとに別の口座が選ばれうる）。
      .orderBy(asc(events.eventDate), asc(events.id)),
  ])
  if (!settled) return null

  const dueDays = dayRows.filter(
    (d) =>
      d.entryStatus === 'applied' && d.paymentType === 'advance' && d.paymentStatus === 'unpaid',
  )
  if (dueDays.length === 0) return null

  // 単価は**未振込の日**から解決する（金額の母集団と同じ集合にする）。
  const unitPriceByGrade: Partial<Record<Grade, number>> = {}
  for (const day of dueDays) {
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
    // ★グループ全体（`tallyEntryFeesForGroup`）ではなく**未振込の日だけ**を合算する。
    // 支払済みの日を含めると二重請求になる（モジュール冒頭の説明を参照）。
    tallyEntryFees(
      db,
      dueDays.map((d) => d.id),
    ),
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
  const savedCounts = saved?.gradeCounts ?? {}
  const hasSavedCounts = GRADES.some((g) => (savedCounts[g] ?? 0) > 0)

  // 行は**単価が解決できる対象級すべて**（人数0でも出す）。人数は保存済みがあれば
  // それを、無ければ集計値を初期値にする。
  const tallyByGrade = new Map(tally.headcounts.map((r) => [r.grade, r.count]))
  const rows: GradeHeadcount[] = GRADES.flatMap((grade) => {
    const unitJpy = unitPriceByGrade[grade]
    if (unitJpy == null) return []
    const count = hasSavedCounts ? (savedCounts[grade] ?? 0) : (tallyByGrade.get(grade) ?? 0)
    return [{ grade, count, unitJpy }]
  })

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
    paymentInfo: firstNonEmpty(dueDays.map((d) => d.paymentInfo)),
    lastSentAt: saved?.lastSentAt ?? null,
    hasLineBinding: binding.length > 0,
  }
}

/** 級の正順（A→E）。行の並び順の唯一の基準。 */
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/** 日により違う日付は**最も早い日**を採る（共通項目セクションの表示規則と同じ）。 */
function earliest(dates: readonly (string | null)[]): string | null {
  const present = dates.filter((d): d is string => d != null)
  return present.length === 0 ? null : present.slice().sort()[0]!
}

/**
 * 日により違う自由記述は最初の非空を採る（グループ共通項目という運用前提）。
 * 対象は**未振込の日だけ**で、並びは開催日昇順に固定してある（呼び出し側のクエリ）ので、
 * 同じ状態からは必ず同じ値が選ばれる。
 */
function firstNonEmpty(values: readonly (string | null)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed) return trimmed
  }
  return null
}
