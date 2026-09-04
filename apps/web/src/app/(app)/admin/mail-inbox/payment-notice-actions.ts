'use server'

import type { Grade } from '@kagetra/shared/types'
import { auth } from '@/auth'
import type { PaymentDeadlineKind } from '@/lib/events/payment-deadline'
import { loadPaymentNoticeContext } from '@/lib/events/payment-notice-context'
import type { PaymentNoticeUnavailableReason } from '@/lib/events/payment-notice-availability'

/**
 * メール処理画面の「会計へ振込連絡を送る」セクション（§3.3.5）が使うドラフト取得。
 *
 * ★**独自のローダーを書かない**（requirements §6）。露出条件・人数の初期値・
 * 共通項目の代表値はすべて `payment-notice-context.ts` から引く。あちらには
 * 「母集団は未振込の日だけ（`tallyEntryFeesForGroup` を使うと支払済みの日まで
 * 載って二重請求になる）」というレビューで得た規律が埋まっており、書き直すと
 * その不具合が静かに戻る。ここでの違いは `requireSettled: false` の1点だけ
 * （この画面での処理そのものが確定名簿シグナルを成立させる・§3.3.5.1 / §7-6）。
 *
 * 送信できないときも**理由つきで返す**。クライアントはセクション自体は描いて
 * 送信だけを不可にする（§3.3.5.2「黙って消さない」）。
 *
 * 返す DTO に `@kagetra/shared/schema` 由来の型を露出させないこと — この経路は
 * client から import されるので、schema / drizzle が混ざると `next build` で
 * 初めて壊れる（requirements §6）。
 */

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

/** 級ごとの1行。**単価は表示のみ**で、編集できるのは人数だけ（AC-37）。 */
export interface PaymentNoticeDraftRow {
  grade: Grade
  count: number
  unitJpy: number
}

export interface PaymentNoticeDraft {
  /** 送信できるか。false でもセクションは描き、理由を1行で出す（§3.3.5.2）。 */
  canSend: boolean
  /** 送信できない理由。`canSend` が true なら null。 */
  unavailableReason: PaymentNoticeUnavailableReason | null
  /** 画面に出す理由の文言（`payment-notice-availability.ts` が正典）。 */
  unavailableMessage: string | null
  /**
   * 単価を解決できる対象級すべて。**人数0の級も行として返す**（AC-13 / §3.3.2）。
   * 出欠回答が0人の級を落とすと入力欄が消え、確定名簿に合わせて人数を足せなくなる。
   */
  rows: PaymentNoticeDraftRow[]
  /** 初期値が保存済みの人数か（＝前回送信時に管理者が直した値か）。 */
  hasSavedCounts: boolean
  /** 支払締切の初期値（グループ共通項目から。§3.3.5.3）。 */
  paymentDeadline: string | null
  paymentDeadlineKind: PaymentDeadlineKind
  /** 振込先の初期値（グループ共通項目から）。 */
  paymentInfo: string | null
  /** 最後に送信できた日時。NULL なら未送信＝チェック既定 ON（AC-41）。 */
  lastSentAt: Date | null
  /** 最後に送信を試みた日時。失敗表示に使う（§3.3.5.6）。 */
  lastAttemptedAt: Date | null
  /** 直近の送信失敗の理由。成功でクリアされる（AC-45b）。 */
  lastError: string | null
}

export async function loadPaymentNoticeDraft(entryGroupId: number): Promise<PaymentNoticeDraft> {
  await requireAdminSession()
  if (!Number.isInteger(entryGroupId) || entryGroupId <= 0) {
    throw new Error('入力が不正です')
  }

  const loaded = await loadPaymentNoticeContext(entryGroupId, { requireSettled: false })
  if (!loaded.ok) {
    // 対象日が無い・LINE 未紐付け。人数は出しようが無いが、**共通項目は返す**
    // （§3.3.5.3: 保存は送信可否と切り離す。画面は理由を出したうえで支払締切・
    // 振込先だけ編集させる）。
    return {
      canSend: false,
      unavailableReason: loaded.reason,
      unavailableMessage: loaded.message,
      rows: [],
      hasSavedCounts: false,
      paymentDeadline: loaded.commonFields.paymentDeadline,
      paymentDeadlineKind: loaded.commonFields.paymentDeadlineKind,
      paymentInfo: loaded.commonFields.paymentInfo,
      lastSentAt: null,
      lastAttemptedAt: null,
      lastError: null,
    }
  }

  const context = loaded.context
  const availability = context.availability
  return {
    canSend: availability.ok,
    unavailableReason: availability.ok ? null : availability.reason,
    unavailableMessage: availability.ok ? null : availability.message,
    rows: context.rows.map((r) => ({ grade: r.grade, count: r.count, unitJpy: r.unitJpy })),
    hasSavedCounts: context.hasSavedCounts,
    paymentDeadline: context.paymentDeadline,
    paymentDeadlineKind: context.paymentDeadlineKind,
    paymentInfo: context.paymentInfo,
    lastSentAt: context.lastSentAt,
    lastAttemptedAt: context.lastAttemptedAt,
    lastError: context.lastError,
  }
}
