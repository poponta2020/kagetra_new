import { and, asc, eq, sql } from 'drizzle-orm'
import {
  eventBroadcastGuidelineAttachments,
  eventLineBroadcasts,
  lineChannels,
  mailAttachments,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import { getOrCreateShareToken } from '@/lib/attachment-image-render'
import {
  buildAttachmentFlexMessage,
  type LineFlexAttachmentMessage,
} from '@/lib/line-flex-attachment'

/**
 * broadcast-guidelines-on-link: 紐付け完了 (linked) 時に、管理者が招待コード
 * モーダルで選んだ「要綱」添付だけを LINE グループへ push する best-effort
 * ヘルパー。
 *
 * webhook (`runtime='nodejs'`) と手動紐付け (`manualLinkGroup`) の両方から
 * 呼ばれる。`line-broadcast.ts`（sharp / libreoffice など重依存を巻き込む本文
 * 画像化パス）は import せず、ここで自己完結の最小 push を実装する。再利用する
 * のは署名 URL の `getOrCreateShareToken` だけ（node builtins 依存のみで、重い
 * バイナリ処理は spawn/遅延なので webhook から呼んでも問題ない）。
 *
 * 送信は「1 添付 = 署名 URL を開く Flex ファイルカード 1 通」
 * (line-attachment-flex-card。以前は生 URL の text 1 通)。本文送信・画像化・
 * partial resume は行わない（要件 Non-goals）。既存の全メール自動配信
 * (`event_broadcast_messages`) とは独立した経路で、監査行も流用しない。
 *
 * best-effort: 例外は投げず `logger.warn` で記録し、紐付け (linked) の成否には
 * 影響させない。全通配信できたときだけ `event_line_broadcasts.guidelines_sent_at`
 * を `now()` に更新する（partial/failed は NULL のままにして「要綱を再送」導線で
 * 復旧できるようにする）。
 */

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'

/** 5 通/バッチ + バッチ間 1.5 秒 sleep（既存 line-broadcast の pushMessages と同じ規約）。 */
const LINE_BATCH_SIZE = 5
const DEFAULT_BATCH_SLEEP_MS = 1500

/** 各 push に明示的な 30 秒タイムアウト（既存 broadcast と同じ）。 */
const PUSH_TIMEOUT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3

export interface SendGuidelinesArgs {
  /** 送信対象の LINE 連携行 = 選択 join のキー。 */
  eventLineBroadcastId: number
  /** 送信先 LINE グループ ID（紐付け成立時点で確定している値）。 */
  lineGroupId: string
  /** 送信に使う Bot のアクセストークン。 */
  channelAccessToken: string
  /** 署名 URL の公開 origin。未指定なら `PUBLIC_BASE_URL`。 */
  baseUrl?: string
}

export interface SendGuidelinesOptions {
  logger?: {
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
  }
  /** テスト用に fetch を差し替える。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch
  /** テストでバッチ間 sleep を 0 にするための上書き。既定 1500ms。 */
  batchSleepMs?: number
  /** 署名トークン発行時刻の注入（テスト用）。 */
  now?: Date
}

export interface SendGuidelinesResult {
  status: 'skipped' | 'sent' | 'partial' | 'failed'
  reason?: string
  sentCount: number
  totalCount: number
}

const NOOP_LOGGER = {
  info: () => undefined,
  warn: () => undefined,
}

/**
 * 公開 URL は LINE からアクセス可能な HTTPS でなければならない。env 未設定で
 * 固定ドメインへ静かにフォールバックすると原因追跡が難しい配信失敗になるため、
 * 明示的に検証する（line-broadcast.ts の resolveBaseUrl と同方針・重依存を
 * 巻き込まないためコピー）。best-effort なので throw しても最上位 catch が飲む。
 */
function resolveBaseUrl(override?: string): string {
  const candidate = override ?? process.env.PUBLIC_BASE_URL
  if (!candidate) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured. Guideline links require an HTTPS origin reachable from LINE servers.',
    )
  }
  if (!/^https:\/\//i.test(candidate)) {
    throw new Error(
      `PUBLIC_BASE_URL must use https:// (got "${candidate}"). LINE rejects http and bare hosts for attachment URLs.`,
    )
  }
  return candidate.replace(/\/$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface PushGuidelinesResult {
  deliveredCount: number
  error: Error | null
}

/**
 * <=5 通/バッチ・バッチ間 sleep で LINE グループへ push する。添付カード
 * 専用なので、line-broadcast.ts の pushMessages から role 別カウント・画像・
 * partial resume を落とした軽量版。`LINE_NOTIFY_DRY_RUN=1` のとき実 push を
 * 行わず配信済み扱いで返す（既存配信と同じ規約）。
 */
async function pushGuidelineMessages(
  fetchImpl: typeof fetch,
  channelAccessToken: string,
  to: string,
  messages: LineFlexAttachmentMessage[],
  opts: {
    logger: NonNullable<SendGuidelinesOptions['logger']>
    batchSleepMs: number
  },
): Promise<PushGuidelinesResult> {
  const { logger, batchSleepMs } = opts

  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping guideline push', {
      to,
      count: messages.length,
    })
    return { deliveredCount: messages.length, error: null }
  }

  let delivered = 0
  for (let i = 0; i < messages.length; i += LINE_BATCH_SIZE) {
    const batch = messages.slice(i, i + LINE_BATCH_SIZE)
    let attempt = 0
    let lastError: Error | null = null
    let batchSent = false

    while (!batchSent) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)
      try {
        const res = await fetchImpl(LINE_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ to, messages: batch }),
          signal: controller.signal,
        })
        if (res.ok) {
          delivered += batch.length
          batchSent = true
          break
        }

        // 429 (rate limit) は Retry-After を尊重して限定回数リトライ。
        if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
          const retryAfterSec = Number(res.headers.get('retry-after'))
          const waitMs =
            Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? Math.min(retryAfterSec, 60) * 1000
              : 5000
          logger.warn('guideline push 429, retrying after Retry-After', {
            attempt: attempt + 1,
            waitMs,
          })
          await sleep(waitMs)
          attempt++
          continue
        }

        const body = await res.text().catch(() => '')
        lastError = new Error(
          `LINE push failed: ${res.status} ${body.slice(0, 200)}`,
        )
        break
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || /aborted/i.test(err.message))
        lastError = isAbort
          ? new Error('LINE push timed out after 30s')
          : err instanceof Error
            ? err
            : new Error(String(err))
        break
      } finally {
        clearTimeout(timer)
      }
    }

    if (lastError) return { deliveredCount: delivered, error: lastError }
    if (i + LINE_BATCH_SIZE < messages.length) {
      await sleep(batchSleepMs)
    }
  }

  return { deliveredCount: delivered, error: null }
}

/**
 * 選択済みの要綱添付を LINE グループへ送信する。呼び出し側（webhook の紐付け
 * 成功後 / manualLinkGroup の linked 確定後）は本関数を await するが、throw
 * しないので try/catch は不要（防御的に囲っても害はない）。
 */
export async function sendGuidelinesOnLink(
  db: typeof appDb,
  args: SendGuidelinesArgs,
  options: SendGuidelinesOptions = {},
): Promise<SendGuidelinesResult> {
  const logger = options.logger ?? NOOP_LOGGER
  const fetchImpl = options.fetchImpl ?? fetch
  const batchSleepMs = options.batchSleepMs ?? DEFAULT_BATCH_SLEEP_MS

  try {
    // 選択済みの要綱添付を join から取得（attachment id 昇順で安定な送信順）。
    const selected = await db
      .select({
        attachmentId: eventBroadcastGuidelineAttachments.mailAttachmentId,
        filename: mailAttachments.filename,
        // Flex カードのサイズ表示用。data 本体 (bytea) を引かずに長さだけ取る。
        sizeBytes: sql<number>`octet_length(${mailAttachments.data})`,
      })
      .from(eventBroadcastGuidelineAttachments)
      .innerJoin(
        mailAttachments,
        eq(
          mailAttachments.id,
          eventBroadcastGuidelineAttachments.mailAttachmentId,
        ),
      )
      .where(
        eq(
          eventBroadcastGuidelineAttachments.eventLineBroadcastId,
          args.eventLineBroadcastId,
        ),
      )
      .orderBy(asc(eventBroadcastGuidelineAttachments.mailAttachmentId))

    // 要綱が未選択 = 何もしないのが正しい（未選択時は既存挙動と完全に同じ）。
    if (selected.length === 0) {
      return {
        status: 'skipped',
        reason: 'no_guidelines',
        sentCount: 0,
        totalCount: 0,
      }
    }

    // 防御的: グループ ID が無ければ送りようがない（呼び出し側が保証するはず）。
    if (!args.lineGroupId) {
      logger.warn('sendGuidelinesOnLink: missing lineGroupId; skipping', {
        eventLineBroadcastId: args.eventLineBroadcastId,
      })
      return {
        status: 'skipped',
        reason: 'no_group',
        sentCount: 0,
        totalCount: selected.length,
      }
    }

    // 送信対象がある場合だけ baseUrl を検証する（未設定なら throw → 下の catch）。
    const baseUrl = resolveBaseUrl(args.baseUrl)

    // 各添付を「大会要綱タグ付き Flex ファイルカード」1 通に組む
    // (line-attachment-flex-card。altText は 📎【大会要綱】ファイル名)。
    const messages: LineFlexAttachmentMessage[] = []
    for (const att of selected) {
      const { token } = await getOrCreateShareToken(db, att.attachmentId, {
        now: options.now,
      })
      const url = `${baseUrl}/api/line-broadcast/attachments/${token}`
      messages.push(
        buildAttachmentFlexMessage({
          filename: att.filename,
          url,
          sizeBytes: att.sizeBytes,
          tag: '大会要綱',
        }),
      )
    }

    // 送信直前に連携状態を再検証する（既存 broadcastMailToEvent の r-final-7 と
    // 同方針）。呼び出し元は linked 確定後 / loadActiveBinding 後に別トランザクション
    // で本関数を await するため、その間（特に多ファイル選択の batch sleep 中）に
    // 連携解除・再発行・チャネル再割当が走ると、既に無効な旧グループへ push したり
    // 再利用された行の guidelines_sent_at を誤って立て得る。送信時点で「同じ linked
    // binding（status=linked かつ lineGroupId・channelAccessToken 一致）」でなければ
    // 送信を中止する。
    const current = await db
      .select({
        status: eventLineBroadcasts.status,
        lineGroupId: eventLineBroadcasts.lineGroupId,
        channelAccessToken: lineChannels.channelAccessToken,
      })
      .from(eventLineBroadcasts)
      .innerJoin(
        lineChannels,
        eq(lineChannels.id, eventLineBroadcasts.lineChannelId),
      )
      .where(eq(eventLineBroadcasts.id, args.eventLineBroadcastId))
      .limit(1)
    const cur = current[0]
    if (
      !cur ||
      cur.status !== 'linked' ||
      cur.lineGroupId !== args.lineGroupId ||
      cur.channelAccessToken !== args.channelAccessToken
    ) {
      logger.warn('sendGuidelinesOnLink: binding changed before push; skipping', {
        eventLineBroadcastId: args.eventLineBroadcastId,
        currentStatus: cur?.status ?? null,
      })
      return {
        status: 'skipped',
        reason: 'binding_changed',
        sentCount: 0,
        totalCount: messages.length,
      }
    }

    const pushResult = await pushGuidelineMessages(
      fetchImpl,
      args.channelAccessToken,
      args.lineGroupId,
      messages,
      { logger, batchSleepMs },
    )

    const status: SendGuidelinesResult['status'] =
      pushResult.error == null && pushResult.deliveredCount === messages.length
        ? 'sent'
        : pushResult.deliveredCount > 0
          ? 'partial'
          : 'failed'

    // 全通配信できたときだけ最終送信日時を刻む。CAS で「送信開始時と同じ linked
    // binding」のときだけ更新し、送信中に再発行・連携解除で行が変わっていたら
    // 0 行更新 = stale として刻まない（監査不整合を防ぐ）。
    if (status === 'sent') {
      const stamped = await db
        .update(eventLineBroadcasts)
        .set({ guidelinesSentAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(eventLineBroadcasts.id, args.eventLineBroadcastId),
            eq(eventLineBroadcasts.status, 'linked'),
            eq(eventLineBroadcasts.lineGroupId, args.lineGroupId),
          ),
        )
        .returning({ id: eventLineBroadcasts.id })
      if (stamped.length === 0) {
        logger.warn(
          'sendGuidelinesOnLink: guidelines_sent_at not stamped (binding changed after push)',
          { eventLineBroadcastId: args.eventLineBroadcastId },
        )
      }
    }

    if (pushResult.error) {
      logger.warn('sendGuidelinesOnLink partial/failed', {
        eventLineBroadcastId: args.eventLineBroadcastId,
        delivered: pushResult.deliveredCount,
        total: messages.length,
        error: pushResult.error.message,
      })
    } else {
      logger.info('sendGuidelinesOnLink sent', {
        eventLineBroadcastId: args.eventLineBroadcastId,
        count: messages.length,
      })
    }

    return {
      status,
      reason: pushResult.error?.message,
      sentCount: pushResult.deliveredCount,
      totalCount: messages.length,
    }
  } catch (err) {
    // best-effort: 紐付け (linked) を巻き戻さない。想定外の例外もここで飲む。
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('sendGuidelinesOnLink failed (unexpected)', {
      eventLineBroadcastId: args.eventLineBroadcastId,
      error: message,
    })
    return { status: 'failed', reason: message, sentCount: 0, totalCount: 0 }
  }
}
