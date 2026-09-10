import { and, asc, desc, eq, sql } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  lineChatTasks,
  membershipRenewals,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { db } from '@/lib/db'

/**
 * annual-registration-renewal タスク3: 会 LINE グループ設定（S3）の
 * データ層。`club_line_groups` は実質 1 行のシングルトンなので、
 * load/save は「1 行あるか無いか」で分岐するだけで足りる。
 *
 * 認可（admin/vice_admin）はここでは持たない。呼び出し元の Server Action
 * （settings/club-line-group/actions.ts）で判定する（既存の
 * settings/travel-report と同じ役割分担）。
 */

type Database = typeof appDb
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

type LineChatTaskStatus = (typeof lineChatTasks.$inferSelect)['status']
type LineChatTaskKind = (typeof lineChatTasks.$inferSelect)['kind']

export interface AvailableClubChatChannel {
  id: number
  label: string
}

export interface ClubLineGroupTaskRow {
  id: number
  kind: LineChatTaskKind
  targetDate: string
  splitIndex: number
  /** 同じ (renewal, kind, targetDate) を共有する未取消タスクの総数。1 なら分割なし。 */
  splitTotal: number
  scheduledSendAt: Date
  status: LineChatTaskStatus
  /** タスクが名指しした未回答者数（`target_user_ids` の要素数）。 */
  targetUserCount: number
  errorCode: string | null
  errorMessage: string | null
  /**
   * 再試行リンクを出してよいか。`lib/line-chat-tasks.ts` の `retryChatTask` が
   * `status='FAILED' AND scheduledSendAt > now()` のときだけ効くため
   * （requirements R10「再試行（送信予定が未来の場合のみ）」）、UI はここで
   * 判定済みの値を出す（クライアント側で現在時刻と比較して hydration ずれを
   * 起こさないため）。
   */
  retryable: boolean
}

export interface ClubLineGroupView {
  channelId: number
  botLabel: string
  oamAccountPath: string
  oamChatRoomId: string
  chatRoomName: string
  lineGroupId: string | null
  lineGroupCapturedAt: Date | null
  /** 直近 10 件（scheduledSendAt 降順）。 */
  tasks: ClubLineGroupTaskRow[]
}

/**
 * `line_channels` プールから club_chat 用に選べる候補（design-spec §10:
 * 「S3 の Bot 選択肢は line_channels の available 行（大会・級別と同じ絞り込み）」）。
 */
export async function listAvailableClubChatChannels(): Promise<AvailableClubChatChannel[]> {
  const rows = await db
    .select({ id: lineChannels.id, note: lineChannels.note, botId: lineChannels.botId })
    .from(lineChannels)
    .where(
      and(
        eq(lineChannels.purpose, 'event_broadcast'),
        eq(lineChannels.status, 'available'),
        sql`${lineChannels.assignedEntryGroupId} IS NULL`,
      ),
    )
    .orderBy(asc(lineChannels.id))
  return rows.map((row) => ({
    id: row.id,
    label: row.note ? `${row.note}（${row.botId}）` : row.botId,
  }))
}

/**
 * OAM のルーム URL（`https://chat.line.biz/<U…>/chat/<C…>`）から
 * アカウントパスとルーム ID を取り出す。`URL` パースを使うのは、末尾スラッシュや
 * クエリ文字列が付いた貼り付けミスを寛容に受け止めつつホスト名は厳密に見るため。
 */
const OAM_ROOM_PATH_PATTERN = /^\/(U[0-9a-fA-F]{32})\/chat\/(C[0-9a-fA-F]{32})\/?$/

export function parseOamRoomUrl(input: string): {
  oamAccountPath: string
  oamChatRoomId: string
} {
  const trimmed = input.trim()
  const formatError = new Error(
    'ルーム URL の形式が正しくありません（https://chat.line.biz/U…/chat/C… の形で貼り付けてください）',
  )
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw formatError
  }
  if (url.protocol !== 'https:' || url.hostname !== 'chat.line.biz') {
    throw formatError
  }
  const match = OAM_ROOM_PATH_PATTERN.exec(url.pathname)
  if (!match) {
    throw formatError
  }
  return { oamAccountPath: match[1]!, oamChatRoomId: match[2]! }
}

// 全角・半角どちらの丸括弧も対象（例:「令和8年度北海道大学かるた会 (67)」
// 「令和8年度北海道大学かるた会（67）」）。手前の空白（全角スペース込み）も含めて除去する。
const TRAILING_MEMBER_COUNT_PATTERN = /[\s　]*[（(]\s*\d+\s*[）)]\s*$/

/**
 * グループ表示名の末尾に付いた「人数の括弧」を取り除く。
 *
 * ワーカーの照合キーは OAM の見出しと**完全一致**が前提（requirements R10）だが、
 * OAM の見出し自体には人数（例:「(67)」）が表示されており、そのままコピペすると
 * 一致しない文字列が保存されてしまう。help 文言で注意喚起はするが、事故った場合の
 * 実害（リマインドが二度とメンションを解決できなくなる）が大きいため、保存経路で
 * 機械的に除去して防御する（人数はメンバー数の増減で変わる値なので、意図的な
 * 表示名の一部として保持する理由も無い）。
 */
export function normalizeChatRoomName(input: string): {
  name: string
  strippedCount: boolean
} {
  const trimmed = input.trim()
  const stripped = trimmed.replace(TRAILING_MEMBER_COUNT_PATTERN, '').trim()
  return { name: stripped, strippedCount: stripped !== trimmed }
}

/**
 * `line_channels` プールから club_chat 用に 1 体を転換する（CAS）。
 *
 * 級別グループ（`admin/line-grade-groups/actions.ts` の
 * `generateGradeInviteCode`）と同形: `purpose` だけでなく `status` も
 * 同じ UPDATE で `available` から外す。ここを崩すと大会側の
 * `reserveAvailableChannel`（status='available' だけを見る）が同じ Bot を
 * 大会へ割り当ててしまう。`status='system'` は流用しない
 * （`loadSystemChannel` が purpose で 1 行を引くため）。
 *
 * S3 は候補一覧から特定の 1 体をユーザーが選ぶ UI なので、級グループのように
 * 候補を順に奪い合うループは不要 —— 選ばれた 1 件に対して CAS を試み、
 * 既に他操作に奪われていれば「選び直してください」を返す。
 */
async function convertBotForClubChat(tx: Transaction, channelId: number): Promise<void> {
  const claimed = await tx
    .update(lineChannels)
    .set({ purpose: 'club_chat', status: 'assigned', updatedAt: sql`now()` })
    .where(
      and(
        eq(lineChannels.id, channelId),
        eq(lineChannels.purpose, 'event_broadcast'),
        eq(lineChannels.status, 'available'),
        sql`${lineChannels.assignedEntryGroupId} IS NULL`,
      ),
    )
    .returning({ id: lineChannels.id })
  if (claimed.length === 0) {
    throw new Error(
      '選択した Bot は使用できません（他の操作でプールから外れています）。画面を更新して選び直してください',
    )
  }
}

export interface SaveClubLineGroupInput {
  /** 未設定からの初回保存でのみ必須。設定済みの更新では無視する。 */
  channelId: number | null
  roomUrl: string
  chatRoomName: string
}

/**
 * S3 の保存。未設定なら Bot の転換込みで新規作成、設定済みならグループ情報
 * （URL・表示名）だけを更新する（Bot の差し替えは「プールへ戻す」→再設定の
 * 2 段階で行う設計。design-spec 「設定済みはグループの編集リンクのみ、
 * Bot の変更操作は無い」）。
 */
export async function saveClubLineGroup(
  input: SaveClubLineGroupInput,
  updatedBy: string,
): Promise<void> {
  const { oamAccountPath, oamChatRoomId } = parseOamRoomUrl(input.roomUrl)
  const { name: chatRoomName } = normalizeChatRoomName(input.chatRoomName)
  if (chatRoomName.length === 0) {
    throw new Error('グループ表示名を入力してください')
  }

  await db.transaction(async (tx) => {
    const existing = await tx.query.clubLineGroups.findFirst()

    if (existing) {
      await tx
        .update(clubLineGroups)
        .set({
          oamAccountPath,
          oamChatRoomId,
          chatRoomName,
          updatedBy,
          updatedAt: sql`now()`,
        })
        .where(eq(clubLineGroups.id, existing.id))
      return
    }

    if (input.channelId == null) {
      throw new Error('使う Bot を選択してください')
    }
    await convertBotForClubChat(tx, input.channelId)
    await tx.insert(clubLineGroups).values({
      lineChannelId: input.channelId,
      oamAccountPath,
      oamChatRoomId,
      chatRoomName,
      updatedBy,
    })
  })
}

/**
 * S3「プールへ戻す」。転換した Bot を `event_broadcast`/`available` へ戻し、
 * `club_line_groups` の行を削除する。`line_channel_id` は RESTRICT なので、
 * 参照している行を**先に削除**してから `line_channels` を更新する
 * （implementation-plan「その他の確定事項」）。
 *
 * 進行中の年度確認、または未終了の送信タスクが残っている間は拒否する
 * （requirements R10・implementation-plan タスク3）。「未終了」は
 * `PENDING`/`RESERVING`/`CANCEL_PENDING`（ワーカーがまだ手を付けていない、
 * または処理中、または取消待ちのタスク）。`RESERVED` 等の完了済みは
 * Bot を戻しても実害が無いので対象外。
 */
export async function revertClubLineGroup(): Promise<void> {
  await db.transaction(async (tx) => {
    // 参照ゼロ確認 → 削除は FOR UPDATE で直列化する既存規約
    // （`generateGradeInviteCode` と同じ形）。行はシングルトンだが、この行を
    // ロックしておくことで、年度確認の開始（タスク5）側が同じ行を FOR UPDATE
    // する設計にすれば「開始の直前に revert される」レースも塞げる
    // （タスク5への申し送り: 開始 Action は club_line_groups を FOR UPDATE
    // すること）。
    const lockedRows = await tx.select().from(clubLineGroups).for('update')
    const existing = lockedRows[0] ?? null
    if (!existing) {
      throw new Error('会 LINE グループが設定されていません')
    }

    const openRenewal = await tx.query.membershipRenewals.findFirst({
      where: eq(membershipRenewals.status, 'open'),
      columns: { id: true },
    })
    if (openRenewal) {
      throw new Error(
        '進行中の年度確認があるため、プールへ戻せません。年度確認の完了後にやり直してください',
      )
    }

    const unfinishedTask = await tx.query.lineChatTasks.findFirst({
      where: sql`${lineChatTasks.status} IN ('PENDING','RESERVING','CANCEL_PENDING')`,
      columns: { id: true },
    })
    if (unfinishedTask) {
      throw new Error(
        '未完了の送信タスクが残っているため、プールへ戻せません。タスクの完了・取消を待ってからやり直してください',
      )
    }

    await tx.delete(clubLineGroups).where(eq(clubLineGroups.id, existing.id))
    await tx
      .update(lineChannels)
      .set({ purpose: 'event_broadcast', status: 'available', updatedAt: sql`now()` })
      .where(eq(lineChannels.id, existing.lineChannelId))
  })
}

/**
 * `line_chat_tasks` から直近 10 件を読む（store モジュール `lib/line-chat-tasks.ts`
 * はタスク4が別途整備中のワーカー API 用で、S3 は読むだけなので素の drizzle
 * クエリで足りる。実装手順書「タスク一覧の読み取りも store を経由しなくてよい」）。
 *
 * 「(分割 n/m)」の m（同じ日の分割総数）は、未取消タスクを (renewal, kind,
 * targetDate) でグルーピングして数える。件数が少ない（年間数十件）ため、
 * 全件を JS 側で集計してから上位 10 件へ絞る。
 */
async function loadRecentTasks(dbc: DbOrTx): Promise<ClubLineGroupTaskRow[]> {
  const rows = await dbc
    .select({
      id: lineChatTasks.id,
      renewalId: lineChatTasks.renewalId,
      kind: lineChatTasks.kind,
      targetDate: lineChatTasks.targetDate,
      splitIndex: lineChatTasks.splitIndex,
      scheduledSendAt: lineChatTasks.scheduledSendAt,
      status: lineChatTasks.status,
      targetUserIds: lineChatTasks.targetUserIds,
      errorCode: lineChatTasks.errorCode,
      errorMessage: lineChatTasks.errorMessage,
    })
    .from(lineChatTasks)
    .orderBy(desc(lineChatTasks.scheduledSendAt))

  const splitTotals = new Map<string, number>()
  for (const row of rows) {
    if (row.status === 'CANCELLED') continue
    const key = `${row.renewalId}:${row.kind}:${row.targetDate}`
    splitTotals.set(key, (splitTotals.get(key) ?? 0) + 1)
  }

  const now = Date.now()
  return rows.slice(0, 10).map((row) => ({
    id: row.id,
    kind: row.kind,
    targetDate: row.targetDate,
    splitIndex: row.splitIndex,
    splitTotal: splitTotals.get(`${row.renewalId}:${row.kind}:${row.targetDate}`) ?? 1,
    scheduledSendAt: row.scheduledSendAt,
    status: row.status,
    targetUserCount: Array.isArray(row.targetUserIds) ? row.targetUserIds.length : 0,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    retryable: row.status === 'FAILED' && row.scheduledSendAt.getTime() > now,
  }))
}

export async function loadClubLineGroup(): Promise<ClubLineGroupView | null> {
  const row = await db.query.clubLineGroups.findFirst()
  if (!row) return null

  const channel = await db.query.lineChannels.findFirst({
    where: eq(lineChannels.id, row.lineChannelId),
    columns: { note: true, botId: true },
  })
  const tasks = await loadRecentTasks(db)

  return {
    channelId: row.lineChannelId,
    botLabel: channel?.note || channel?.botId || `#${row.lineChannelId}`,
    oamAccountPath: row.oamAccountPath,
    oamChatRoomId: row.oamChatRoomId,
    chatRoomName: row.chatRoomName,
    lineGroupId: row.lineGroupId,
    lineGroupCapturedAt: row.lineGroupCapturedAt,
    tasks,
  }
}
