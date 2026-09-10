import { and, asc, eq, gt, inArray, lt, lte, notInArray, or } from 'drizzle-orm'
import { clubLineGroups, lineChatTasks, membershipRenewals } from '@kagetra/shared/schema'
import {
  LINE_CHAT_RESERVE_MARGIN_MINUTES,
  LINE_CHAT_RESERVING_STALE_MINUTES,
} from '@kagetra/shared'
import type { LineChatTaskKind, LineChatTaskStatus, RenewalMentionTarget } from '@kagetra/shared'
import type { db as appDb } from '@/lib/db'
import { db } from '@/lib/db'
import { loadSystemChannel, pushSystemText } from '@/lib/entry-overdue-alert'

/**
 * line-chat-tasks: `line_chat_tasks` の作成／遷移／取消／再試行を集約する store。
 *
 * ★責務分離（annual-registration-renewal タスク4）: このモジュールは**受け取った
 * 値を保存・遷移させるだけ**。送信時刻の導出・本文の組み立て・メンションの解決は
 * 呼び出し側（開始 Action・19:30 バッチ）が `lib/membership-renewal/schedule.ts` /
 * `messages.ts` で行う。**`lib/membership-renewal/**` を import しない**（それらは
 * 別タスクが同時に作成中）。
 *
 * ワーカー契約（`/api/line-chat-worker/**`）の正典は implementation-plan.md の
 * 「技術設計（確定）」節および docs/spec/notifications.md。
 */

type Database = typeof appDb
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

// ---------------------------------------------------------------------------
// ワーカー公開契約（match-tracker `line-chat-worker` 互換）
// ---------------------------------------------------------------------------

/**
 * `GET /api/line-chat-worker/tasks` の 1 要素。**`broadcastGroupId` /
 * `sessionId`（match-tracker 固有項目）は返さない**（ワーカー側で optional 化・
 * AC-22）。`mentions` は空なら**キーごと省略**する（旧ワーカーとの後方互換）。
 */
export interface WorkerTask {
  id: number
  status: 'PENDING' | 'CANCEL_PENDING'
  chatRoomId: string
  chatRoomName: string
  /** ISO8601・+09:00 固定・10 分境界。 */
  scheduledSendAt: string
  messageText: string
  mentions?: RenewalMentionTarget[]
}

/** `POST /api/line-chat-worker/{id}/result` の body。 */
export interface ReportTaskResultBody {
  status: LineChatTaskStatus
  errorCode?: string | null
  errorMessage?: string | null
  mentionResult?: { matched: string[]; unmatched: string[] } | null
}

export const LINE_CHAT_TASK_STATUS_VALUES: readonly LineChatTaskStatus[] = [
  'PENDING',
  'RESERVING',
  'RESERVED',
  'FAILED',
  'MANUAL_REVIEW_REQUIRED',
  'DRY_RUN_SUCCEEDED',
  'CANCEL_PENDING',
  'CANCELLED',
]

/** route 側の入力検証用（未知の文字列は遷移表に無いので常に 409 になるが、
 * ここで弾けば理由が「不正な値」であることをログで区別しやすい）。 */
export function isLineChatTaskStatus(value: unknown): value is LineChatTaskStatus {
  return (
    typeof value === 'string' &&
    (LINE_CHAT_TASK_STATUS_VALUES as readonly string[]).includes(value)
  )
}

/**
 * `sv-SE` ロケールで `YYYY-MM-DD HH:mm:ss` を得て ISO 風に組み立てる
 * （`api/external/tournament-entrants/route.ts` の `nowInJstIso` と同じ手法）。
 * `Asia/Tokyo` 固定なのでオフセットは常に `+09:00`。
 */
function toJstIso(date: Date): string {
  return `${date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T')}+09:00`
}

// ---------------------------------------------------------------------------
// 作成（冪等・部分 UNIQUE に任せる）
// ---------------------------------------------------------------------------

export type CreateChatTaskInput = {
  renewalId: number
  kind: LineChatTaskKind
  /** 'YYYY-MM-DD'（JST）。 */
  targetDate: string
  /** 既定 0。 */
  splitIndex?: number
  /** 呼び出し側が導出済み（10 分境界・未来）。 */
  scheduledSendAt: Date
  /** 完成形（未回答者を氏名テキストで列挙済み）。 */
  messageText: string
  mentions?: RenewalMentionTarget[]
  targetUserIds?: string[]
  /** AC-16c: 表示名解決に失敗した理由の記録（無ければ null）。 */
  errorCode?: string | null
  errorMessage?: string | null
}

export type CreateChatTaskResult = { id: number } | { skipped: 'duplicate' }

/**
 * `(renewal_id, kind, target_date, split_index) WHERE status <> 'CANCELLED'`
 * の部分 UNIQUE に任せて `onConflictDoNothing()` で作る（読んでから書く形に
 * しない）。Postgres の `ON CONFLICT DO NOTHING`（無ターゲット）はどの制約・
 * インデックス由来の衝突も無条件に飲み込むので、部分インデックスにもそのまま効く。
 * 取消済み（CANCELLED）の行があっても部分 UNIQUE の対象外なので作り直せる。
 */
export async function createChatTask(
  dbc: DbOrTx,
  input: CreateChatTaskInput,
): Promise<CreateChatTaskResult> {
  const [row] = await dbc
    .insert(lineChatTasks)
    .values({
      renewalId: input.renewalId,
      kind: input.kind,
      targetDate: input.targetDate,
      splitIndex: input.splitIndex ?? 0,
      scheduledSendAt: input.scheduledSendAt,
      messageText: input.messageText,
      mentions: input.mentions ?? [],
      targetUserIds: input.targetUserIds ?? [],
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: lineChatTasks.id })
  if (!row) return { skipped: 'duplicate' }
  return { id: row.id }
}

/** 分割ぶんをまとめて作る。1 件ずつ `createChatTask` を呼ぶだけ（`splitIndex` が
 * 異なれば別キーなので競合しない）。 */
export async function createChatTasks(
  dbc: DbOrTx,
  inputs: readonly CreateChatTaskInput[],
): Promise<CreateChatTaskResult[]> {
  const results: CreateChatTaskResult[] = []
  for (const input of inputs) {
    results.push(await createChatTask(dbc, input))
  }
  return results
}

// ---------------------------------------------------------------------------
// GET /tasks
// ---------------------------------------------------------------------------

/**
 * ワーカーへ渡す未処理タスク一覧。`club_line_groups` が未設定なら空配列（エラーに
 * しない）。
 *
 * 予約マージン（送信予定時刻 − `LINE_CHAT_RESERVE_MARGIN_MINUTES`）を適用するのは
 * **`PENDING` だけ**。それらは 19:30 バッチの `reconcileTasks` が `FAILED`
 * （`PENDING_EXPIRED`）へ倒す対象で、期限直前に新規予約させても間に合わないため。
 *
 * ★`CANCEL_PENDING` には**適用しない**。マージンは「これから予約を取りに行って
 * 間に合うか」の判定であって、既に OAM 側にある予約を**消す**要求とは無関係。
 * 適用すると、送信 5 分前以内に締切変更・登録完了で取り消したタスクがワーカーへ
 * 渡らず、取り消したはずのリマインドが予約時刻にそのまま送信される
 * （Codex レビュー PR #631 blocker）。
 */
export async function listWorkerTasks(dbc: DbOrTx, now: Date): Promise<WorkerTask[]> {
  const [group] = await dbc.select().from(clubLineGroups).limit(1)
  if (!group) return []

  const marginBoundary = new Date(now.getTime() + LINE_CHAT_RESERVE_MARGIN_MINUTES * 60_000)

  const rows = await dbc
    .select()
    .from(lineChatTasks)
    .where(
      and(
        inArray(lineChatTasks.status, ['PENDING', 'CANCEL_PENDING']),
        or(
          eq(lineChatTasks.status, 'CANCEL_PENDING'),
          gt(lineChatTasks.scheduledSendAt, marginBoundary),
        ),
      ),
    )
    .orderBy(asc(lineChatTasks.scheduledSendAt), asc(lineChatTasks.id))

  return rows.map((row) => {
    const task: WorkerTask = {
      id: row.id,
      status: row.status as 'PENDING' | 'CANCEL_PENDING',
      chatRoomId: group.oamChatRoomId,
      chatRoomName: group.chatRoomName,
      scheduledSendAt: toJstIso(row.scheduledSendAt),
      messageText: row.messageText,
    }
    if (row.mentions.length > 0) task.mentions = row.mentions
    return task
  })
}

// ---------------------------------------------------------------------------
// POST /{id}/result（状態遷移）
// ---------------------------------------------------------------------------

/**
 * 結果報告で許される「報告する状態 → 直前に必要な状態」の逆引き表。
 * PENDING → RESERVING → RESERVED | FAILED | MANUAL_REVIEW_REQUIRED |
 * DRY_RUN_SUCCEEDED、CANCEL_PENDING → CANCELLED。表に無い報告
 * （PENDING・CANCEL_PENDING 自体や未知の値）は常に 409。
 */
const REPORTABLE_PRIOR_STATUS: Partial<Record<LineChatTaskStatus, LineChatTaskStatus>> = {
  RESERVING: 'PENDING',
  RESERVED: 'RESERVING',
  FAILED: 'RESERVING',
  MANUAL_REVIEW_REQUIRED: 'RESERVING',
  DRY_RUN_SUCCEEDED: 'RESERVING',
  CANCELLED: 'CANCEL_PENDING',
}

export type ReportTaskResultOutcome = { ok: true } | { error: 'not_found' | 'conflict' }

/**
 * 条件付き UPDATE（現在の status を WHERE に入れる）で遷移する。読んでから
 * 書く形にしない — CAS が 0 行なら、404 と 409 を区別するためだけに再 SELECT する。
 */
export async function reportTaskResult(
  dbc: DbOrTx,
  id: number,
  body: ReportTaskResultBody,
): Promise<ReportTaskResultOutcome> {
  const priorStatus = REPORTABLE_PRIOR_STATUS[body.status]
  if (!priorStatus) {
    return classifyMissingOrConflict(dbc, id)
  }

  const setValues: Partial<typeof lineChatTasks.$inferInsert> = {
    status: body.status,
    errorCode: body.errorCode ?? null,
    errorMessage: body.errorMessage ?? null,
    updatedAt: new Date(),
  }
  if (body.status === 'RESERVING') {
    setValues.reservingAt = new Date()
  }
  if (body.mentionResult !== undefined) {
    setValues.mentionResult = body.mentionResult
  }

  const updated = await dbc
    .update(lineChatTasks)
    .set(setValues)
    .where(and(eq(lineChatTasks.id, id), eq(lineChatTasks.status, priorStatus)))
    .returning({ id: lineChatTasks.id })

  if (updated.length > 0) return { ok: true }
  return classifyMissingOrConflict(dbc, id)
}

async function classifyMissingOrConflict(
  dbc: DbOrTx,
  id: number,
): Promise<ReportTaskResultOutcome> {
  const [row] = await dbc
    .select({ id: lineChatTasks.id })
    .from(lineChatTasks)
    .where(eq(lineChatTasks.id, id))
    .limit(1)
  return row ? { error: 'conflict' } : { error: 'not_found' }
}

// ---------------------------------------------------------------------------
// 取消（締切変更・登録完了から呼ばれる）
// ---------------------------------------------------------------------------

export interface CancelTasksOptions {
  renewalId: number
  kinds?: readonly LineChatTaskKind[]
  /** 新しい対象日集合。含まれない `target_date` の行だけを取り消す。 */
  keepTargetDates?: readonly string[]
}

/**
 * `PENDING → CANCELLED` / `RESERVED → CANCEL_PENDING` へ倒す。`RESERVING` は
 * ワーカーが操作中なので触らない。2 つの独立した UPDATE（対象の現在 status が
 * 排他的なので競合しない）に分け、CASE 式や enum キャストを避ける。
 */
export async function cancelTasks(dbc: DbOrTx, opts: CancelTasksOptions): Promise<number> {
  const baseConditions = [eq(lineChatTasks.renewalId, opts.renewalId)]
  if (opts.kinds && opts.kinds.length > 0) {
    baseConditions.push(inArray(lineChatTasks.kind, opts.kinds as LineChatTaskKind[]))
  }
  if (opts.keepTargetDates && opts.keepTargetDates.length > 0) {
    baseConditions.push(notInArray(lineChatTasks.targetDate, opts.keepTargetDates as string[]))
  }

  const toCancelled = await dbc
    .update(lineChatTasks)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(...baseConditions, eq(lineChatTasks.status, 'PENDING')))
    .returning({ id: lineChatTasks.id })

  const toCancelPending = await dbc
    .update(lineChatTasks)
    .set({ status: 'CANCEL_PENDING', updatedAt: new Date() })
    .where(and(...baseConditions, eq(lineChatTasks.status, 'RESERVED')))
    .returning({ id: lineChatTasks.id })

  return toCancelled.length + toCancelPending.length
}

// ---------------------------------------------------------------------------
// 再試行（S3 から呼ばれる）
// ---------------------------------------------------------------------------

/**
 * ★認可の置き場所（実装への申し送り）: `retryChatTask` 自体は**セッション確認を
 * 持たない**。認可は呼び出し側（`settings/club-line-group/actions.ts` の
 * `retryClubLineGroupTaskAction`）の責務とする。
 *
 * 理由:
 *   - 実装手順書のシグネチャどおり `retryChatTask(taskId: number)`（`dbc` も
 *     受け取らない）。タスク3 の Server Action が既にこの形で
 *     `await requireAdminSession(); const result = await retryChatTask(taskId)`
 *     と呼んでおり、ここへ `dbc`/`session` 引数を足すと呼び出し側を壊す。
 *     テスト（DB-backed）は vitest.setup.ts が `DATABASE_URL` をテスト DB へ
 *     固定するため、この lib が直接 import する `db`（本番と同じ import）が
 *     `testDb` と同一の物理 DB を指す——`club-line-group.ts` と同じ前提。
 *   - 既存の類似実装（`apply-entries-applied.ts` / `apply-payments-paid.ts`）も
 *     同じ分担を取っている: 状態遷移の中核は `'use server'` ファイルの外に置き、
 *     `requireAdminSession()`（またはそれに相当する認可）と `revalidatePath` は
 *     呼び出し側の Server Action に残す。中核へ認可を持たせると、将来別の呼び出し
 *     元（例: バッチ）を足したときに毎回セッション相当のダミーを用意する必要が
 *     生まれる。
 *   - したがって **`/settings/club-line-group/actions.ts` 側で
 *     `admin`/`vice_admin` の確認を行ってから本関数を呼ぶこと**（実際に既にそう
 *     呼ばれている）。
 */
export async function retryChatTask(taskId: number): Promise<{ error?: string }> {
  const now = new Date()
  // ★進行中（`open`）の年度確認のタスクだけを戻す。これが無いと、登録完了で
  // 取り消し・終了したはずの失敗タスクを S3 の「再試行」で `PENDING` へ復活させ、
  // 廃止済みのリマインドを送れてしまう（Codex レビュー PR #631 blocker）。
  // 条件は UPDATE の WHERE に入れる —— 読んでから書く形にすると、確認から
  // UPDATE までの間に登録完了が走ったときにすり抜ける。
  const openRenewalIds = db
    .select({ id: membershipRenewals.id })
    .from(membershipRenewals)
    .where(eq(membershipRenewals.status, 'open'))

  const updated = await db
    .update(lineChatTasks)
    .set({ status: 'PENDING', errorCode: null, errorMessage: null, updatedAt: now })
    .where(
      and(
        eq(lineChatTasks.id, taskId),
        eq(lineChatTasks.status, 'FAILED'),
        gt(lineChatTasks.scheduledSendAt, now),
        inArray(lineChatTasks.renewalId, openRenewalIds),
      ),
    )
    .returning({ id: lineChatTasks.id })
  if (updated.length > 0) return {}

  const [row] = await db
    .select({
      status: lineChatTasks.status,
      scheduledSendAt: lineChatTasks.scheduledSendAt,
      renewalStatus: membershipRenewals.status,
    })
    .from(lineChatTasks)
    .innerJoin(membershipRenewals, eq(membershipRenewals.id, lineChatTasks.renewalId))
    .where(eq(lineChatTasks.id, taskId))
    .limit(1)
  if (!row) return { error: 'タスクが見つかりません' }
  if (row.renewalStatus !== 'open') {
    return { error: '登録完了した年度確認のタスクは再試行できません' }
  }
  if (row.status !== 'FAILED') return { error: '再試行できるのは失敗したタスクだけです' }
  return { error: '送信予定時刻を過ぎているため再試行できません' }
}

// ---------------------------------------------------------------------------
// reconcile（19:30 バッチが呼ぶ）
// ---------------------------------------------------------------------------

export interface ReconcileTasksResult {
  staleReserving: number
  expiredPending: number
}

/**
 * ①`RESERVING` のまま `LINE_CHAT_RESERVING_STALE_MINUTES` 超過 →
 * `MANUAL_REVIEW_REQUIRED`（`RESERVING_STALE`）。
 * ②送信予定時刻 − `LINE_CHAT_RESERVE_MARGIN_MINUTES` を過ぎた `PENDING` →
 * `FAILED`（`PENDING_EXPIRED`）。`listWorkerTasks` の除外境界と同じ
 * `marginBoundary` を使う（ワーカーへ見せなくなる瞬間と失敗にする瞬間を揃える）。
 */
export async function reconcileTasks(
  dbc: DbOrTx,
  now: Date,
): Promise<ReconcileTasksResult> {
  const staleThreshold = new Date(now.getTime() - LINE_CHAT_RESERVING_STALE_MINUTES * 60_000)
  const staleReserving = await dbc
    .update(lineChatTasks)
    .set({
      status: 'MANUAL_REVIEW_REQUIRED',
      errorCode: 'RESERVING_STALE',
      errorMessage: `RESERVING のまま ${LINE_CHAT_RESERVING_STALE_MINUTES} 分を超えて滞留しました`,
      updatedAt: now,
    })
    .where(and(eq(lineChatTasks.status, 'RESERVING'), lt(lineChatTasks.reservingAt, staleThreshold)))
    .returning({ id: lineChatTasks.id })

  const marginBoundary = new Date(now.getTime() + LINE_CHAT_RESERVE_MARGIN_MINUTES * 60_000)
  const expiredPending = await dbc
    .update(lineChatTasks)
    .set({
      status: 'FAILED',
      errorCode: 'PENDING_EXPIRED',
      errorMessage: '送信予定時刻に間に合わず、予約されないまま期限を過ぎました',
      updatedAt: now,
    })
    .where(
      and(eq(lineChatTasks.status, 'PENDING'), lte(lineChatTasks.scheduledSendAt, marginBoundary)),
    )
    .returning({ id: lineChatTasks.id })

  return { staleReserving: staleReserving.length, expiredPending: expiredPending.length }
}

// ---------------------------------------------------------------------------
// 管理者通知の中継（AC-23。entry-overdue-alert.ts の loadSystemChannel /
// pushSystemText を再利用し、新しい push 実装を書かない）
// ---------------------------------------------------------------------------

export interface NotifyRenewalAdminOptions {
  logger?: Logger
  /** テスト用に fetch を差し替える。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch
}

/**
 * `system_notify` チャネルの管理者個人 LINE へテキスト 1 通を push する。チャネル
 * 未設定・`notification_line_user_id` 未設定なら**何もせず** `notified: false` を
 * 返す（throw しない。`event-grade-broadcast.ts` の `notifyAdmin` と同方針）。
 * push によるグループへのフォールバック送信はしない（AC-23）。
 */
export async function notifyRenewalAdmin(
  dbc: DbOrTx,
  text: string,
  opts: NotifyRenewalAdminOptions = {},
): Promise<{ notified: boolean }> {
  const logger = opts.logger ?? NOOP_LOGGER
  const channel = await loadSystemChannel(dbc, logger)
  if (!channel || !channel.notificationLineUserId) return { notified: false }

  const result = await pushSystemText(
    { channelAccessToken: channel.channelAccessToken, notificationLineUserId: channel.notificationLineUserId },
    text,
    { logger, fetchImpl: opts.fetchImpl },
  )
  return { notified: result.outcome === 'sent' }
}
