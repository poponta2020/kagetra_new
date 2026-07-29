import { and, eq, inArray, ne } from 'drizzle-orm'
import { events, eventAttendances, users } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { resolveEntryFee, summarizeFeeTally, type GradeHeadcount } from '@/lib/entry-fee'

/**
 * grade-entry-fee タスク3: イベント／グループ単位の「級ごとの人数 × 単価」集計。
 *
 * 単価の解決は `entry-fee.ts` の `resolveEntryFee` に一切を委ねる（ここで
 * official/kind の分岐を再定義しない）。このモジュールが持つのは DB クエリと
 * 母集団の定義だけ。
 *
 * 母集団は `apps/web/src/app/(app)/events/[id]/page.tsx` の
 * `eligibleAttendingList` と **1文字も違わない条件**にする（AC-9）:
 *
 * ```
 * eligible_grades が非空 → is_invited = true AND grade IN (eligible_grades)
 * eligible_grades が NULL/空配列 → is_invited = true だけ
 * ```
 *
 * `resolveTargetGrades`（NULL/空 → 全級 A〜E を返す、単価解決専用のヘルパー）を
 * 母集団フィルタに流用してはならない — それを使うと `grade IS NULL` の会員が
 * `IN (A,B,C,D,E)` で母集団から落ち、AC-9（page.tsx と同じ母集団）と
 * AC-10（級未設定は未算入として計上する）が同時に壊れる。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-overdue-alert.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

export interface FeeTallyResult {
  /** Σ(級ごとの人数 × 単価)。人数×単価で価格付けできるイベントが1件も無ければ null。 */
  totalJpy: number | null
  /** 内訳（例 `A・B級 2名×2,500 / C級 3名×2,000`）。対象が居なければ null。 */
  breakdownLabel: string | null
  /** 級未設定で総額に算入できなかった延べ人数。 */
  unknownGradeCount: number
}

const EMPTY_RESULT: FeeTallyResult = { totalJpy: null, breakdownLabel: null, unknownGradeCount: 0 }

/**
 * 指定イベント群（＝グループの全日など）の総額と内訳を引く。
 *
 * `kind='team'` / `official=false` のイベント（`resolveEntryFee(...).perPersonPriced`
 * が false）は総額の計算から除外する（AC-11）。除外後に価格付けできるイベントが
 * 1件も無ければ `totalJpy: null`（「0円」と「算出できない」を区別する）。
 *
 * イベントごとに `eligible_grades` / `official` / `kind` / `fee_jpy` が違いうるため、
 * **イベント単位で母集団を絞り単価を解決してから合算する**（グループ全体で一括
 * フィルタしない）。同じ会員が複数日に出席していれば、その日数ぶんカウントする
 * （1日ごとに参加費が発生するため、重複排除しない）。
 */
export async function tallyEntryFees(
  dbc: DbOrTx,
  eventIds: readonly number[],
): Promise<FeeTallyResult> {
  if (eventIds.length === 0) return EMPTY_RESULT

  const eventRows = await dbc
    .select({
      id: events.id,
      official: events.official,
      kind: events.kind,
      eligibleGrades: events.eligibleGrades,
      feeJpy: events.feeJpy,
    })
    .from(events)
    .where(inArray(events.id, [...eventIds]))

  if (eventRows.length === 0) return EMPTY_RESULT

  const headcounts: GradeHeadcount[] = []
  let unknownGradeCount = 0
  let anyPriced = false

  for (const ev of eventRows) {
    const resolution = resolveEntryFee({
      official: ev.official,
      kind: ev.kind,
      eligibleGrades: ev.eligibleGrades,
      feeJpy: ev.feeJpy,
    })
    // AC-11: kind='team' / official=false はこの合算から除外する。
    if (!resolution.perPersonPriced) continue
    anyPriced = true

    // page.tsx の eligibleAttendingList と同じ母集団定義（AC-9）。eligible_grades が
    // 非空なら inArray(users.grade, ...) の SQL 性質上 grade IS NULL の行が自然に
    // 落ちる（=このケースでは unknownGradeCount は増えない）。NULL/空配列なら
    // is_invited=true だけが条件になり、級未設定者も母集団に入る。
    const gradeFilter = ev.eligibleGrades?.length
      ? and(eq(users.isInvited, true), inArray(users.grade, ev.eligibleGrades))
      : eq(users.isInvited, true)

    const attendeeRows = await dbc
      .select({ grade: users.grade })
      .from(eventAttendances)
      .innerJoin(users, eq(eventAttendances.userId, users.id))
      .where(
        and(
          eq(eventAttendances.eventId, ev.id),
          eq(eventAttendances.attend, true),
          gradeFilter,
        ),
      )

    for (const row of attendeeRows) {
      // AC-10: 級未設定は 0 円で足さず、未算入の延べ人数として計上する。
      if (row.grade == null) {
        unknownGradeCount++
        continue
      }
      const unitJpy = resolution.unitPriceByGrade[row.grade]
      if (unitJpy == null) continue
      headcounts.push({ grade: row.grade, count: 1, unitJpy })
    }
  }

  // 価格付けできるイベントが1件も無い（全て team / 非公認）→ 算出不能。
  if (!anyPriced) return EMPTY_RESULT

  const summary = summarizeFeeTally(headcounts)
  return {
    totalJpy: summary.totalJpy,
    breakdownLabel: summary.breakdownLabel,
    unknownGradeCount,
  }
}

/**
 * 申込グループの全日を対象に集計する（requirements §3.2.2「グループ全日の合算」。
 * AC-12: 複数日グループでは日ごとに割らず、グループの全日を合算した1つの総額に
 * する）。
 *
 * 中止した日（`status='cancelled'`）は除く。総額は「主催者へ実際に振り込む額」で、
 * 中止日には払う参加費が無い。リマインドの候補抽出（`send-lifecycle-reminders.ts` の
 * `queryLinkedEvents`）も cancelled を除いており、そちらと母集団を揃える。
 */
export async function tallyEntryFeesForGroup(
  dbc: DbOrTx,
  entryGroupId: number,
): Promise<FeeTallyResult> {
  const groupEventRows = await dbc
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))

  return tallyEntryFees(
    dbc,
    groupEventRows.map((row) => row.id),
  )
}
