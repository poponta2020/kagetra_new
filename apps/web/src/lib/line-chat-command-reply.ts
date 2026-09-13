import { formatEventDate } from '@/lib/event-date'
import { buildTextMessage, type LineMessage } from '@/lib/line-mention'

/**
 * line-chat-commands: Bot がチャットコマンドへ返す文面（要件 §3.2.5）。
 *
 * **このモジュールは pure**（DB にも LINE API にも触らない）。`line-mention.ts` と
 * 同じ流儀で、webhook の返信分岐だけを DB 抜きでテストできるようにするため。
 *
 * ★**成功時の文面は用意しない。** 申込・支払が実際に進んだときは既存の
 * ライフサイクル通知（申込＝参加者向け・会計向けの2通／支払＝1通）が同じ
 * グループへ流れ、それが事実上の完了報告になる。ここへ「完了しました」を足すと
 * 1操作で3通になる（要件 §3.2.5・§7）。返信するのは**進まなかったとき**と
 * **一部しか進まなかったとき**だけ。
 *
 * ★権限が無い / メンションが無い / 語を含まない発言には**何も返さない**。その
 * 判定は呼び出し側（webhook ハンドラ）が返信を組み立てる前に済ませる契約で、
 * この モジュールには「無視」に対応する builder を置かない（置くと、うっかり
 * 呼べてしまう経路ができる）。
 */

/** LINE 起点で進められる操作。文面の語（申込済み／支払済み）を切り替えるのに使う。 */
export type ChatReplyAction = 'entry' | 'payment'

/** `M/D(曜)` の一覧を読点でつなぐ。 */
function formatDateList(dateIsos: readonly string[]): string {
  return dateIsos.map((iso) => formatEventDate(iso)).join('、')
}

/**
 * すでに完了している（対象の全開催日が applied / paid）。
 * 何も変わっていないことが伝わるようにする（AC-7）。
 */
export function buildAlreadyDoneReply(action: ChatReplyAction): LineMessage {
  return buildTextMessage(
    action === 'entry'
      ? 'この大会はすでに申込済みになっています。'
      : 'この大会はすでに支払済みになっています。',
  )
}

/**
 * 否定表現を含んでいて判定できなかった（要件 §3.2.4・AC-8）。
 * **操作を行っていないこと**を必ず書く — 「まだ申し込んでません」と送った人が
 * 「進んでしまったのでは」と不安にならないようにするため。
 */
export function buildNegatedReply(): LineMessage {
  return buildTextMessage(
    '打ち消しの言い方が含まれていたため、操作は行いませんでした。進める場合は「申し込みました」「振り込みました」のように送ってください。',
  )
}

/**
 * 進められる開催日が1日も無い（全日が「今回は申し込まない」／事前払いの日がゼロ 等）。
 * 「すでに完了」とは別物なので文面も分ける（要件 §3.2.5）。
 */
export function buildNoTargetReply(action: ChatReplyAction): LineMessage {
  return buildTextMessage(
    action === 'entry'
      ? '申込済みにできる開催日がありませんでした。北溟の進行管理から確認してください。'
      : '支払済みにできる開催日がありませんでした（事前払いの日がありません）。北溟の進行管理から確認してください。',
  )
}

/**
 * 現地払い・未設定の日が混ざっていて、事前払いの日だけを進めた（要件 §3.2.6・AC-6）。
 * 進めた日と対象外の日の**両方**を出す — 「全部払った」と思ったまま現地払いの日を
 * 忘れる事故を防ぐのがこの返信の目的なので、片方だけでは足りない。
 */
export function buildPartialPaymentReply(
  paidDateIsos: readonly string[],
  skippedDateIsos: readonly string[],
): LineMessage {
  return buildTextMessage(
    [
      `支払済みにしました: ${formatDateList(paidDateIsos)}`,
      `対象外（現地払い・未設定）: ${formatDateList(skippedDateIsos)}`,
    ].join('\n'),
  )
}

/** 実行に失敗した（要件 §3.2.5）。状態が進んでいない可能性を伝えて画面へ誘導する。 */
export function buildFailureReply(action: ChatReplyAction): LineMessage {
  return buildTextMessage(
    action === 'entry'
      ? '申込済みへの変更に失敗しました。北溟の進行管理から操作してください。'
      : '支払済みへの変更に失敗しました。北溟の進行管理から操作してください。',
  )
}
