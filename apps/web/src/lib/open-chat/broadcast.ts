import 'server-only'
import { entryGroupOpenChatBroadcasts } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import {
  applyPushFailureRecovery,
  assertBindingUnchangedByEntryGroup,
  loadActiveBindingByEntryGroup,
  pushMessages,
} from '@/lib/line-broadcast'
import { buildOpenChatFlexMessage } from '@/lib/open-chat/flex'
import { resolveOpenChatLabel, type OpenChatGrade } from '@/lib/open-chat/label'
import { listOpenChatsForGroup, loadOpenChatGroupContext } from '@/lib/open-chat/queries'

/**
 * オープンチャット配信の実処理（openchat-broadcast）。
 *
 * ★**`'use server'` のファイルに置かない。** そこから export した async 関数は
 * すべて公開エンドポイントになり、引数を絞った意味が無くなる（`queries.ts` の
 * 冒頭の注意書きと同じ理由）。認可は呼び出し側の Server Action が行う。
 *
 * ★配信の記録は `entry_group_open_chat_broadcasts` に持ち、
 * **`event_broadcast_messages` には一切書かない**（requirements §6 の契約）。
 * 同テーブルの UNIQUE(event_line_broadcast_id, mail_message_id) は「1メール=1配信」を
 * DB レベルで強制するため、「再配信は毎回全件を送る」と原理的に両立しない。
 */

/**
 * Flex メッセージ JSON のバイト長上限（LINE の上限 30KB に対する余裕込みの値）。
 *
 * ★固定の文字数・行数だけでは足りない。上限いっぱいの多バイト URL（1文字3バイト）を
 * 上限いっぱいの行数ぶん保存すると、個々の制限を全て通過したうえで合計が 30KB を
 * 超え得る。そうなると LINE が 400 を返し、`applyPushFailureRecovery` が
 * 「401 以外の 4xx ＝ groupId 不正」と見なして**正常な紐付けを revoke** し、
 * オープンチャットだけでなく以降のメール配信まで止まる。
 * そこで**実際に組み立てた Flex のバイト長**を保存前と配信前の両方で検証する。
 */
export const FLEX_PAYLOAD_MAX_BYTES = 25_000

/** 保存済み/保存予定の行から Flex を組み立て、バイト長が上限内かを判定する。 */
export function isFlexPayloadWithinLimit(
  rows: readonly { url: string; label: string; password: string | null }[],
  displayName: string,
): boolean {
  if (rows.length === 0) return true
  const message = buildOpenChatFlexMessage([...rows], displayName)
  return Buffer.byteLength(JSON.stringify(message), 'utf8') <= FLEX_PAYLOAD_MAX_BYTES
}

export type OpenChatBroadcastOutcome =
  /** LINE 紐付けが無いので配信しなかった（AC-37）。 */
  | { status: 'not_linked' }
  | { status: 'sent'; sentCount: number }
  | { status: 'failed'; error: string }
  /** 配信直前に紐付けが変わっていたので中止した（AC-39）。 */
  | { status: 'binding_changed' }
  /** 呼び出し元の前提（メールの処理世代など）が push 直前に崩れたので中止した。 */
  | { status: 'stale' }

/**
 * 保存済み全件を Flex 1通で配信する（AC-30〜AC-34）。
 *
 * **毎回全件を送る**（差分配信は「前に何が送られたか」を受け手が覚えている前提に
 * なるため）。再配信でも `event_broadcast_messages` を触らないので、同一メールから
 * 2回配信しても DB 制約違反にならない（AC-40, AC-41）。
 */
export async function runOpenChatBroadcast(args: {
  entryGroupId: number
  /** 呼び出し元が既に引いているときの再取得の節約用。未指定なら DB から導出する。 */
  displayName?: string
  /** 認証セッション由来の値だけを渡すこと（呼び出し元の申告を入れない）。 */
  sentByUserId: string
  /**
   * **push の直前**に呼ばれる中止判定。true を返したら送らない（Codex R3 blocker）。
   *
   * ★呼び出し元が事前にチェックしても意味が薄い — この関数は行の取得・大会名の導出・
   * 紐付けの取得と再検証で複数回 await するため、その間に前提が崩れ得る。LINE は
   * 送信後に取り消せないので、判定は**送る直前**まで持ち越す必要がある。
   * `processMail` はここに「メールが未処理へ戻されていないか」の再確認を渡す。
   */
  abortBeforePush?: () => Promise<boolean>
}): Promise<OpenChatBroadcastOutcome> {
  const sentByUserId = args.sentByUserId

  const rows = await listOpenChatsForGroup(args.entryGroupId)
  if (rows.length === 0) return { status: 'failed', error: '配信するオープンチャットがありません' }

  const displayName =
    args.displayName ?? (await loadOpenChatGroupContext(args.entryGroupId)).displayName

  const binding = await loadActiveBindingByEntryGroup(db, args.entryGroupId)
  // AC-37: LINE 未紐付けでは配信しない（保存は既に済んでいる）。履歴も残さない
  // ——「配信した」記録が無いのが正しく、N 回配信済みのカウントを汚さない。
  if (!binding) return { status: 'not_linked' }

  const flexRows = rows.map((r) => ({
    url: r.url,
    label: resolveOpenChatLabel({
      grades: r.grades as OpenChatGrade[] | null,
      eventDate: r.eventDate,
      freeLabel: r.label,
    }).label,
    password: r.password,
  }))

  // ★push する直前にもペイロード長を検証する。ここが**実際の防波堤** — 保存時の
  // 検証をすり抜けた行（別経路で入った古いデータ等）でも、過大な Flex を LINE へ
  // 投げない。投げると 400 が返り、`applyPushFailureRecovery` が正常な紐付けを
  // revoke してしまい、以降のメール配信まで止まる。
  if (!isFlexPayloadWithinLimit(flexRows, displayName)) {
    await db.insert(entryGroupOpenChatBroadcasts).values({
      entryGroupId: args.entryGroupId,
      sentCount: 0,
      status: 'failed',
      errorMessage: 'flex_payload_too_large',
      sentByUserId,
    })
    return {
      status: 'failed',
      error: '登録内容が多すぎて LINE で送れません。件数を減らすか URL を短くしてください',
    }
  }

  const message = buildOpenChatFlexMessage(flexRows, displayName)

  // AC-39: push 直前に紐付けを再検証する。判定だけを行い、記録はここで書く
  // （ヘルパーは event_broadcast_messages に触れない契約）。
  const { changed } = await assertBindingUnchangedByEntryGroup(db, args.entryGroupId, binding)
  if (changed) {
    await db.insert(entryGroupOpenChatBroadcasts).values({
      entryGroupId: args.entryGroupId,
      sentCount: 0,
      status: 'skipped',
      errorMessage: 'binding_changed',
      sentByUserId,
    })
    return { status: 'binding_changed' }
  }

  // ★最後の関門。ここまでの await の間に呼び出し元の前提が崩れていたら送らない。
  if (args.abortBeforePush && (await args.abortBeforePush())) {
    await db.insert(entryGroupOpenChatBroadcasts).values({
      entryGroupId: args.entryGroupId,
      sentCount: 0,
      status: 'skipped',
      errorMessage: 'aborted_before_push',
      sentByUserId,
    })
    return { status: 'stale' }
  }

  const pushResult = await pushMessages(
    binding.channel.channelAccessToken,
    binding.lineGroupId,
    [message],
  )

  if (pushResult.error) {
    await applyPushFailureRecovery({
      db,
      binding,
      httpStatus: pushResult.httpStatus,
      logContext: { entryGroupId: args.entryGroupId, feature: 'openchat-broadcast' },
    })
    await db.insert(entryGroupOpenChatBroadcasts).values({
      entryGroupId: args.entryGroupId,
      sentCount: 0,
      status: 'failed',
      errorMessage: pushResult.error.message,
      sentByUserId,
    })
    return { status: 'failed', error: pushResult.error.message }
  }

  await db.insert(entryGroupOpenChatBroadcasts).values({
    entryGroupId: args.entryGroupId,
    sentCount: rows.length,
    status: 'sent',
    sentByUserId,
  })
  return { status: 'sent', sentCount: rows.length }
}
