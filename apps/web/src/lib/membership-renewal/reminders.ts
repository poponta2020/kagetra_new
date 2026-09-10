import { and, eq, ne } from 'drizzle-orm'
import { clubLineGroups, lineChannels, lineChatTasks } from '@kagetra/shared/schema'
import {
  LINE_CHAT_RESERVE_MARGIN_MINUTES,
  RENEWAL_DISPLAY_NAME_BUDGET_MS,
  RENEWAL_MENTION_LIMIT_PER_MESSAGE,
} from '@kagetra/shared'
import type { RenewalMentionTarget } from '@kagetra/shared'
import { db } from '@/lib/db'
import { todayInJst } from '@/lib/jst-date'
import { createChatTask } from '@/lib/line-chat-tasks'
import { fetchGroupMemberDisplayName } from '@/lib/line-group-membership'
import { loadOpenRenewal, loadUnansweredZenTargets } from './store'
import { avoidSlotCollision, reminderSendAt, reminderTargetDates, splitTargets } from './schedule'
import { buildReminderMessage } from './messages'
import { resolveRenewalPageUrl } from './base-url'

/**
 * reminders: 19:30 バッチ（`--reminders`）の「未回答者集計 → 表示名解決 → 分割 →
 * タスク作成」を束ねる（annual-registration-renewal タスク8・R7・AC-15・AC-16・
 * AC-16b・AC-16c）。
 *
 * reconcile（`RESERVING` 滞留 → `MANUAL_REVIEW_REQUIRED`・期限切れ `PENDING` →
 * `FAILED`）は `lib/line-chat-tasks.ts` の `reconcileTasks` の責務のまま
 * ここでは呼ばない —— 呼び出し順序の束ね（reconcile → このモジュール）は
 * `scripts/renewal-daily.ts` が持つ。
 */

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}
const NOOP_LOGGER: Logger = { info: () => undefined, warn: () => undefined }

type UnansweredTarget = { userId: string; displayName: string; lineUserId: string | null }

/** テスト用に差し替え可能な表示名解決の関数シグネチャ。既定は `fetchGroupMemberDisplayName`。 */
export type ResolveDisplayNameFn = (args: {
  groupId: string
  userId: string
  channelAccessToken: string
}) => Promise<string | null>

export interface CreateReminderTasksOptions {
  now?: Date
  logger?: Logger
  /** テスト用に LINE API 呼び出しを差し替える（fetch を実際には呼ばない）。 */
  fetchDisplayName?: ResolveDisplayNameFn
}

export type CreateReminderTasksResult =
  | { skipped: 'no-open-renewal' }
  | { skipped: 'not-target-date' }
  | { skipped: 'already-created' }
  | { skipped: 'no-unanswered' }
  | { skipped: 'margin-exceeded' }
  | { created: number; renewalId: number; targetDate: string; taskIds: number[] }

/**
 * 会 LINE グループ設定（`club_line_groups` + `line_channels`）を 1 行読む。
 * S3 未設定（行なし）なら `null`。
 */
async function loadClubChatChannel(): Promise<{
  lineGroupId: string | null
  channelAccessToken: string
} | null> {
  const [row] = await db
    .select({
      lineGroupId: clubLineGroups.lineGroupId,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(clubLineGroups)
    .innerJoin(lineChannels, eq(lineChannels.id, clubLineGroups.lineChannelId))
    .limit(1)
  return row ?? null
}

/**
 * 1 チャンク分のメンション対象を解決する（R7・AC-16・AC-16c）。
 *
 * - 会グループ未設定・webhook 側グループ ID 未捕捉（`lineGroupId` が `null`）
 *   なら**表示名解決を一切行わず**、`errorCode: 'GROUP_ID_NOT_CAPTURED'` を返す
 *   （全員テキスト列挙のフォールバックは `buildReminderMessage` の氏名列挙が
 *   常に担うので、ここでは mentions を空にするだけでよい）。
 * - `lineUserId` が NULL の対象者は解決を試みない（本文には氏名がテキストで
 *   載るのでフォールバックが成立する）。
 * - 個々の API 失敗は throw させず、その人だけ mentions から外して続行する
 *   （1 人の判定失敗でリマインド全体を止めない）。全員が失敗すれば結果的に
 *   「全員テキスト列挙」になる（AC-16c）。
 * - **`deadline` を過ぎたら以降の解決を打ち切る**。表示名の取得は 1 人ずつ直列で
 *   1 件あたり 30 秒のタイムアウトがあるため、LINE API が遅いと 20 人で 600 秒＝
 *   systemd の `TimeoutStartSec=600` に達し、タスクを 1 件も作らないまま
 *   サービスが停止して**その日のリマインドが丸ごと消える**（Codex レビュー
 *   PR #631 blocker）。打ち切った分は氏名のテキスト列挙で送る。
 */
async function resolveMentionsForChunk(
  chunk: readonly UnansweredTarget[],
  club: { lineGroupId: string | null; channelAccessToken: string } | null,
  resolveDisplayName: ResolveDisplayNameFn,
  logger: Logger,
  /** 表示名解決を打ち切る時刻（バッチ全体で共有する時間予算）。 */
  deadline: number,
): Promise<{ mentions: RenewalMentionTarget[]; errorCode: string | null; errorMessage: string | null }> {
  if (!club || !club.lineGroupId) {
    return {
      mentions: [],
      errorCode: 'GROUP_ID_NOT_CAPTURED',
      errorMessage:
        '会 LINE グループの webhook 側グループ ID が未捕捉のため、表示名を解決せず氏名のテキスト列挙のみで送信します',
    }
  }

  const mentions: RenewalMentionTarget[] = []
  let anyFailure = false
  let budgetExceeded = false
  for (const target of chunk) {
    if (!target.lineUserId) continue
    if (Date.now() >= deadline) {
      budgetExceeded = true
      logger.warn('renewal reminder: display name budget exceeded; falling back to text', {
        remaining: chunk.length - mentions.length,
      })
      break
    }
    try {
      const displayName = await resolveDisplayName({
        groupId: club.lineGroupId,
        userId: target.lineUserId,
        channelAccessToken: club.channelAccessToken,
      })
      if (displayName) mentions.push({ displayName, placeholder: target.displayName })
    } catch (err) {
      anyFailure = true
      logger.warn('renewal reminder: display name fetch failed', {
        userId: target.userId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (budgetExceeded) {
    return {
      mentions,
      errorCode: 'DISPLAY_NAME_BUDGET_EXCEEDED',
      errorMessage:
        '表示名の取得に時間がかかりすぎたため途中で打ち切りました。解決できなかった対象者はメンションせず氏名のテキスト列挙のみになります',
    }
  }
  return {
    mentions,
    errorCode: anyFailure ? 'DISPLAY_NAME_FETCH_FAILED' : null,
    errorMessage: anyFailure
      ? '一部の対象者の表示名取得に失敗したため、該当者はメンションせず氏名のテキスト列挙のみになりました'
      : null,
  }
}

/**
 * `(renewal_id, kind='reminder', target_date=today)` の未取消タスクが既にあるか
 * （AC-15 の「同日に二重に作らない」判定・同日再実行の冪等性）。
 */
async function hasExistingReminderTask(renewalId: number, targetDate: string): Promise<boolean> {
  const [row] = await db
    .select({ id: lineChatTasks.id })
    .from(lineChatTasks)
    .where(
      and(
        eq(lineChatTasks.renewalId, renewalId),
        eq(lineChatTasks.kind, 'reminder'),
        eq(lineChatTasks.targetDate, targetDate),
        ne(lineChatTasks.status, 'CANCELLED'),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** 同じ年度確認の未取消タスクの送信予定（衝突回避の `taken` 集合の元）。 */
async function loadTakenSendAts(renewalId: number): Promise<Date[]> {
  const rows = await db
    .select({ scheduledSendAt: lineChatTasks.scheduledSendAt })
    .from(lineChatTasks)
    .where(and(eq(lineChatTasks.renewalId, renewalId), ne(lineChatTasks.status, 'CANCELLED')))
  return rows.map((r) => r.scheduledSendAt)
}

/**
 * 19:30 バッチの本体（`--reminders` の②）。進行中の年度確認があり、今日が対象日で、
 * 当日分の未取消リマインドタスクが無く、全日協未回答者が 1 人以上なら、表示名を
 * 解決して分割タスクを作る（R7・AC-15・AC-16・AC-16b）。
 *
 * `now` が 20:00 − `LINE_CHAT_RESERVE_MARGIN_MINUTES` 分を過ぎていたら作らずログ
 * （Persistent timer の catch-up 起動対策）。
 */
export async function createReminderTasksForToday(
  opts: CreateReminderTasksOptions = {},
): Promise<CreateReminderTasksResult> {
  const now = opts.now ?? new Date()
  const logger = opts.logger ?? NOOP_LOGGER
  const resolveDisplayName = opts.fetchDisplayName ?? fetchGroupMemberDisplayName

  const renewal = await loadOpenRenewal()
  if (!renewal) return { skipped: 'no-open-renewal' }

  const todayJst = todayInJst(now)
  const targetDates = reminderTargetDates(todayInJst(renewal.startedAt), renewal.deadline)
  if (!targetDates.includes(todayJst)) return { skipped: 'not-target-date' }

  if (await hasExistingReminderTask(renewal.id, todayJst)) {
    return { skipped: 'already-created' }
  }

  const unanswered = await loadUnansweredZenTargets(renewal.id)
  if (unanswered.length === 0) return { skipped: 'no-unanswered' }

  const marginBoundary = new Date(
    reminderSendAt(todayJst, 0).getTime() - LINE_CHAT_RESERVE_MARGIN_MINUTES * 60_000,
  )
  if (now.getTime() > marginBoundary.getTime()) {
    logger.warn('renewal reminder: skipped (past catch-up margin)', {
      renewalId: renewal.id,
      targetDate: todayJst,
    })
    return { skipped: 'margin-exceeded' }
  }

  const url = resolveRenewalPageUrl()
  if (!url) {
    throw new Error('PUBLIC_BASE_URL が設定されていないため、リマインドを作成できません')
  }

  const club = await loadClubChatChannel()
  const chunks = splitTargets(unanswered, RENEWAL_MENTION_LIMIT_PER_MESSAGE)
  const splitCount = chunks.length
  const taken = await loadTakenSendAts(renewal.id)

  // 全チャンクで共有する 1 つの時間予算。チャンクごとに配り直すと、分割数が
  // 増えたぶんだけ合計時間が伸びて systemd のタイムアウトに戻ってしまう。
  const displayNameDeadline = Date.now() + RENEWAL_DISPLAY_NAME_BUDGET_MS

  const taskIds: number[] = []
  for (let splitIndex = 0; splitIndex < chunks.length; splitIndex++) {
    const chunk = chunks[splitIndex]!
    const candidate = reminderSendAt(todayJst, splitIndex)
    const scheduledSendAt = avoidSlotCollision(candidate, taken)
    taken.push(scheduledSendAt)

    const { mentions, errorCode, errorMessage } = await resolveMentionsForChunk(
      chunk,
      club,
      resolveDisplayName,
      logger,
      displayNameDeadline,
    )
    const messageText = buildReminderMessage({
      fiscalYear: renewal.fiscalYear,
      deadlineJst: renewal.deadline,
      url,
      names: chunk.map((t) => t.displayName),
      splitIndex,
      splitCount,
    })

    const result = await createChatTask(db, {
      renewalId: renewal.id,
      kind: 'reminder',
      targetDate: todayJst,
      splitIndex,
      scheduledSendAt,
      messageText,
      mentions,
      targetUserIds: chunk.map((t) => t.userId),
      errorCode,
      errorMessage,
    })
    if ('id' in result) taskIds.push(result.id)
  }

  logger.info('renewal reminder: created', {
    renewalId: renewal.id,
    targetDate: todayJst,
    created: taskIds.length,
    unanswered: unanswered.length,
  })
  return { created: taskIds.length, renewalId: renewal.id, targetDate: todayJst, taskIds }
}

// ---------------------------------------------------------------------------
// --dry-run（scripts/renewal-daily.ts が呼ぶ）
// ---------------------------------------------------------------------------

export type PreviewReminderCandidatesResult =
  | { skipped: 'no-open-renewal' }
  | { skipped: 'not-target-date' }
  | { skipped: 'already-created' }
  | { skipped: 'no-unanswered' }
  | {
      renewalId: number
      targetDate: string
      unansweredCount: number
      splitCount: number
      /** 分割ぶんの本文プレビュー（表示名解決・タスク作成は行わない）。 */
      messages: string[]
    }

/**
 * `--dry-run` 用の候補プレビュー。`createReminderTasksForToday` と同じ判定
 * （対象日・既存タスクの有無・未回答者数）を読み取りだけで行い、LINE API 呼び出し
 * ・タスク作成のいずれも行わない（副作用ゼロ）。本文はメンション解決前の
 * 氏名テキスト列挙のプレビューになる。
 */
export async function previewReminderCandidates(
  opts: { now?: Date } = {},
): Promise<PreviewReminderCandidatesResult> {
  const now = opts.now ?? new Date()
  const renewal = await loadOpenRenewal()
  if (!renewal) return { skipped: 'no-open-renewal' }

  const todayJst = todayInJst(now)
  const targetDates = reminderTargetDates(todayInJst(renewal.startedAt), renewal.deadline)
  if (!targetDates.includes(todayJst)) return { skipped: 'not-target-date' }

  if (await hasExistingReminderTask(renewal.id, todayJst)) {
    return { skipped: 'already-created' }
  }

  const unanswered = await loadUnansweredZenTargets(renewal.id)
  if (unanswered.length === 0) return { skipped: 'no-unanswered' }

  const url = resolveRenewalPageUrl() ?? '(PUBLIC_BASE_URL 未設定)'
  const chunks = splitTargets(unanswered, RENEWAL_MENTION_LIMIT_PER_MESSAGE)
  const messages = chunks.map((chunk, splitIndex) =>
    buildReminderMessage({
      fiscalYear: renewal.fiscalYear,
      deadlineJst: renewal.deadline,
      url,
      names: chunk.map((t) => t.displayName),
      splitIndex,
      splitCount: chunks.length,
    }),
  )

  return {
    renewalId: renewal.id,
    targetDate: todayJst,
    unansweredCount: unanswered.length,
    splitCount: chunks.length,
    messages,
  }
}
