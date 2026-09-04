import 'server-only'
import { eq } from 'drizzle-orm'
import { entryGroupPaymentNotices } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import type { db as appDb } from '@/lib/db'
import { pushMessagesToEntryGroup } from '@/lib/event-lifecycle-notify'
import { resolveTreasurerMention } from '@/lib/line-mention-targets'
import {
  buildPaymentNoticeMessages,
  rowsFromSavedCounts,
  savedCountsFromRows,
} from '@/lib/payment-notice'

type Database = typeof appDb

/**
 * payment-notice-send: 振込連絡の**送信本体**（line-bot-message-revamp §3.3.4 / §3.3.5.6）。
 *
 * 導線は2つあるが（グループページの「振込連絡を送る」／メール処理画面の
 * 「会計へ振込連絡を送る」）、送信そのものはここ1本に集約する。同じ送信記録
 * （`entry_group_payment_notices`。1グループ1行）を共有し、どちらから送っても
 * もう一方の画面の「送信済」表示が同じ値を指す（§3.3.5.5）。
 *
 * 手順は固定:
 *   1. 保存された／管理者が直した級別人数 × **都度導出した単価**で文面を組む
 *      （単価は保存しない・上書きさせない・AC-13）
 *   2. 全級0名なら送らない（AC-18）。このとき記録も作らない
 *   3. **push の前に**人数を保存する（送信が失敗しても数え直させない）
 *   4. push が成功したときだけ `last_sent_at` を進め、**`last_error` を NULL へ戻す**
 *      （AC-45b。残すと「送信済」と「送信に失敗しました」が同時に出る）
 *   5. 失敗したときは `last_attempted_at` / `last_error` だけを書く（AC-19 / AC-45）
 */

export interface SendPaymentNoticeCoreInput {
  entryGroupId: number
  /** 級 -> 人数。呼び出し側で級として妥当なキーだけに絞ってから渡す。 */
  counts: Partial<Record<Grade, number>>
  /** 級 -> 単価（`resolveEntryFee` が都度導出した値）。 */
  unitPriceByGrade: Partial<Record<Grade, number>>
  /** 振込期限 `YYYY-MM-DD`。NULL なら1通目の日付行が消える（AC-16 / AC-39）。 */
  paymentDeadlineIso: string | null
  /** 支払情報。空なら2通目を送らない（AC-17）。 */
  paymentInfo: string | null
  /** 送信を実行した管理者。 */
  sentByUserId: string
  /**
   * push の**直前**に呼ばれ、`true` を返したら送らずに中止する。
   * `processMail` の `after()` 経路が世代トークン検証（`isCurrentGeneration`）を
   * ここへ持ち込むために使う（§3.3.5.6 / AC-46）。人数の保存までは済んでいるので、
   * 中止しても入力し直しにはならない。
   */
  abortBeforePush?: () => Promise<boolean>
}

export type SendPaymentNoticeCoreResult =
  /** 送信できた。 */
  | { outcome: 'sent'; totalJpy: number }
  /** 人数が全級0名なので送らなかった（記録も作らない）。 */
  | { outcome: 'empty' }
  /** `abortBeforePush` が中止を指示した（取り消し済みのメールなど）。 */
  | { outcome: 'aborted' }
  /** push が失敗した。`error` はそのまま `last_error` に記録した文字列。 */
  | { outcome: 'failed'; error: string }

/**
 * 送信を**試みたが送れなかった**ことを記録する（§3.3.5.6）。
 *
 * `sendPaymentNoticeCore` へ辿り着く前に落ちた場合に使う — 具体的には、
 * `processMail` の `after()` が push 直前の再検証で「送れない状態」を検出したとき。
 * ★ここを記録せずに黙って return すると、`processMail` は既に `{ok: true}` を返し
 * 画面もメール一覧へ戻っているため、**管理者はどの画面でも脱落に気づけない**
 * （Codex R1 blocker）。取り消し（世代トークン不一致）は正常な中止なので呼ばない。
 *
 * 既存行があれば人数・総額には触れず、試行日時と理由だけを上書きする
 * （過去の送信記録を壊さない）。行が無ければ作る — `last_sent_at` は NULL のままな
 * ので「送信済」にはならず、`grade_counts` が全級0なら初期値は集計から引かれる。
 */
export async function recordPaymentNoticeFailure(
  dbc: Database,
  input: { entryGroupId: number; counts: Partial<Record<Grade, number>>; error: string },
): Promise<void> {
  const now = new Date()
  await dbc
    .insert(entryGroupPaymentNotices)
    .values({
      entryGroupId: input.entryGroupId,
      gradeCounts: input.counts,
      totalJpy: 0,
      lastAttemptedAt: now,
      lastError: input.error,
    })
    .onConflictDoUpdate({
      target: entryGroupPaymentNotices.entryGroupId,
      set: { lastAttemptedAt: now, lastError: input.error, updatedAt: now },
    })
}

export async function sendPaymentNoticeCore(
  dbc: Database,
  input: SendPaymentNoticeCoreInput,
): Promise<SendPaymentNoticeCoreResult> {
  const rows = rowsFromSavedCounts(input.counts, input.unitPriceByGrade)
  const mention = await resolveTreasurerMention(dbc)
  const notice = buildPaymentNoticeMessages({
    mention,
    rows,
    paymentDeadlineIso: input.paymentDeadlineIso,
    paymentInfo: input.paymentInfo,
  })
  // 全級0名（AC-18）。**記録も作らない** — `total_jpy` は NOT NULL なので、
  // ここで空の行を作ると 0 円の送信記録が生えてしまう。
  if (!notice) return { outcome: 'empty' }

  // 人数は push の前に保存する。送信が失敗しても、管理者が直した人数は残す
  // （やり直しのたびに数え直させない・§3.3.5.6）。`last_sent_at` だけを成否で分ける。
  const gradeCounts = savedCountsFromRows(notice.rows)
  await dbc
    .insert(entryGroupPaymentNotices)
    .values({
      entryGroupId: input.entryGroupId,
      gradeCounts,
      totalJpy: notice.totalJpy,
    })
    .onConflictDoUpdate({
      target: entryGroupPaymentNotices.entryGroupId,
      set: { gradeCounts, totalJpy: notice.totalJpy, updatedAt: new Date() },
    })

  if (input.abortBeforePush && (await input.abortBeforePush())) {
    return { outcome: 'aborted' }
  }

  const result = await pushMessagesToEntryGroup(dbc, input.entryGroupId, notice.messages)
  if (result.outcome !== 'sent') {
    const error =
      result.outcome === 'skipped'
        ? 'LINE グループが紐付いていません'
        : `LINE 送信に失敗しました: ${result.reason ?? '不明なエラー'}`
    await dbc
      .update(entryGroupPaymentNotices)
      .set({ lastAttemptedAt: new Date(), lastError: error, updatedAt: new Date() })
      .where(eq(entryGroupPaymentNotices.entryGroupId, input.entryGroupId))
    return { outcome: 'failed', error }
  }

  const now = new Date()
  await dbc
    .update(entryGroupPaymentNotices)
    .set({
      lastSentAt: now,
      lastSentBy: input.sentByUserId,
      lastAttemptedAt: now,
      // ★成功したら失敗記録を消す（AC-45b）。
      lastError: null,
      updatedAt: now,
    })
    .where(eq(entryGroupPaymentNotices.entryGroupId, input.entryGroupId))

  return { outcome: 'sent', totalJpy: notice.totalJpy }
}
