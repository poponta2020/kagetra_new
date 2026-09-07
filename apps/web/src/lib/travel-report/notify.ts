import 'server-only'
import { and, eq } from 'drizzle-orm'
import { travelUnitNotices } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { buildMentionMessage, buildTextMessage } from '@/lib/line-mention'
import {
  loadLinkedBindingForGroup,
  pushMessagesToEntryGroup,
} from '@/lib/event-lifecycle-notify'
import { resolveTravelReportSubmitterMention } from '@/lib/line-mention-targets'

/**
 * travel-report: 遠征経路が「全員そろった」ときの LINE 通知（requirements R8・AC-18）と、
 * 遠征届を作成したときの通知（R9・AC-28）。
 *
 * 送信の流れは既存の claim → push → finalize と同型（`payment-notice-send.ts`）:
 * **tx の中では push しない**。`saveTravelRoute` の tx が `travel_unit_notices` へ
 * `last_attempted_at` を書いて claim し、**コミット後に**この関数を呼ぶ。
 *
 * メンションは `@副連絡責任者`。LINE 未紐付けの副連絡責任者は黙って飛ばし、0人でも
 * 素テキストで送る（`buildMentionMessage` が `userIds: []` を素テキストへ倒す）。
 * グループに LINE 連携が無ければ**何も送らない**（S5 の入力状況で代替する）。
 */

/** メンション行の先頭に出す素テキスト（解決できないときの表示でもある）。 */
export const SUBMITTER_MENTION_LABEL = '@副連絡責任者'

export type TravelNotifyOutcome =
  | { outcome: 'sent' }
  | { outcome: 'skipped_unlinked' }
  | { outcome: 'failed'; error: string }

/**
 * `PUBLIC_BASE_URL` を解決する（`event-grade-broadcast.ts` / `entry-overdue-alert.ts` と
 * 同方針。重依存を避けるため import せずコピーする既存慣行）。
 * 未設定・http のときは `null` を返し、**リンク行を省くだけ**にする——遠征届の通知は
 * リンクが無くても用を成すので、ここで throw して通知そのものを落とさない。
 */
function resolveBaseUrl(): string | null {
  const candidate = process.env.PUBLIC_BASE_URL
  if (!candidate || !/^https:\/\//i.test(candidate)) return null
  return candidate.replace(/\/$/, '')
}

/** グループページ（S5）への絶対 URL。解決できなければ `null`。 */
function groupPageUrl(entryGroupId: number): string | null {
  const base = resolveBaseUrl()
  return base === null ? null : `${base}/admin/entries/${entryGroupId}`
}

interface PushInput {
  entryGroupId: number
  /** メンション行の下に置く本文。`%s` を `values` で順に置換する（自由記述を混ぜない）。 */
  template: string
  values: readonly (number | { dateIso: string })[]
  /** 大会名など、テンプレートに載せられない文字列を別メッセージで送る場合の行。 */
  extraLines: readonly string[]
}

/**
 * `@副連絡責任者` つきで送る共通部。
 *
 * ★大会名・URL は `buildMentionMessage` の template に混ぜず、`buildTextMessage` で
 * **別メッセージ**として送る（template は呼び出し側のリテラル定数であることが
 * `line-mention.ts` の契約。自由記述の string を差し込めない）。payment-notice と同型。
 */
async function pushWithSubmitterMention(input: PushInput): Promise<TravelNotifyOutcome> {
  const binding = await loadLinkedBindingForGroup(db, input.entryGroupId)
  // R8: LINE グループが紐付いていないグループでは送らない。
  if (!binding) return { outcome: 'skipped_unlinked' }

  const mention = await resolveTravelReportSubmitterMention(db)
  const messages = [
    buildMentionMessage({
      mention,
      label: SUBMITTER_MENTION_LABEL,
      template: input.template,
      values: input.values,
    }),
  ]
  const extra = input.extraLines.filter((l) => l.length > 0)
  if (extra.length > 0) messages.push(buildTextMessage(extra.join('\n')))

  const result = await pushMessagesToEntryGroup(db, input.entryGroupId, messages)
  if (result.outcome === 'sent') return { outcome: 'sent' }
  if (result.outcome === 'skipped') return { outcome: 'skipped_unlinked' }
  return { outcome: 'failed', error: result.reason ?? '不明なエラー' }
}

export interface AllEnteredNotifyInput {
  entryGroupId: number
  /** 遠征単位のキー（ブロック初日）。 */
  unitStartDate: string
  /** 対象者数（文面と `notified_member_count` に使う）。 */
  memberCount: number
  /** 大会名（別メッセージで送る）。 */
  tournamentName: string
}

/**
 * 「全員そろった」通知を送り、結果を `travel_unit_notices` へ書き戻す（R8・AC-18）。
 * **`saveTravelRoute` の tx がコミットしたあとに呼ぶこと。**
 */
export async function sendAllEnteredNotice(
  input: AllEnteredNotifyInput,
): Promise<TravelNotifyOutcome> {
  const result = await pushWithSubmitterMention({
    entryGroupId: input.entryGroupId,
    template: '遠征経路の入力が全員そろいました（%s名）。\n対象の遠征: %s から',
    values: [input.memberCount, { dateIso: input.unitStartDate }],
    extraLines: [
      input.tournamentName,
      groupPageUrl(input.entryGroupId) ?? '',
      '遠征届の作成はグループページからどうぞ。',
    ],
  })

  const where = and(
    eq(travelUnitNotices.entryGroupId, input.entryGroupId),
    eq(travelUnitNotices.unitStartDate, input.unitStartDate),
  )
  if (result.outcome === 'sent') {
    // ★成功したら失敗記録を消す（画面に「送信済」と「送信に失敗しました」が同居しない）。
    await db
      .update(travelUnitNotices)
      .set({
        allEnteredNotifiedAt: new Date(),
        lastError: null,
        notifiedMemberCount: input.memberCount,
      })
      .where(where)
  } else if (result.outcome === 'failed') {
    await db.update(travelUnitNotices).set({ lastError: result.error }).where(where)
  }
  // skipped_unlinked は記録を進めない（送っていないので「通知済」にしない。
  // `last_error` も立てない——紐付けが無いのは失敗ではなく設定の問題で、
  // S5 の入力状況が代わりに伝える）。
  return result
}

export interface CreatedNotifyInput {
  entryGroupId: number
  /** 生成したファイル数。 */
  fileCount: number
  tournamentName: string
}

/** 遠征届を作成したときの通知（R9・AC-28）。結果は呼び出し側が batch へ書く。 */
export async function sendTravelReportCreatedNotice(
  input: CreatedNotifyInput,
): Promise<TravelNotifyOutcome> {
  return pushWithSubmitterMention({
    entryGroupId: input.entryGroupId,
    template: '遠征届を作成しました（%s ファイル）。',
    values: [input.fileCount],
    extraLines: [
      input.tournamentName,
      groupPageUrl(input.entryGroupId) ?? '',
      'グループページの「遠征届」からダウンロードできます。',
    ],
  })
}
