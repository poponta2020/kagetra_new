import { eq } from 'drizzle-orm'
import { entryGroupPaymentNotices } from '@kagetra/shared/schema'
import type { entryGroupPaymentReports } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { tallyEntryFeesForGroup } from '@/lib/entry-fee-tally'

/**
 * payment-receipt-broadcast タスク3: 「景虎上の想定金額」の決定（要件 §3.2.3-9〜11）。
 *
 * 優先順は次の2段:
 * 1. そのグループの振込連絡が**送信済み**（`entry_group_payment_notices.last_sent_at`
 *    が非 NULL）なら、そのとき保存された総額（`total_jpy`）をそのまま使う。
 *    ＝「振り込んでくださいと伝えた額」と必ず一致させる。未算入注記は常に 0
 *    （管理者が人数を確認して送った確定値なので注記しない・AC-11）。
 * 2. 送信済みの振込連絡が無ければ `tallyEntryFeesForGroup` の総額を使う。
 *    `totalJpy` が算出できない（`null`）なら `source: 'none'` を返す
 *    （呼び出し側＝ `payment-report-message.ts` が金額行ごと省く）。
 *
 * この関数自体は状態（`payment_status`）を変えない。「金額は `paid` へ変える前に
 * 確定させる」という呼び出し順の契約は呼び出し側（タスク6）が守る。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-fee-tally.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

/**
 * `entry_group_payment_reports.amount_source` の推論型をそのまま使い、
 * `packages/shared/src/schema/enums.ts` の `paymentReportAmountSourceEnum` と
 * ズレないようにする。
 */
type AmountSource = (typeof entryGroupPaymentReports.$inferInsert)['amountSource']

export interface PaymentReportAmount {
  /** 文面に載せる想定金額。算出できなければ null。 */
  amountJpy: number | null
  /** 出典。'payment_notice' | 'tally' | 'none' */
  source: AmountSource
  /** 級未設定で総額に算入できなかった延べ人数。source==='tally' のときだけ非0になりうる。 */
  unknownGradeCount: number
}

export async function resolvePaymentReportAmount(
  dbc: DbOrTx,
  entryGroupId: number,
): Promise<PaymentReportAmount> {
  const [notice] = await dbc
    .select({
      totalJpy: entryGroupPaymentNotices.totalJpy,
      lastSentAt: entryGroupPaymentNotices.lastSentAt,
    })
    .from(entryGroupPaymentNotices)
    .where(eq(entryGroupPaymentNotices.entryGroupId, entryGroupId))
    .limit(1)

  // 優先順1: 振込連絡が送信済み（AC-8）。
  if (notice?.lastSentAt != null) {
    return { amountJpy: notice.totalJpy, source: 'payment_notice', unknownGradeCount: 0 }
  }

  // 優先順2: その場の参加費集計（AC-9）。
  const tally = await tallyEntryFeesForGroup(dbc, entryGroupId)
  if (tally.totalJpy == null) {
    // 優先順3: いずれも算出できない（AC-10）。
    return { amountJpy: null, source: 'none', unknownGradeCount: 0 }
  }
  return {
    amountJpy: tally.totalJpy,
    source: 'tally',
    unknownGradeCount: tally.unknownGradeCount,
  }
}
