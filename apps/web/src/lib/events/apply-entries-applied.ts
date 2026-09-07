import { and, eq, inArray, sql } from 'drizzle-orm'
import { events } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { lockEventRowsAscending, resolveEntryGroupId } from '@/lib/entry-groups'
import {
  buildLifecycleMessage,
  buildTreasurerNoticeMessage,
  claimLifecycleNotification,
  finalizeLifecycleNotification,
  sendClaimedNotificationBulk,
} from '@/lib/event-lifecycle-notify'
import { resolveTreasurerMention } from '@/lib/line-mention-targets'
import type { LineMessage } from '@/lib/line-mention'

/**
 * line-chat-commands タスク2: 申込済トグルの**中身**（認可・revalidate を含まない
 * 状態遷移＋完了通知）。`events/[id]/actions.ts` の `setEntriesApplied` から
 * **挙動を1つも変えずに**移設したもの。
 *
 * 抽出の動機は、LINE グループの発言（webhook）から同じ flip・claim・通知を
 * 呼べるようにすること。webhook には Server Action のセッションが無いので
 * `setEntriesApplied` をそのまま呼ぶことはできず、かといって同じ遷移を二重に
 * 書くと once-ever スロットの扱いが2箇所に散る（requirements §6）。
 *
 * ★**`'use server'` ファイルの外に置く**（`apply-payments-paid.ts` と同じ理由）。
 * `events/[id]/actions.ts` は `'use server'` なので、そこから export した関数は
 * それ自体が client から直接叩ける公開エンドポイントになる。認可ガードを持たない
 * この中核をそこへ置くと `requireAdminSession()` を通らない状態変更経路が生まれる。
 * ガード（`requireAdminSession`）と `revalidatePath` は呼び出し側に残す。
 *
 * ★**通知の push はここに含む**（`apply-payments-paid.ts` とは違う点）。申込は
 * 参加者向け・会計向けの2通で、しかも**エラー処理が意図的に非対称**（下記
 * `applyEntriesApplied` のコメント参照）。この非対称性ごと呼び出し側へ写すと
 * webhook 経路で崩れるため、送信までを1単位として抱える。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（apply-payments-paid.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * `applyEntriesApplied` の tx 内で使う1件分の flip 結果。
 *
 * `title` / `eventDate` / `paymentDeadline` / `paymentMethod` / `paymentInfo` は
 * line-bot-message-revamp タスク6（AC-29）で通知文面が固定文言化したため、以下の
 * message builder からは参照されなくなった（クエリの戻り値としては引き続き保持）。
 */
export interface AppliedFlipRow {
  id: number
  title: string
  eventDate: string
  lotteryDate: string | null
  paymentDeadline: string | null
  paymentMethod: string | null
  paymentInfo: string | null
}

export interface EntriesAppliedFlipResult {
  /**
   * 実際に `not_applied → applied` へ倒せた日の id（`cancelled` の日も含む ——
   * 状態変更は記録するが通知だけしない、が既存の規律）。
   *
   * ★**claim 系の配列と混同しないこと。** claim は「通知を送ってよい日」で、
   * once-ever を既に消費済みの日は空になる。「この操作で本当に何かが変わったか」を
   * 判断できるのは `flippedIds` だけ（line-chat-commands の返信分岐がこれを見る ——
   * 空なら「すでに完了」か「対象なし」の区別へ進む）。
   */
  flippedIds: number[]
  participantClaimed: AppliedFlipRow[]
  participantNotificationIds: number[]
  treasurerClaimed: AppliedFlipRow[]
  treasurerNotificationIds: number[]
}

export interface ApplyEntriesAppliedOutcome extends EntriesAppliedFlipResult {
  entryGroupId: number
  /** 重複除去・昇順に正規化した対象 id（revalidate の対象）。 */
  ids: number[]
}

/** 入力 id を重複除去して昇順にそろえる（デッドロック回避のロック順を固定するため）。 */
function normalizeIds(eventIds: readonly number[]): number[] {
  return Array.from(new Set(eventIds)).sort((a, b) => a - b)
}

/**
 * 参加者向け文面を組み立てる。line-bot-message-revamp タスク5で `entry_applied` は
 * 大会名・複数日ラベルを一切出さなくなったため、件数（rows.length）に関わらず同一の
 * 固定文面になる（`days` を組み立てて渡す必要が無くなった）。
 * 抽選日は全日で値が一致するときだけ追記する（一致しない/一部 null なら「未定」扱い。
 * 1件のときは自明に「全日一致」）。
 */
export function buildParticipantAppliedMessage(rows: readonly AppliedFlipRow[]): string {
  const lotteryDates = new Set(rows.map((r) => r.lotteryDate ?? ''))
  const commonLotteryDate = lotteryDates.size === 1 ? rows[0]!.lotteryDate : null
  return buildLifecycleMessage('entry_applied', { title: '', lotteryDateIso: commonLotteryDate })
}

/**
 * 会計向け文面を組み立てる（line-bot-message-revamp タスク6・AC-29）。
 *
 * §3.2.3 の予告文へ差し替えたため、件数（rows.length）・大会名・振込情報は一切
 * 参照しない — `@会計` メンション対象を解決して固定文言に載せるだけ。複数日でも
 * 単一日と同一の文面になるため、旧 `days` 組み立ては撤去した。
 */
export async function buildTreasurerAppliedMessage(dbc: Database): Promise<LineMessage> {
  const mention = await resolveTreasurerMention(dbc)
  return buildTreasurerNoticeMessage(mention)
}

/**
 * flip と claim の本体（**呼び出し側のトランザクションの中で動く**）。
 *
 * - id 昇順で1件ずつガード付き UPDATE（WHERE 旧状態）→ **flip できた行のうち
 *   `cancelled` はここで再ガードして claim 対象から除外**（状態変更そのものは
 *   記録する。既存の単一版と対称・AC-11 の集約版）
 * - 種別ごとに独立 claim（UNIQUE(event_id,type) で 2 回目以降は claim 失敗）
 *
 * `ids` は**正規化済み（重複除去・昇順）である前提**。
 */
export async function applyEntriesAppliedInTx(
  tx: Transaction,
  ids: readonly number[],
  entryGroupId: number,
): Promise<EntriesAppliedFlipResult> {
  const flippedIds: number[] = []
  const flippedNotCancelled: AppliedFlipRow[] = []
  for (const id of ids) {
    // 未申込→申込済 の初回遷移だけ通す（ガード）。会計向け文面に必要な
    // フィールド (lotteryDate / payment*) も同時に取り出す（コミット後の
    // 文面組立に使う）。
    const flipped = await tx
      .update(events)
      .set({ entryStatus: 'applied', entryAppliedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(events.id, id),
          eq(events.entryStatus, 'not_applied'),
          eq(events.entryGroupId, entryGroupId),
        ),
      )
      .returning({
        id: events.id,
        title: events.title,
        eventDate: events.eventDate,
        status: events.status,
        lotteryDate: events.lotteryDate,
        paymentDeadline: events.paymentDeadline,
        paymentMethod: events.paymentMethod,
        paymentInfo: events.paymentInfo,
      })
    const row = flipped[0]
    if (!row) continue
    flippedIds.push(row.id)
    // cancelled 大会には通知しない（要件 §3.2.2 #2、既存 entry_applied と対称）。
    // 状態変更そのものは記録する（once-ever スロットは消費しない＝後で復帰
    // しても通知しない方針は既存と一貫）。ここで再ガードして claim 対象から
    // 除外する — クライアントのダイアログ選択を信用しない fail-closed（AC-11）。
    if (row.status === 'cancelled') continue
    flippedNotCancelled.push({
      id: row.id,
      title: row.title,
      eventDate: row.eventDate,
      lotteryDate: row.lotteryDate,
      paymentDeadline: row.paymentDeadline,
      paymentMethod: row.paymentMethod,
      paymentInfo: row.paymentInfo,
    })
  }

  // 種別ごとに独立 claim（UNIQUE(event_id,type) で 2 回目以降は claim 失敗）。
  // 同一 tx 内で両方走らせるので、片方の claim 結果がもう片方を阻害することはない。
  const participantClaimed: AppliedFlipRow[] = []
  const participantNotificationIds: number[] = []
  const treasurerClaimed: AppliedFlipRow[] = []
  const treasurerNotificationIds: number[] = []
  for (const row of flippedNotCancelled) {
    const participantClaim = await claimLifecycleNotification(tx, row.id, 'entry_applied')
    if (participantClaim.id != null) {
      participantClaimed.push(row)
      participantNotificationIds.push(participantClaim.id)
    }
    const treasurerClaim = await claimLifecycleNotification(tx, row.id, 'entry_applied_treasurer')
    if (treasurerClaim.id != null) {
      treasurerClaimed.push(row)
      treasurerNotificationIds.push(treasurerClaim.id)
    }
  }

  return {
    flippedIds,
    participantClaimed,
    participantNotificationIds,
    treasurerClaimed,
    treasurerNotificationIds,
  }
}

/**
 * entry-groups タスク4 (AC-8/9/11): 申込状態の一括 flip ＋ 完了通知。
 *
 * - `eventIds` は重複除去して **id 昇順にソート**してから処理する（デッドロック
 *   回避。`applyEntryGroupChange` 等の既存パターンと同じ規律）
 * - 先頭 id（昇順最小）から解決した `entry_group_id` を全 UPDATE の WHERE に
 *   併記する fail-closed（クライアント申告のグループ外 id は無条件に対象から
 *   外れる。`propagateFieldsToGroup` と同じ再検証パターン）
 * - commit 後、**claim できた集合だけ**で参加者向け1通・会計向け1通を組んで
 *   push する（AC-9: 後から追加の日だけ claim できた分の通知になる）
 *
 * 対象 id が空なら `null`（現行の `setEntriesApplied` が早期 return するのと同じ）。
 */
export async function applyEntriesApplied(
  dbc: Database,
  eventIds: readonly number[],
  opts: { expectedEntryGroupId?: number } = {},
): Promise<ApplyEntriesAppliedOutcome | null> {
  const ids = normalizeIds(eventIds)
  if (ids.length === 0) return null
  const entryGroupId = await resolveEntryGroupId(dbc, ids[0]!)
  // ★呼び出し側が「このグループの日のはず」と申告しているときは、**flip の前に**
  //   突き合わせる（`applyPaymentsPaid` と同じ規律）。後ろで弾くと別グループの日が
  //   申込済になるだけでなく、その日の once-ever スロットまで claim で消費され、
  //   finalize されないまま残る —— そのグループの完了通知が二度と送れなくなる。
  if (opts.expectedEntryGroupId != null && opts.expectedEntryGroupId !== entryGroupId) {
    return null
  }

  // entry-notify-lottery-treasurer: 申込完了で 2 通送る（参加者向け＋会計向け）。
  // 両 claim は同一 tx で UNIQUE が判定するので、再トグルや並行呼び出しでも
  // それぞれ 1 回限り。コミット後の push は独立 try/catch (best-effort)。
  const result = await dbc.transaction((tx: Transaction) =>
    applyEntriesAppliedInTx(tx, ids, entryGroupId),
  )

  // 参加者向け（claim できた集合だけで1通。抽選日は全日同値のときだけ追記）。
  if (result.participantNotificationIds.length > 0) {
    const message = buildParticipantAppliedMessage(result.participantClaimed)
    try {
      await sendClaimedNotificationBulk(dbc, {
        notificationIds: result.participantNotificationIds,
        eventId: result.participantClaimed[0]!.id,
        message,
      })
    } catch {
      // best-effort: 状態変更はコミット済み。push 失敗で巻き戻さない。
    }
  }

  // 会計向け（claim できた集合だけで1通。§3.2.3 の予告文は固定・件数に関わらず同一）。
  // 参加者向けの push 失敗ともう片方の送信成否は独立（要件 §3.2.5）。
  if (result.treasurerNotificationIds.length > 0) {
    // claim（status='skipped' 行の INSERT）は tx で既にコミット済みなので、
    // ここから先で throw しても状態は巻き戻らない。buildTreasurerAppliedMessage
    // は resolveTreasurerMention 経由で DB を引くため throw しうる — try の外に
    // 置くと claim 済み行が 'skipped' のまま finalize されず、UNIQUE により
    // 再実行でも再 claim できなくなる（通知が恒久的に失われる）。
    //
    // ★参加者向けとのこの**非対称は意図的**。「揃える」整理をしないこと。
    try {
      const message = await buildTreasurerAppliedMessage(dbc)
      await sendClaimedNotificationBulk(dbc, {
        notificationIds: result.treasurerNotificationIds,
        eventId: result.treasurerClaimed[0]!.id,
        // 会計向けはメンション付き textV2 の1通（push は配列を受け取る契約）。
        message: [message],
      })
    } catch (err) {
      // best-effort: 状態変更はコミット済み。push/文面組立の失敗で巻き戻さない。
      // ただし claim 済み行を 'skipped' のまま放置しないよう、送信失敗と同じ
      // 扱いで finalize する（finalize 自体も best-effort）。
      const errorMessage = err instanceof Error ? err.message : String(err)
      await Promise.all(
        result.treasurerNotificationIds.map((id) =>
          finalizeLifecycleNotification(dbc, id, { status: 'failed', errorMessage }).catch(
            () => undefined,
          ),
        ),
      )
    }
  }

  return { entryGroupId, ids, ...result }
}

/**
 * 申込済を未申込へ戻す（誤操作の戻し用）。通知は送らない。
 * `not_applying` からの復帰もこの経路が担う（既存の `setEntriesApplied(ids, false)`）。
 * 対象 id が空なら `null`。
 */
export async function revertEntriesApplied(
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
      .set({ entryStatus: 'not_applied', entryAppliedAt: null, updatedAt: sql`now()` })
      .where(and(inArray(events.id, ids), eq(events.entryGroupId, entryGroupId)))
  })

  return { entryGroupId, ids }
}
