import { and, eq, inArray, sql } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { lockEventRowsAscending, resolveEntryGroupId } from '@/lib/entry-groups'
import { claimLifecycleNotification } from '@/lib/event-lifecycle-notify'

/**
 * payment-receipt-broadcast タスク5: 支払済トグルの**中身**（認可・revalidate・通知送信を
 * 含まない純粋な状態遷移）。
 *
 * 抽出の動機は、証憑つきの支払報告（`/admin/entries/[groupId]` の `reportPayment`）が
 * 同じ flip と claim を再利用しつつ、送るメッセージだけを差し替える必要があること。
 *
 * ★**`'use server'` ファイルの外に置く**。`events/[id]/actions.ts` は `'use server'` なので、
 * そこから export した関数は**それ自体が client から直接叩ける公開エンドポイント**になる。
 * 認可ガードを持たないこの中核をそこへ置くと、`requireAdminSession()` を通らない
 * 状態変更経路が生まれる。ガード（`requireAdminSession`）と `revalidatePath` は
 * 呼び出し側の Server Action に残す —— 日ページとグループページで再検証すべきパスが
 * 違うためでもある。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-fee-tally.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** 支払済へ flip できた1件。複数日メッセージの日別ラベル・代表イベントの解決に使う。 */
export interface PaymentPaidFlipRow {
  id: number
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
}

export interface ApplyPaymentsPaidOutcome {
  entryGroupId: number
  /** 重複除去・昇順に正規化した対象 id（revalidate の対象）。 */
  ids: number[]
  /** flip できて、かつ cancelled でなく、once-ever の claim も取れた日。 */
  claimed: PaymentPaidFlipRow[]
  /** `claimed` に対応する `event_lifecycle_notifications.id`。 */
  notificationIds: number[]
}

/** 入力 id を重複除去して昇順にそろえる（デッドロック回避のロック順を固定するため）。 */
function normalizeIds(eventIds: readonly number[]): number[] {
  return Array.from(new Set(eventIds)).sort((a, b) => a - b)
}

/**
 * 事前払い ∧ 未払 ∧ 同一グループ の日を `paid` へ倒し、`payment_paid` の once-ever
 * スロットを claim する。**通知は送らない**（呼び出し側が文面を決めて送る）。
 *
 * 対象 id が空なら `null`（現行の `setPaymentsPaid` が早期 return するのと同じ）。
 * `cancelled` の日は状態変更こそ記録するが claim 対象から外す（要件 §3.2.2 #2）。
 */
export async function applyPaymentsPaid(
  dbc: Database,
  eventIds: readonly number[],
  opts: { expectedEntryGroupId?: number } = {},
): Promise<ApplyPaymentsPaidOutcome | null> {
  const ids = normalizeIds(eventIds)
  if (ids.length === 0) return null
  const entryGroupId = await resolveEntryGroupId(dbc, ids[0]!)
  // ★呼び出し側が「このグループの日のはず」と申告しているときは、**flip の前に**
  //   突き合わせる。後ろで弾くと別グループの日が支払済になるだけでなく、その日の
  //   `payment_paid` once-ever スロットまで claim で消費され、finalize されないまま
  //   残る —— そのグループの完了通知が二度と送れなくなる（UNIQUE(event_id, type)）。
  if (opts.expectedEntryGroupId != null && opts.expectedEntryGroupId !== entryGroupId) {
    return null
  }

  const result = await dbc.transaction(async (tx: Transaction) => {
    const claimed: PaymentPaidFlipRow[] = []
    const notificationIds: number[] = []
    for (const id of ids) {
      const flipped = await tx
        .update(events)
        .set({ paymentStatus: 'paid', paymentPaidAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(events.id, id),
            eq(events.paymentType, 'advance'),
            eq(events.paymentStatus, 'unpaid'),
            eq(events.entryGroupId, entryGroupId),
          ),
        )
        .returning({
          id: events.id,
          title: events.title,
          eventDate: events.eventDate,
          status: events.status,
        })
      const row = flipped[0]
      if (!row) continue
      // cancelled 大会には通知しない（要件 §3.2.2 #2）。状態変更そのものは記録
      // する。ここで再ガードして claim 対象から除外する（AC-11 の集約版）。
      if (row.status === 'cancelled') continue
      const claim = await claimLifecycleNotification(tx, row.id, 'payment_paid')
      if (claim.id != null) {
        claimed.push({ id: row.id, title: row.title, eventDate: row.eventDate })
        notificationIds.push(claim.id)
      }
    }
    return { claimed, notificationIds }
  })

  return { entryGroupId, ids, claimed: result.claimed, notificationIds: result.notificationIds }
}

/**
 * 支払済を未払へ戻す（誤操作の巻き戻し）。通知は送らない。
 * 対象 id が空なら `null`。
 */
export async function revertPaymentsPaid(
  dbc: Database,
  eventIds: readonly number[],
): Promise<{ entryGroupId: number; ids: number[] } | null> {
  const ids = normalizeIds(eventIds)
  if (ids.length === 0) return null
  const entryGroupId = await resolveEntryGroupId(dbc, ids[0]!)

  await dbc.transaction(async (tx: Transaction) => {
    await lockEventRowsAscending(tx, ids, entryGroupId)
    await tx
      .update(events)
      .set({ paymentStatus: 'unpaid', paymentPaidAt: null, updatedAt: sql`now()` })
      .where(
        and(
          inArray(events.id, ids),
          eq(events.paymentType, 'advance'),
          eq(events.entryGroupId, entryGroupId),
        ),
      )
  })

  return { entryGroupId, ids }
}
