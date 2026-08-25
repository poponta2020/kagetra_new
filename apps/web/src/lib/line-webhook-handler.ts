import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  eventLineBroadcasts,
  events,
  lineChannels,
  lineGradeGroupBindings,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { isValidInviteCodeFormat, verifyInviteCode } from '@/lib/invite-code'
import { sendGuidelinesOnLink } from '@/lib/line-broadcast-guidelines'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { countGroupEntrants, formatEntrantCountParts } from '@/lib/entry-headcount'
import { todayInJst } from '@/lib/jst-date'
import {
  defaultLineGroupMembershipClient,
  filterToGroupMembers,
  type LineGroupMembershipClient,
} from '@/lib/line-group-membership'
import { buildMentionMessage, buildTextMessage, type LineMessage } from '@/lib/line-mention'
import { loadAdminLineUserIds, toMentionTarget } from '@/lib/line-mention-targets'

/**
 * webhook の構造化ログ (`(event, ctx) => void`) を、sendGuidelinesOnLink が期待
 * する `{ info, warn }` 形式のロガーへ橋渡しする。要綱送信の best-effort な
 * 失敗も webhook のログ経路に残す (AC-6)。
 */
function toGuidelinesLogger(
  log: (event: string, ctx: Record<string, unknown>) => void,
): {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
} {
  return {
    info: (msg, ctx) => log('guidelines_info', { msg, ...(ctx ?? {}) }),
    warn: (msg, ctx) => log('guidelines_warn', { msg, ...(ctx ?? {}) }),
  }
}

/**
 * LINE webhook entry point logic, extracted from the Next.js route handler
 * so it is unit-testable without spinning up a real request.
 *
 * Scope (mirrors requirements §4.4):
 *   - Verify X-Line-Signature using the destination's channel_secret.
 *   - On `join` event: record the source group ID + mark the broadcast row
 *     as joined_waiting_code, then reply once with the operator guidance.
 *   - On `leave` / `memberLeft`: tear the binding down (status='revoked',
 *     channel returned to the pool).
 *   - On `message` text matching /^\d{6}$/: verify against any open
 *     invite_pending / joined_waiting_code broadcast for this channel.
 *     On match, flip to linked and acknowledge. On mismatch, reply with
 *     a generic invalid message (we never tell the user *why* it failed
 *     — that signal helps an attacker triangulate stale codes).
 *   - All other event types and message shapes return without side effects.
 */

export interface LineWebhookSource {
  type: 'user' | 'group' | 'room' | string
  groupId?: string
  userId?: string
  roomId?: string
}

export interface LineWebhookEvent {
  type: string
  replyToken?: string
  source: LineWebhookSource
  message?: { type: string; text?: string }
}

export interface LineWebhookPayload {
  destination: string
  events: LineWebhookEvent[]
}

export interface LineReplyClient {
  /**
   * line-bot-message-revamp: 引数は**メッセージオブジェクトの配列**。
   * 紐付け完了の案内が①〜④の4通に分かれ、②③が `textV2`（メンション付き）に
   * なったため、`text: string` 1本では表現できなくなった（要件 §3.1.3）。
   * reply は1リクエスト最大5通まで。
   */
  reply(args: {
    replyToken: string
    messages: readonly LineMessage[]
    channelAccessToken: string
  }): Promise<void>
}

export interface HandleWebhookOptions {
  /**
   * Override `Date.now()` for deterministic tests.
   */
  now?: Date
  /**
   * Structured logging hook. 省略時は console へ JSON 1行を書く
   * （bug #542: 以前の既定は no-op で、本番の webhook 内エラーが痕跡ゼロに
   * なっていた）。テストはここを差し替えてイベントを検証する。
   */
  logger?: (event: string, ctx: Record<string, unknown>) => void
  /**
   * bug #542: ③（@管理者）のメンション対象をグループ在籍者へ絞るための
   * プローブ。省略時は LINE API を叩く既定実装。
   */
  membershipClient?: LineGroupMembershipClient
  /**
   * bug #542: 紐付け成立案内の reply が失敗したときの push フォールバック。
   * 省略時は LINE push API を叩く既定実装。
   */
  pushClient?: LinePushClient
}

/**
 * 既定 logger。journalctl で追えるよう stdout/stderr へ JSON 1行を書く。
 * 失敗系イベント（*_failed / *_warn）は console.error、それ以外は console.log。
 */
function defaultWebhookLogger(event: string, ctx: Record<string, unknown>): void {
  const line = JSON.stringify({ src: 'line-webhook', event, ...ctx })
  if (/_failed$|_warn$/.test(event)) {
    console.error(line)
  } else {
    console.log(line)
  }
}

export interface HandleWebhookResult {
  status: 200 | 401 | 404
  reason?: string
}

/**
 * Verify the LINE webhook signature.
 *
 * LINE signs the *raw* request body with HMAC-SHA256(channelSecret) and
 * sends the base64 in `X-Line-Signature`. The verification is per-channel
 * because each Bot in the broadcast pool has its own secret.
 *
 * Implementation note: `timingSafeEqual` requires equal-length buffers, so
 * we early-return on length mismatch before the comparison itself.
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64')
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

const ACTIVE_BROADCAST_STATUSES = [
  'invite_pending',
  'joined_waiting_code',
] as const

type LineChannelPurpose = (typeof lineChannels.$inferSelect)['purpose']

interface ChannelLookup {
  id: number
  channelSecret: string
  channelAccessToken: string
  purpose: LineChannelPurpose
}

async function loadChannelByDestination(
  db: typeof appDb,
  destination: string,
): Promise<ChannelLookup | null> {
  // LINE Messaging API webhooks send `destination` as the Bot's USER ID
  // (the `U` + 32-hex value), which is distinct from the Basic ID
  // (`@kagetra-event-bot-N`) stored in `bot_id`. We persist the user ID
  // separately in `webhook_destination_id` and route on it. The botId /
  // channelId fallbacks are kept for backwards compatibility with rows
  // seeded before this column existed (e.g. mid-rollout test fixtures);
  // a fresh production seed always populates webhookDestinationId.
  //
  // event-grade-group-broadcast: `grade_broadcast` チャネル (級別常設グループ)
  // もここで解決する必要があるので purpose フィルタを2値へ広げる。1 チャネル =
  // 1 purpose なので、戻り値の purpose を見るだけで下流の振り分けが排他になる。
  const rows = await db
    .select({
      id: lineChannels.id,
      channelSecret: lineChannels.channelSecret,
      channelAccessToken: lineChannels.channelAccessToken,
      botId: lineChannels.botId,
      channelId: lineChannels.channelId,
      webhookDestinationId: lineChannels.webhookDestinationId,
      purpose: lineChannels.purpose,
    })
    .from(lineChannels)
    .where(sql`${lineChannels.purpose} IN ('event_broadcast','grade_broadcast')`)
  const hit = rows.find((row) => {
    if (row.webhookDestinationId === destination) return true
    // Backward-compat fallback: only fires when webhookDestinationId is
    // NULL on the row (i.e. legacy seed). Once the operator re-runs the
    // seed script with the user ID populated, this branch becomes dead.
    if (row.webhookDestinationId == null) {
      return row.botId === destination || row.channelId === destination
    }
    return false
  })
  return hit
    ? {
        id: hit.id,
        channelSecret: hit.channelSecret,
        channelAccessToken: hit.channelAccessToken,
        purpose: hit.purpose,
      }
    : null
}

/**
 * Default `LineReplyClient` that hits LINE's reply endpoint with a raw
 * `fetch`. Lives in this module so callers can swap it in tests without
 * shimming `global.fetch`.
 */
export const defaultLineReplyClient: LineReplyClient = {
  async reply({ replyToken, messages, channelAccessToken }) {
    if (process.env.LINE_NOTIFY_DRY_RUN === '1') return
    if (messages.length === 0) return
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LINE reply failed: ${res.status} ${body.slice(0, 200)}`)
    }
  },
}

/**
 * bug #542: 紐付け成立案内の push フォールバック用クライアント。
 * reply と違い replyToken を要さないので、reply 失敗（トークン失効・LINE 側
 * エラー等）後の再送に使える。
 */
export interface LinePushClient {
  push(args: {
    to: string
    messages: readonly LineMessage[]
    channelAccessToken: string
  }): Promise<void>
}

export const defaultLinePushClient: LinePushClient = {
  async push({ to, messages, channelAccessToken }) {
    if (process.env.LINE_NOTIFY_DRY_RUN === '1') return
    if (messages.length === 0) return
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, messages }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LINE push failed: ${res.status} ${body.slice(0, 200)}`)
    }
  },
}

const INVITE_CODE_PATTERN = /^\d{6}$/

/**
 * Apply the side effects encoded in a verified webhook payload. Returns a
 * 200 even when individual events have nothing to do — LINE retries on
 * non-200, so swallowing errors here is intentional. Per-event failures
 * are surfaced via the logger.
 */
export async function applyWebhookEvents(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  payload: LineWebhookPayload,
  replyClient: LineReplyClient,
  options: HandleWebhookOptions = {},
  // event-grade-group-broadcast: 1チャネル=1purpose なので、呼び出し元
  // (handleLineWebhook) が解決済みチャネルの purpose をここへ渡すだけで
  // 大会用/級グループ用のフローが構造的に排他になる。既存の呼び出し元
  // (route.ts 経由 / このファイルの既存テスト) を壊さないよう末尾のオプション
  // 引数として追加し、省略時は従来どおり大会用として扱う。
  purpose: LineChannelPurpose = 'event_broadcast',
): Promise<void> {
  const now = options.now ?? new Date()
  const log = options.logger ?? defaultWebhookLogger
  const membershipClient = options.membershipClient ?? defaultLineGroupMembershipClient
  const pushClient = options.pushClient ?? defaultLinePushClient

  if (purpose === 'grade_broadcast') {
    await applyGradeGroupWebhookEvents(db, channelId, channelAccessToken, payload, replyClient, log)
    return
  }

  for (const event of payload.events) {
    try {
      switch (event.type) {
        case 'join': {
          await handleJoin(db, channelId, event)
          break
        }
        case 'leave': {
          // Bot 自身がグループから外された場合に発火する LINE 仕様。
          // `memberLeft` は通常メンバーの退出でも届くため別物として扱い、
          // ここでは処理しない (r2 review blocker)。
          await handleLeave(db, channelId, event)
          break
        }
        case 'message': {
          if (event.message?.type === 'text' && event.message.text) {
            const text = event.message.text.trim()
            if (INVITE_CODE_PATTERN.test(text)) {
              await handleInviteCode(
                db,
                channelId,
                channelAccessToken,
                event,
                text,
                replyClient,
                now,
                log,
                membershipClient,
                pushClient,
              )
            }
            // Non-code text and non-text messages are intentionally ignored.
          }
          break
        }
        default:
          // memberJoined, follow, etc. — surfaced for visibility but no-op.
          break
      }
    } catch (err) {
      log('webhook_event_failed', {
        channelId,
        eventType: event.type,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * 級グループ (`line_grade_group_bindings`) 用の webhook イベント処理。
 * 大会用 (`event_line_broadcasts`) のフローとはテーブルもライフサイクルの
 * 意味も異なるため、既存ハンドラを流用せず別関数として独立させる
 * (実装手順書の指定)。大会用と違い:
 *   - `line_channels.status` / `assignedEntryGroupId` は触らない (級用チャネルは
 *     大会に割り当てられる概念が無い常設チャネル)
 *   - `sendGuidelinesOnLink` (要綱送信) は呼ばない (大会に紐付かないので
 *     送るべき要綱が無い)
 *   - leave してもチャネルをプールへ戻さない (級用チャネルは常設)
 */
async function applyGradeGroupWebhookEvents(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  payload: LineWebhookPayload,
  replyClient: LineReplyClient,
  log: (event: string, ctx: Record<string, unknown>) => void,
): Promise<void> {
  for (const event of payload.events) {
    try {
      switch (event.type) {
        case 'join': {
          await handleGradeGroupJoin(db, channelId, event, channelAccessToken, replyClient)
          break
        }
        case 'leave': {
          // memberLeft は通常メンバーの退出でも届くため、大会用と同様に
          // ここでは扱わない (Bot 自身が外された leave のみ処理する)。
          await handleGradeGroupLeave(db, channelId, event)
          break
        }
        case 'message': {
          if (event.message?.type === 'text' && event.message.text) {
            const text = event.message.text.trim()
            if (INVITE_CODE_PATTERN.test(text)) {
              await handleGradeGroupInviteCode(
                db,
                channelId,
                channelAccessToken,
                event,
                text,
                replyClient,
              )
            }
          }
          break
        }
        default:
          break
      }
    } catch (err) {
      log('webhook_event_failed', {
        channelId,
        eventType: event.type,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

async function handleJoin(
  db: typeof appDb,
  channelId: number,
  event: LineWebhookEvent,
): Promise<void> {
  const groupId = event.source.groupId
  if (!groupId) return

  // Find the currently-open broadcast row for this channel (invite_pending).
  // If the operator regenerated the code while the Bot was being invited,
  // there may be multiple rows over time — but only one with this channel
  // and an active status is ever live (line_channels.assigned_event_id
  // UNIQUE keeps it so).
  await db
    .update(eventLineBroadcasts)
    .set({
      lineGroupId: groupId,
      status: 'joined_waiting_code',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(eventLineBroadcasts.lineChannelId, channelId),
        eq(eventLineBroadcasts.status, 'invite_pending'),
      ),
    )

  // line-bot-message-revamp (AC-22): join 時点の案内は廃止した。招待コード
  // 入力を促す旨は招待発行時に管理者へ別途伝わっている前提で、Bot が
  // グループへ入っただけの段階では reply を送らない（replyToken は消費しない）。
}

async function handleLeave(
  db: typeof appDb,
  channelId: number,
  event: LineWebhookEvent,
): Promise<void> {
  // rr1 review blocker: 同じ Bot が誤って別グループに招待されて出た場合、
  // 現在の大会グループの紐付けを壊さない。leave の source.groupId と
  // event_line_broadcasts.line_group_id が一致するときだけ revoke する。
  // groupId が無い leave (LINE 仕様上ほぼ無いが) は no-op + 警告ログ。
  const sourceGroupId = event.source?.groupId
  if (!sourceGroupId) {
    return
  }

  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(eventLineBroadcasts)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokeReason: 'bot_kicked',
        // 招待コードを残すと partial unique が後続発行を塞ぐので null 化
        // (review r1 should_fix)。
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventLineBroadcasts.lineChannelId, channelId),
          eq(eventLineBroadcasts.lineGroupId, sourceGroupId),
          sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code','linked')`,
        ),
      )
      .returning({ id: eventLineBroadcasts.id })

    // 該当する active 行が無ければ channel もそのまま (別グループからの
    // 退出など、現在の紐付けには関係ない leave)。
    if (revoked.length === 0) return

    await tx
      .update(lineChannels)
      .set({
        status: 'available',
        assignedEntryGroupId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(lineChannels.id, channelId))
  })
}

async function handleInviteCode(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  event: LineWebhookEvent,
  text: string,
  replyClient: LineReplyClient,
  now: Date,
  log: (event: string, ctx: Record<string, unknown>) => void,
  membershipClient: LineGroupMembershipClient,
  pushClient: LinePushClient,
): Promise<void> {
  if (!isValidInviteCodeFormat(text)) return

  const candidate = await db.query.eventLineBroadcasts.findFirst({
    where: and(
      eq(eventLineBroadcasts.lineChannelId, channelId),
      sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
    ),
    columns: {
      id: true,
      entryGroupId: true,
      inviteCode: true,
      inviteCodeExpiresAt: true,
      lineGroupId: true,
    },
  })

  const result = verifyInviteCode(
    text,
    candidate?.inviteCode ?? null,
    candidate?.inviteCodeExpiresAt ?? null,
    now,
  )

  const sourceGroupId = event.source?.groupId

  // rr4 review blocker: 招待コードはグループ紐付け用なので、user/room
  // (= groupId が無い source) からの redeem は拒否する。これを許すと
  // event_line_broadcasts.lineGroupId が null のまま linked になり、
  // 配信時に no_active_binding でスキップされるのに channel は active
  // のままプールから失われる。
  const groupIdMissing = !sourceGroupId

  // rr3 review blocker: 招待コードを別グループ (Bot が漏れて加入した
  // 別グループ、誤転送先 etc.) で redeem されないように、stored
  // lineGroupId が既にある場合は source.groupId と一致するときだけ
  // 受け付ける。null (= join 前 / lineGroupId 未確定) のときだけ初回セット。
  const storedGroupId = candidate?.lineGroupId ?? null
  const groupMismatch =
    storedGroupId != null && storedGroupId !== sourceGroupId

  if (!result.ok || !candidate || groupIdMissing || groupMismatch) {
    if (event.replyToken) {
      await replyClient.reply({
        replyToken: event.replyToken,
        messages: [buildTextMessage('❌ 招待コードが無効です。管理者に最新のコードを確認してください。')],
        channelAccessToken,
      })
    }
    return
  }

  // Bind the channel + broadcast to the event. lineGroupId は stored 値が
  // あればそれを尊重、無ければ source.groupId で初回セット。
  // groupIdMissing ガードを通過しているので sourceGroupId は string 確定。
  //
  // r-final-4 blocker: candidate 取得から UPDATE までは tx 外なので、
  // 管理者の revoke / reissue が同時に走ったり、複数コード発言が同じ
  // candidate を狙うレースが起こり得る。UPDATE WHERE に「事前検証時と
  // 同じ状態」を再掲して、stale な実行は RETURNING 0 件で弾く。
  let appliedSuccessfully = false
  try {
    await db.transaction(async (tx) => {
      const broadcastUpdate = await tx
        .update(eventLineBroadcasts)
        .set({
          status: 'linked',
          linkedAt: sql`now()`,
          lineGroupId: storedGroupId ?? sourceGroupId,
          // Invalidate the consumed code so it can't be reused — even if the
          // partial UNIQUE allowed it, replay would be confusing in the UI.
          inviteCode: null,
          inviteCodeExpiresAt: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(eventLineBroadcasts.id, candidate.id),
            sql`${eventLineBroadcasts.status} IN ('invite_pending','joined_waiting_code')`,
            eq(eventLineBroadcasts.inviteCode, text),
            sql`${eventLineBroadcasts.inviteCodeExpiresAt} > now()`,
            // lineGroupId は (a) NULL = まだ join 未確定 or (b) source と
            // 完全一致 のどちらかでなければ拒否。実行中に別グループから
            // 紐付けが進んでいたら整合性を保つ。
            sql`(${eventLineBroadcasts.lineGroupId} IS NULL OR ${eventLineBroadcasts.lineGroupId} = ${sourceGroupId})`,
          ),
        )
        .returning({ id: eventLineBroadcasts.id })

      if (broadcastUpdate.length === 0) {
        throw new Error('STALE_BROADCAST')
      }

      // r-final-1 blocker: assignedEntryGroupId を必ず再セット。
      // r-final-4 blocker: channel が別 group に再割当済みでないこと、
      // pool に戻っていない (disabled でない) ことを WHERE で再確認。
      const channelUpdate = await tx
        .update(lineChannels)
        .set({
          status: 'active',
          assignedEntryGroupId: candidate.entryGroupId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(lineChannels.id, channelId),
            sql`${lineChannels.status} IN ('available','assigned','active')`,
            sql`(${lineChannels.assignedEntryGroupId} IS NULL OR ${lineChannels.assignedEntryGroupId} = ${candidate.entryGroupId})`,
          ),
        )
        .returning({ id: lineChannels.id })

      if (channelUpdate.length === 0) {
        throw new Error('STALE_CHANNEL')
      }

      appliedSuccessfully = true
    })
  } catch (err) {
    // Stale 検出時は無効リプライを返してロールバック (tx 全体が revert)
    if (
      err instanceof Error &&
      (err.message === 'STALE_BROADCAST' || err.message === 'STALE_CHANNEL')
    ) {
      if (event.replyToken) {
        await replyClient.reply({
          replyToken: event.replyToken,
          messages: [buildTextMessage('❌ 招待コードが無効です。管理者に最新のコードを確認してください。')],
          channelAccessToken,
        })
      }
      return
    }
    throw err
  }

  if (!appliedSuccessfully) return

  // entry-groups タスク3: 紐付け先はグループなので、reply の大会名はグループ内
  // 全イベントのタイトルから導出する（deriveEntryGroupName、entry-groups.ts の
  // 表示名規則と同じ）。
  //
  // 導出不能なときは **代表イベント**（今日以降で最も近い開催日、無ければ最新）の
  // タイトルへフォールバックする（r2 review should_fix）。id 昇順の先頭では、作成順と
  // 開催日順が食い違うグループで他画面と別の大会名が出てしまう。
  const groupEvents = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      entryDeadline: events.entryDeadline,
    })
    .from(events)
    .where(eq(events.entryGroupId, candidate.entryGroupId))
    .orderBy(asc(events.id))
  const groupTitles = groupEvents.map((e) => e.title)
  const representative = selectRepresentativeEvent(groupEvents, todayInJst())
  const groupName =
    deriveEntryGroupName(groupTitles) ??
    representative?.title ??
    String(candidate.entryGroupId)

  // line-bot-message-revamp (AC-23〜25): ②の締切はグループ単位で同一という
  // 運用前提なので、日別に出し分けない。groupName のフォールバックに使った
  // のと同じ代表イベント（今日以降で最も近い開催日、無ければ最新）の
  // entry_deadline（= 主催者締切。internal_deadline ではない）を根拠に採用する
  // — 決定的な1件を選ぶ基準をこれ以上増やさないため。
  const entryDeadline = representative?.entryDeadline ?? null

  const headcountParts = formatEntrantCountParts(
    await countGroupEntrants(db, candidate.entryGroupId),
  )

  // groupIdMissing ガードを通過しているので sourceGroupId は string 確定。
  const linkedGroupId = storedGroupId ?? sourceGroupId!

  // bug #542: LINE の textV2 メンションは**グループ未在籍ユーザーを1人でも
  // 含むとメッセージ全体が 400 で拒否**され、reply は1リクエスト4通なので
  // 案内が全滅する。紐付け直後の新設グループに管理者全員が揃っていることは
  // 稀なので、③のメンション対象は在籍プローブで在籍者だけへ絞る
  // （0名なら buildMentionMessage の仕様で素テキスト `@管理者` 行へ倒れる）。
  const adminLineUserIds = await loadAdminLineUserIds(db)
  const memberAdminIds = await filterToGroupMembers(
    adminLineUserIds,
    { groupId: linkedGroupId, channelAccessToken },
    membershipClient,
    log,
  )
  const adminMention = toMentionTarget(memberAdminIds)

  // line-bot-message-revamp (AC-23): A-1（join 時の案内）廃止・A-3（紐付け成立時
  // の案内）を①〜④へ分割した（要件 §3.1.3）。①④は自由記述を含むので素テキスト、
  // ②③はメンション付きなので textV2（buildMentionMessage 経由）。1回の reply
  // で4通まとめて送る（reply は1リクエスト最大5通、⑤以降の要綱は別途 push）。
  const linkedMessages: LineMessage[] = [
    // ①: 大会名は自由記述なのでメンションを持たせず buildTextMessage で送る。
    buildTextMessage(`${groupName}大会案内用LINEグループです！\n以下確認をお願いします。`),
    // ②: entry_deadline が NULL（未定）のときは %s を持たない別テンプレートへ
    // 倒す — MentionValue に自由記述の文字列を渡せない設計のため（AC-8, AC-25）。
    entryDeadline == null
      ? buildMentionMessage({
          mention: { kind: 'all' },
          label: '@All',
          template:
            '大会の申し込み締め切りは未定です。当日までにこのLINE BOTから申込をした旨のアナウンスが届かない場合は申込を忘れているので、管理者を急かしてください。',
        })
      : buildMentionMessage({
          mention: { kind: 'all' },
          label: '@All',
          template:
            '大会の申し込み締め切りは%sです。当日までにこのLINE BOTから申込をした旨のアナウンスが届かない場合は申込を忘れているので、管理者を急かしてください。',
          values: [{ dateIso: entryDeadline }],
        }),
    // ③: 人数の文言（〇名／〇名（内他会〇名）)は formatEntrantCountParts が
    // 数値だけを返す（自由記述を textV2 本文へ混ぜられないため）。
    buildMentionMessage({
      mention: adminMention,
      label: '@管理者',
      template:
        '景虎上の申込人数は' +
        headcountParts.template +
        'です。管理者・会計を除いたグループの人数が一致していることを確認してください。',
      values: headcountParts.values,
    }),
    // ④: 固定文。
    buildTextMessage('以下大会要項になります、適宜ご確認ください'),
  ]

  // bug #542: 案内送信の失敗で要綱 push まで巻き添えにしない。reply が失敗
  // したらログへ残し、同一4通を push で1回だけ再送する（replyToken の失効や
  // LINE 側の一過性エラー対策）。push も失敗したらログのみ — DB は linked
  // 済みで正しい状態なので巻き戻さず、後続の配信機能はそのまま生かす。
  if (event.replyToken) {
    try {
      await replyClient.reply({
        replyToken: event.replyToken,
        messages: linkedMessages,
        channelAccessToken,
      })
    } catch (err) {
      log('linked_reply_failed', {
        channelId,
        broadcastId: candidate.id,
        message: err instanceof Error ? err.message : String(err),
      })
      try {
        await pushClient.push({
          to: linkedGroupId,
          messages: linkedMessages,
          channelAccessToken,
        })
        log('linked_push_fallback_sent', { channelId, broadcastId: candidate.id })
      } catch (pushErr) {
        log('linked_push_fallback_failed', {
          channelId,
          broadcastId: candidate.id,
          message: pushErr instanceof Error ? pushErr.message : String(pushErr),
        })
      }
    }
  }

  // broadcast-guidelines-on-link: 紐付け成立後に、管理者が選んだ「要綱」添付を
  // グループへ push する。紐付け成功の reply 枠は消費済みなので push。
  //
  // best-effort: sendGuidelinesOnLink は throw しない (linked を巻き戻さない,
  // AC-6)。多ファイル選択 (>5 = バッチ sleep) で webhook 応答が遅れて LINE が
  // 再送しても、CAS が再 link を弾く (STALE_BROADCAST) ので二重送信にはならない。
  // push は webhook 応答と独立に完走するため、fire-and-forget に「最適化」せず
  // あえて await してエラーログを残す。
  await sendGuidelinesOnLink(
    db,
    {
      eventLineBroadcastId: candidate.id,
      lineGroupId: linkedGroupId,
      channelAccessToken,
    },
    { logger: toGuidelinesLogger(log) },
  )
}

async function handleGradeGroupJoin(
  db: typeof appDb,
  channelId: number,
  event: LineWebhookEvent,
  channelAccessToken: string,
  replyClient: LineReplyClient,
): Promise<void> {
  const groupId = event.source.groupId
  if (!groupId) return

  // `line_channel_id` は UNIQUE なので、このチャネルに紐づく行は常に高々1件
  // (event_line_broadcasts と違って WHERE に status IN(...) の履歴考慮は不要)。
  // invite_pending の状態からのみ join で joined_waiting_code へ進める。
  await db
    .update(lineGradeGroupBindings)
    .set({
      lineGroupId: groupId,
      status: 'joined_waiting_code',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(lineGradeGroupBindings.lineChannelId, channelId),
        eq(lineGradeGroupBindings.status, 'invite_pending'),
      ),
    )

  // 既存 handleJoin と同様、UPDATE が行を更新したかに関わらず replyToken が
  // あれば案内を返す (更新の成否をユーザーに露出しない一貫した挙動)。
  if (event.replyToken) {
    await replyClient.reply({
      replyToken: event.replyToken,
      messages: [buildTextMessage('このグループは級別連絡用 Bot です。管理者から提示された 6 桁の招待コードを発言してください。')],
      channelAccessToken,
    })
  }
}

async function handleGradeGroupLeave(
  db: typeof appDb,
  channelId: number,
  event: LineWebhookEvent,
): Promise<void> {
  // 大会用 handleLeave と同じ理由: leave の source.groupId と現在の
  // lineGroupId が一致するときだけ revoke する。groupId が無い leave は no-op。
  const sourceGroupId = event.source?.groupId
  if (!sourceGroupId) return

  await db
    .update(lineGradeGroupBindings)
    .set({
      status: 'revoked',
      revokedAt: sql`now()`,
      revokeReason: 'bot_kicked',
      // 招待コードを残すと partial unique が後続の再発行を塞ぐので null 化。
      inviteCode: null,
      inviteCodeExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(lineGradeGroupBindings.lineChannelId, channelId),
        eq(lineGradeGroupBindings.lineGroupId, sourceGroupId),
        sql`${lineGradeGroupBindings.status} IN ('invite_pending','joined_waiting_code','linked')`,
      ),
    )
  // 級用チャネルは常設なので、大会用と違い line_channels をプールへ戻さない。
}

async function handleGradeGroupInviteCode(
  db: typeof appDb,
  channelId: number,
  channelAccessToken: string,
  event: LineWebhookEvent,
  text: string,
  replyClient: LineReplyClient,
): Promise<void> {
  if (!isValidInviteCodeFormat(text)) return

  const candidate = await db.query.lineGradeGroupBindings.findFirst({
    where: and(
      eq(lineGradeGroupBindings.lineChannelId, channelId),
      sql`${lineGradeGroupBindings.status} IN ('invite_pending','joined_waiting_code')`,
    ),
    columns: {
      id: true,
      inviteCode: true,
      inviteCodeExpiresAt: true,
      lineGroupId: true,
    },
  })

  const result = verifyInviteCode(
    text,
    candidate?.inviteCode ?? null,
    candidate?.inviteCodeExpiresAt ?? null,
  )

  const sourceGroupId = event.source?.groupId

  // 大会用 handleInviteCode の rr4 blocker と同じ理由: groupId が無い
  // (user/room) source からの redeem は拒否する。
  const groupIdMissing = !sourceGroupId

  // 大会用の rr3 blocker と同じ理由: stored lineGroupId が既にあるなら
  // source.groupId と一致するときだけ受け付ける (別グループでの redeem 防止)。
  const storedGroupId = candidate?.lineGroupId ?? null
  const groupMismatch = storedGroupId != null && storedGroupId !== sourceGroupId

  if (!result.ok || !candidate || groupIdMissing || groupMismatch) {
    if (event.replyToken) {
      await replyClient.reply({
        replyToken: event.replyToken,
        messages: [buildTextMessage('❌ 招待コードが無効です。管理者に最新のコードを確認してください。')],
        channelAccessToken,
      })
    }
    return
  }

  // 大会用の r-final-4 blocker と同じ理由: candidate 取得から UPDATE までは
  // tx 外なので、管理者の revoke / reissue や別グループからの同時 redeem と
  // 競合しうる。UPDATE の WHERE に検証時と同じ条件を再掲して CAS にし、stale
  // な実行は RETURNING 0 件で弾く。この UPDATE は line_grade_group_bindings
  // の1テーブルのみを書くので (line_channels は級用チャネルでは触らない)、
  // 大会用のような2テーブル tx は不要。
  const updated = await db
    .update(lineGradeGroupBindings)
    .set({
      status: 'linked',
      linkedAt: sql`now()`,
      lineGroupId: storedGroupId ?? sourceGroupId!,
      // 消費済みコードの再利用を防ぐため null 化。
      inviteCode: null,
      inviteCodeExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(lineGradeGroupBindings.id, candidate.id),
        sql`${lineGradeGroupBindings.status} IN ('invite_pending','joined_waiting_code')`,
        eq(lineGradeGroupBindings.inviteCode, text),
        sql`${lineGradeGroupBindings.inviteCodeExpiresAt} > now()`,
        sql`(${lineGradeGroupBindings.lineGroupId} IS NULL OR ${lineGradeGroupBindings.lineGroupId} = ${sourceGroupId})`,
      ),
    )
    .returning({ id: lineGradeGroupBindings.id, grade: lineGradeGroupBindings.grade })

  if (updated.length === 0) {
    if (event.replyToken) {
      await replyClient.reply({
        replyToken: event.replyToken,
        messages: [buildTextMessage('❌ 招待コードが無効です。管理者に最新のコードを確認してください。')],
        channelAccessToken,
      })
    }
    return
  }

  // 大会用と違い、line_channels の status/assignedEntryGroupId は触らない
  // (級用チャネルは常設で大会に割り当てられない)。sendGuidelinesOnLink
  // (要綱送信) も呼ばない (紐付く大会が無いので送るべき要綱が無い)。
  if (event.replyToken) {
    await replyClient.reply({
      replyToken: event.replyToken,
      messages: [buildTextMessage(`✅ ${updated[0]!.grade}級グループと紐付けました。今後この級宛の連絡をこのグループに自動配信します。`)],
      channelAccessToken,
    })
  }
}

/**
 * Full handler: signature verification + channel lookup + event dispatch.
 * The route handler in `app/api/webhook/line/route.ts` is a thin wrapper
 * that turns the Next.js Request into the inputs this function expects.
 */
export async function handleLineWebhook(
  db: typeof appDb,
  rawBody: string,
  signature: string | null,
  replyClient: LineReplyClient = defaultLineReplyClient,
  options: HandleWebhookOptions = {},
): Promise<HandleWebhookResult> {
  let payload: LineWebhookPayload
  try {
    payload = JSON.parse(rawBody) as LineWebhookPayload
  } catch {
    return { status: 401, reason: 'invalid_json' }
  }

  if (typeof payload.destination !== 'string' || !Array.isArray(payload.events)) {
    return { status: 401, reason: 'malformed_payload' }
  }

  const channel = await loadChannelByDestination(db, payload.destination)
  if (!channel) {
    // Unknown destination — could be a system-notify Bot routed here by
    // mistake, or a stale config. 404 keeps the response distinguishable
    // from signature failures.
    return { status: 404, reason: 'unknown_destination' }
  }

  if (!verifyLineSignature(rawBody, signature, channel.channelSecret)) {
    return { status: 401, reason: 'bad_signature' }
  }

  await applyWebhookEvents(
    db,
    channel.id,
    channel.channelAccessToken,
    payload,
    replyClient,
    options,
    channel.purpose,
  )
  return { status: 200 }
}
