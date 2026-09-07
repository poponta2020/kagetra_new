import { and, eq, inArray, sql } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { lockEventRowsAscending, resolveEntryGroupId } from '@/lib/entry-groups'
import {
  buildLifecycleMessage,
  claimLifecycleNotification,
  sendClaimedNotificationBulk,
} from '@/lib/event-lifecycle-notify'

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

export interface PaymentsPaidFlipResult {
  /**
   * 実際に `unpaid → paid` へ倒せた日の id（`cancelled` の日も含む —— 状態変更は
   * 記録するが通知だけしない、が既存の規律）。
   *
   * ★**`claimed` と混同しないこと。** `claimed` は「通知を送ってよい日」で、
   * once-ever を既に消費済みの日は空になる。「この操作で本当に何かが変わったか」を
   * 判断できるのは `flippedIds` だけで、これを見ないと**既に支払済の日へ再実行した
   * だけの呼び出しでも証憑を送ってしまう**（二重送信）。
   */
  flippedIds: number[]
  /**
   * flip できた日のうち **`cancelled` でない**もの。
   *
   * ★通知してよい日の母集団はこちら。`flippedIds` を送信可否に使うと、選択後に
   * 中止された日（＝中止日だけの報告）でも証憑があれば push してしまい、
   * 「`cancelled` 大会には通知しない」既存ガード（要件 §3.2.2 #2）を迂回する。
   * once-ever を消費済みで `claimed` が空でも、通知してよい日であることは変わらない
   * ので `claimed` とは別に持つ。
   */
  notifiableIds: number[]
  /** flip できて、かつ cancelled でなく、once-ever の claim も取れた日。 */
  claimed: PaymentPaidFlipRow[]
  /** `claimed` に対応する `event_lifecycle_notifications.id`。 */
  notificationIds: number[]
}

export interface ApplyPaymentsPaidOutcome extends PaymentsPaidFlipResult {
  entryGroupId: number
  /** 重複除去・昇順に正規化した対象 id（revalidate の対象）。 */
  ids: number[]
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

  const result = await dbc.transaction((tx: Transaction) => applyPaymentsPaidInTx(tx, ids, entryGroupId))

  return { entryGroupId, ids, ...result }
}

/**
 * flip と claim の本体（**呼び出し側のトランザクションの中で動く**）。
 *
 * 証憑つきの支払報告は「支払済化 → claim → 記録・証憑の保存」を1つの原子操作に
 * しなければならない —— 支払済化だけコミットされて記録の INSERT が落ちると、
 * 「支払済になっていて once-ever も使い切ったのに、履歴も証憑も再送導線も無い」
 * という手作業でしか戻せない状態が残る。そのため本体を tx 受け取りで切り出し、
 * `reportPayment` は自分のトランザクションの中でこれを呼ぶ。
 *
 * `ids` は**正規化済み（重複除去・昇順）である前提**。所属グループの検証と
 * 行ロックは呼び出し側の責務。
 */
export async function applyPaymentsPaidInTx(
  tx: Transaction,
  ids: readonly number[],
  entryGroupId: number,
): Promise<PaymentsPaidFlipResult> {
  const flippedIds: number[] = []
  const notifiableIds: number[] = []
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
    flippedIds.push(row.id)
    // cancelled 大会には通知しない（要件 §3.2.2 #2）。状態変更そのものは記録
    // する。ここで再ガードして claim 対象から除外する（AC-11 の集約版）。
    if (row.status === 'cancelled') continue
    notifiableIds.push(row.id)
    const claim = await claimLifecycleNotification(tx, row.id, 'payment_paid')
    if (claim.id != null) {
      claimed.push({ id: row.id, title: row.title, eventDate: row.eventDate })
      notificationIds.push(claim.id)
    }
  }
  return { flippedIds, notifiableIds, claimed, notificationIds }
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

/**
 * 支払完了メッセージを組み立てる。line-bot-message-revamp タスク5で `payment_paid`
 * は大会名・金額を一切出さなくなったため、件数に関わらず同一の固定文面になる。
 *
 * grade-entry-fee タスク6 (AC-17/18) で導入した「N=1 のときだけ振込総額を載せる」
 * 分岐はこの改訂で丸ごと不要になった（呼び出し元の `tallyEntryFeesForGroup` 呼び出し
 * も削除済み）。
 *
 * line-chat-commands タスク2: LINE 発言起点（webhook）でも同じ文面を使うため、
 * `events/[id]/actions.ts` のモジュール private からここへ移した（挙動不変）。
 */
export function buildPaymentPaidMessage(): string {
  return buildLifecycleMessage('payment_paid', { title: '' })
}

/**
 * `applyPaymentsPaid` が claim できたスロットへ支払完了通知を1通 push する
 * （best-effort。push 失敗で状態は巻き戻さない）。
 *
 * ★`applyPaymentsPaid` の中には入れない。証憑つきの支払報告（`reportPayment`）は
 * 同じ flip・claim を使いつつ**別の文面**を送るため、「倒す」と「この文面で送る」は
 * 分かれたままでなければならない。ここは**固定文面を送る呼び出し側**（進行管理の
 * トグルと LINE 発言起点）が共有するための薄いヘルパー。
 */
export async function notifyPaymentsPaid(
  dbc: Database,
  result: ApplyPaymentsPaidOutcome,
): Promise<void> {
  if (result.notificationIds.length === 0) return
  // line-bot-message-revamp タスク5 (AC-26): payment_paid は金額を一切出さなく
  // なったため、grade-entry-fee タスク6 (AC-17/18) が行っていたグループ単位の
  // 振込総額集計（`tallyEntryFeesForGroup`）はここでは不要になった。
  const message = buildPaymentPaidMessage()
  try {
    await sendClaimedNotificationBulk(dbc, {
      notificationIds: result.notificationIds,
      eventId: result.claimed[0]!.id,
      message,
    })
  } catch {
    // best-effort
  }
}
