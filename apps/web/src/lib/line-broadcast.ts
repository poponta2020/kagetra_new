import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  eventBroadcastMessages,
  eventLineBroadcasts,
  lineChannels,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import {
  RENDER_PAGE_LIMIT,
  getOrCreateShareToken,
  renderDocxToJpegs,
  renderPdfToJpegs,
} from '@/lib/attachment-image-render'
import { setCachedImage } from '@/lib/image-cache'
import { splitForLine } from '@/lib/text-splitter'

/**
 * 5-message LINE batch limit + 1.5s sleep between batches (requirements
 * §3.2.5). Tuneable via env for tests / local runs.
 */
const LINE_BATCH_SIZE = 5
const LINE_BATCH_SLEEP_MS = Number(process.env.LINE_BROADCAST_BATCH_SLEEP_MS ?? 1500)

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'

const CORRECTION_PREFIX = '【訂正】'

/**
 * r-final-15 should_fix: 公開 URL は LINE からアクセス可能な HTTPS で
 * なければならない (本番必須)。env 未設定で固定ドメインへ静かに
 * フォールバックすると、ステージング/プレビュー環境で実際の origin と
 * 別ドメインの URL を LINE に渡してしまい原因追跡が難しい配信失敗に
 * なる。明示的に検証して、無効なら起動時 (or 配信開始時) にエラー。
 */
function resolveBaseUrl(override?: string): string {
  const candidate = override ?? process.env.PUBLIC_BASE_URL
  if (!candidate) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured. LINE broadcast requires an HTTPS origin reachable from LINE servers.',
    )
  }
  if (!/^https:\/\//i.test(candidate)) {
    throw new Error(
      `PUBLIC_BASE_URL must use https:// (got "${candidate}"). LINE rejects http and bare hosts for image/attachment URLs.`,
    )
  }
  return candidate.replace(/\/$/, '')
}

// LINE Image-message MIME constraints: jpeg only for the original/preview
// URLs. We render everything to jpeg so the content-type is consistent.
const RENDERED_IMAGE_CONTENT_TYPE = 'image/jpeg'

export interface BroadcastMailOptions {
  /**
   * Override the public origin used in attachment / image URLs (Excel
   * fallback links, rendered-image URLs). Defaults to `PUBLIC_BASE_URL`
   * env, then `https://new.hokudaicarta.com`.
   */
  baseUrl?: string
  /**
   * Inject a deterministic clock for tests. Affects nothing currently —
   * kept for future "sent_at" debugging — but conventional in the rest
   * of the broadcast helpers.
   */
  now?: Date
  /**
   * Logger compatible with mail-worker's `NotifyLogger`. No-op by default.
   */
  logger?: {
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
  }
}

const NOOP_LOGGER = { info: () => undefined, warn: () => undefined }

export interface BroadcastResult {
  status: 'sent' | 'partial' | 'failed' | 'skipped'
  reason?: string
  sentTextCount: number
  sentImageCount: number
  fallbackLinkCount: number
}

interface LineMessage {
  type: 'text' | 'image'
  text?: string
  originalContentUrl?: string
  previewImageUrl?: string
}

interface BroadcastBindingRow {
  id: number
  eventId: number
  lineChannelId: number
  status: string
  // Narrowed to string in loadActiveBinding — we skip rows without a group.
  lineGroupId: string
}

interface ChannelRow {
  id: number
  channelAccessToken: string
}

interface PushMessagesResult {
  /** Number of LINE messages that were successfully delivered. */
  deliveredCount: number
  /** Error from the first failed batch, or null when all batches succeeded. */
  error: Error | null
  /**
   * HTTP status from the first failed batch, when the failure came from
   * the LINE API itself. NULL when the failure was a transport-level
   * error (DNS / TLS / network), or when all batches succeeded.
   * Caller uses this to drive recovery: 401 → disable token, other 4xx
   * (groupId 不正 / Bot kick 済み) → revoke binding.
   */
  httpStatus: number | null
}

/**
 * Push messages to a LINE group in <=5-message batches with a sleep between
 * batches. Implemented over `fetch` so we don't drag the LINE SDK into the
 * apps/web bundle — the SDK adds no real value over a 30-line wrapper here.
 *
 * r3 review should_fix: 途中で失敗した場合に「どこまで送れたか」を返す。
 * 呼び出し側はその情報で event_broadcast_messages を `partial` に倒し、
 * 再送時の重複配信を防ぐ判断に使う。
 */
async function pushMessages(
  channelAccessToken: string,
  to: string,
  messages: LineMessage[],
  logger: NonNullable<BroadcastMailOptions['logger']>,
): Promise<PushMessagesResult> {
  if (process.env.LINE_NOTIFY_DRY_RUN === '1') {
    logger.info('LINE_NOTIFY_DRY_RUN=1; skipping push', {
      to,
      count: messages.length,
    })
    return { deliveredCount: messages.length, error: null, httpStatus: null }
  }

  let delivered = 0
  for (let i = 0; i < messages.length; i += LINE_BATCH_SIZE) {
    const batch = messages.slice(i, i + LINE_BATCH_SIZE)
    // r-final-6 should_fix: 429 (rate limit) は Retry-After を読んで
    // 限定回数だけ待ってからリトライ。それ以外の non-2xx は即座に失敗を返す。
    let attempt = 0
    const MAX_RATE_LIMIT_RETRIES = 3
    let batchSent = false
    let lastFailure: PushMessagesResult | null = null

    while (!batchSent) {
      try {
        const res = await fetch(LINE_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${channelAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ to, messages: batch }),
        })
        if (res.ok) {
          delivered += batch.length
          batchSent = true
          break
        }

        if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
          const retryAfterRaw = res.headers.get('retry-after')
          const retryAfterSec = Number(retryAfterRaw)
          // Retry-After が秒指定でない or 解釈不能なときは 5 秒固定。
          // 大きすぎる値 (>60s) も 60 秒で上限を切る。
          const waitMs =
            Number.isFinite(retryAfterSec) && retryAfterSec > 0
              ? Math.min(retryAfterSec, 60) * 1000
              : 5000
          logger.warn('LINE push 429, retrying after Retry-After', {
            attempt: attempt + 1,
            waitMs,
          })
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
          attempt++
          continue
        }

        const body = await res.text().catch(() => '')
        lastFailure = {
          deliveredCount: delivered,
          error: new Error(
            `LINE push failed: ${res.status} ${body.slice(0, 200)}`,
          ),
          httpStatus: res.status,
        }
        break
      } catch (err) {
        lastFailure = {
          deliveredCount: delivered,
          error: err instanceof Error ? err : new Error(String(err)),
          httpStatus: null,
        }
        break
      }
    }

    if (lastFailure) return lastFailure
    if (i + LINE_BATCH_SIZE < messages.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, LINE_BATCH_SLEEP_MS))
    }
  }
  return { deliveredCount: delivered, error: null, httpStatus: null }
}

function attachmentDownloadUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/api/line-broadcast/attachments/${token}`
}

function attachmentImageUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/api/line-broadcast/images/${token}`
}

/**
 * LINE image message size limits (公式仕様):
 *   - originalContentUrl: JPEG, max 10 MB, max 4096x4096
 *   - previewImageUrl:    JPEG, max 1 MB,  max 240x240
 *
 * r-final-15 should_fix: 150 DPI で生成した本文画像をそのまま preview
 * にも使うと、要項画像が大判のとき 1 MB を超えて LINE 側で preview 取得
 * が失敗し、配信全体が partial / failed になる。preview は sharp で
 * 240x240 上限に縮小して別 token で配信し、original は 10 MB 超過時のみ
 * fallback link に倒す。
 */
const LINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const LINE_PREVIEW_MAX_DIMENSION = 240
const LINE_PREVIEW_JPEG_QUALITY = 70

async function buildRenderedImageMessages(
  pages: Buffer[],
  baseUrl: string,
  attachment: AttachmentRow,
  db: typeof appDb,
  logger: NonNullable<BroadcastMailOptions['logger']>,
): Promise<{ messages: LineMessage[]; oversizeFallback: LineMessage | null }> {
  const messages: LineMessage[] = []
  // Defer the sharp import to actual use — sharp is heavy (~30 MB native
  // module) and not all broadcast paths take attachments.
  const { default: sharp } = await import('sharp')

  for (const buffer of pages) {
    // Original 側のサイズ上限を超えるページは画像化を諦め、ページ単位で
    // fallback link 1 本に縮約する (LINE は 10 MB 超を 400 で返す)。
    if (buffer.byteLength > LINE_IMAGE_MAX_BYTES) {
      const fallback = await buildFallbackTextMessage(
        db,
        attachment,
        baseUrl,
        `📎 ${attachment.filename} (サイズ超過のため Web で閲覧)`,
      )
      logger.warn('attachment page exceeds LINE 10 MB limit; falling back to link', {
        attachmentId: attachment.id,
        filename: attachment.filename,
        byteLength: buffer.byteLength,
      })
      return { messages: [], oversizeFallback: fallback }
    }

    let previewBuffer: Buffer
    try {
      previewBuffer = await sharp(buffer)
        .resize({
          width: LINE_PREVIEW_MAX_DIMENSION,
          height: LINE_PREVIEW_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: LINE_PREVIEW_JPEG_QUALITY })
        .toBuffer()
    } catch (err) {
      // Preview 生成失敗時は original をそのまま preview にも使う
      // (LINE 側で 1 MB を超えると失敗する可能性は残るが、画像表示
      // 機能自体は維持できる)。
      logger.warn('preview resize failed; reusing original buffer', {
        attachmentId: attachment.id,
        message: err instanceof Error ? err.message : String(err),
      })
      previewBuffer = buffer
    }

    const originalToken = randomBytes(16).toString('base64url')
    const previewToken = randomBytes(16).toString('base64url')
    setCachedImage(originalToken, buffer, RENDERED_IMAGE_CONTENT_TYPE)
    setCachedImage(previewToken, previewBuffer, RENDERED_IMAGE_CONTENT_TYPE)
    messages.push({
      type: 'image',
      originalContentUrl: attachmentImageUrl(originalToken, baseUrl),
      previewImageUrl: attachmentImageUrl(previewToken, baseUrl),
    })
  }
  return { messages, oversizeFallback: null }
}

interface AttachmentRow {
  id: number
  filename: string
  contentType: string
  data: Buffer
}

/**
 * Convert one attachment into the LINE messages we'll send. Returns either
 * a list of `image` messages (PDF / DOCX successfully rendered) or a
 * `text` message linking to the signed-URL download (Excel, render failure,
 * 30+ page cap).
 *
 * The "fallback" boolean accompanying the message list lets the caller
 * track `fallback_link_count` on `event_broadcast_messages`.
 */
async function renderAttachment(
  db: typeof appDb,
  attachment: AttachmentRow,
  baseUrl: string,
  logger: NonNullable<BroadcastMailOptions['logger']>,
): Promise<{ messages: LineMessage[]; usedFallback: boolean }> {
  const mime = attachment.contentType.toLowerCase()
  // Excel-by-design: image rendering of a spreadsheet is unusable on a
  // phone (horizontal scrolling, tiny cells); always link.
  if (
    mime.includes('spreadsheet') ||
    mime === 'application/vnd.ms-excel' ||
    attachment.filename.toLowerCase().endsWith('.xlsx') ||
    attachment.filename.toLowerCase().endsWith('.xls')
  ) {
    return {
      messages: [await buildFallbackTextMessage(db, attachment, baseUrl)],
      usedFallback: true,
    }
  }

  let rendered: { pages: Buffer[]; truncated: boolean } | null = null
  try {
    if (mime === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
      rendered = await renderPdfToJpegs(attachment.data)
    } else if (
      mime.includes('officedocument.wordprocessingml.document') ||
      attachment.filename.toLowerCase().endsWith('.docx') ||
      mime === 'application/msword'
    ) {
      rendered = await renderDocxToJpegs(attachment.data)
    } else {
      // Unknown type — surface as a link rather than guess.
      return {
        messages: [await buildFallbackTextMessage(db, attachment, baseUrl)],
        usedFallback: true,
      }
    }
  } catch (err) {
    logger.warn('attachment render failed; falling back to link', {
      attachmentId: attachment.id,
      filename: attachment.filename,
      message: err instanceof Error ? err.message : String(err),
    })
    return { messages: [await buildFallbackTextMessage(db, attachment, baseUrl)], usedFallback: true }
  }

  if (rendered.pages.length === 0) {
    return { messages: [await buildFallbackTextMessage(db, attachment, baseUrl)], usedFallback: true }
  }

  const { messages: imageMessages, oversizeFallback } =
    await buildRenderedImageMessages(rendered.pages, baseUrl, attachment, db, logger)

  // r-final-15: LINE の 10 MB 上限を超えるページがあれば、その attachment
  // 全体を画像化諦めて fallback link 1 本に縮約する。
  if (oversizeFallback) {
    return { messages: [oversizeFallback], usedFallback: true }
  }

  if (rendered.truncated) {
    // Append a "see full file on web" link after the first N rendered pages.
    const link = await buildFallbackTextMessage(
      db,
      attachment,
      baseUrl,
      `📎 ${attachment.filename} は ${RENDER_PAGE_LIMIT} ページ以降を省略しました。Web で全体を見る`,
    )
    return { messages: [...imageMessages, link], usedFallback: true }
  }
  return { messages: imageMessages, usedFallback: false }
}

async function buildFallbackTextMessage(
  db: typeof appDb,
  attachment: AttachmentRow,
  baseUrl: string,
  prefixOverride?: string,
): Promise<LineMessage> {
  const { token } = await getOrCreateShareToken(db, attachment.id)
  const url = attachmentDownloadUrl(token, baseUrl)
  const prefix = prefixOverride ?? `📎 ${attachment.filename}`
  return {
    type: 'text',
    text: `${prefix}\n${url}`,
  }
}

/**
 * Find the active broadcast row for an event, joined with channel
 * access-token info. Returns null when there is no live binding (the
 * common case for events approved before the LINE group was set up).
 */
async function loadActiveBinding(
  db: typeof appDb,
  eventId: number,
): Promise<
  | (BroadcastBindingRow & { channel: ChannelRow })
  | null
> {
  const rows = await db
    .select({
      id: eventLineBroadcasts.id,
      eventId: eventLineBroadcasts.eventId,
      lineChannelId: eventLineBroadcasts.lineChannelId,
      status: eventLineBroadcasts.status,
      lineGroupId: eventLineBroadcasts.lineGroupId,
      channelId: lineChannels.id,
      channelAccessToken: lineChannels.channelAccessToken,
    })
    .from(eventLineBroadcasts)
    .innerJoin(
      lineChannels,
      eq(lineChannels.id, eventLineBroadcasts.lineChannelId),
    )
    .where(
      and(
        eq(eventLineBroadcasts.eventId, eventId),
        eq(eventLineBroadcasts.status, 'linked'),
      ),
    )
    .limit(1)
  const hit = rows[0]
  if (!hit) return null
  if (!hit.lineGroupId) return null
  return {
    id: hit.id,
    eventId: hit.eventId,
    lineChannelId: hit.lineChannelId,
    status: hit.status,
    lineGroupId: hit.lineGroupId,
    channel: { id: hit.channelId, channelAccessToken: hit.channelAccessToken },
  }
}

/**
 * Broadcast one mail (body + attachments) to the LINE group bound to an
 * event. Idempotent: re-running for the same (eventLineBroadcastId,
 * mailMessageId) updates the existing event_broadcast_messages row rather
 * than creating a duplicate, thanks to the UNIQUE constraint on the table.
 *
 * Side effects:
 *   - Inserts / upserts an event_broadcast_messages row with status
 *     transitioning pending → sending → sent | partial | failed.
 *   - For every PDF/DOCX page successfully rendered: stashes the bytes in
 *     the in-memory image cache so LINE's fetcher can pull them via
 *     /api/line-broadcast/images/[token].
 *   - For attachments served via signed URL: issues (or reuses) an
 *     attachment_share_tokens row valid for 60 days.
 *
 * Returns a structured result so the caller (approveDraft, manual rebroad-
 * cast) can decide whether to surface the outcome to the operator.
 */
export async function broadcastMailToEvent(
  db: typeof appDb,
  args: {
    eventId: number
    mailMessageId: number
    isCorrection: boolean
    /**
     * 強制再送フラグ。manualBroadcast (UI からの再配信操作) で true を
     * 渡すと、status='sent' な mail でも skip せず再送する。
     * approveDraft / linkDraftToEvent / 自動配信トリガーでは false の
     * ままで「成功済み mail を二重送信しない」既定挙動。
     */
    force?: boolean
  },
  options: BroadcastMailOptions = {},
): Promise<BroadcastResult> {
  // r-final-16 blocker: baseUrl は添付・画像 URL を作るときだけ必要。
  // 本文のみメール (添付なし) で PUBLIC_BASE_URL 未設定でも配信は成功
  // させる。lazy resolver にして添付処理が baseUrl を要求した時点で
  // 初めて検証エラーを投げる。
  let cachedBaseUrl: string | null = null
  const getBaseUrl = (): string => {
    if (cachedBaseUrl != null) return cachedBaseUrl
    cachedBaseUrl = resolveBaseUrl(options.baseUrl)
    return cachedBaseUrl
  }
  const logger = options.logger ?? NOOP_LOGGER

  const binding = await loadActiveBinding(db, args.eventId)
  if (!binding) {
    return {
      status: 'skipped',
      reason: 'no_active_binding',
      sentTextCount: 0,
      sentImageCount: 0,
      fallbackLinkCount: 0,
    }
  }

  const mail = await db.query.mailMessages.findFirst({
    where: eq(mailMessages.id, args.mailMessageId),
    columns: { id: true, subject: true, bodyText: true },
  })
  if (!mail) {
    return {
      status: 'failed',
      reason: 'mail_not_found',
      sentTextCount: 0,
      sentImageCount: 0,
      fallbackLinkCount: 0,
    }
  }

  const attachments = await db
    .select({
      id: mailAttachments.id,
      filename: mailAttachments.filename,
      contentType: mailAttachments.contentType,
      data: mailAttachments.data,
    })
    .from(mailAttachments)
    .where(eq(mailAttachments.mailMessageId, args.mailMessageId))

  // Upsert the audit row up front so a crash mid-delivery leaves a
  // diagnostic trail. UNIQUE (broadcast, mail) means we touch the same
  // row on every retry, never inserting duplicates.
  //
  // rr2 review should_fix: partial 行を再送するとき、前回成功した先頭分は
  // 重複配信される。再送前に既存 sentXxxCount を読んで、後段で送信時に
  // 先頭 N 件をスキップする。
  //
  // rr4 review should_fix への応答: 3 カラム (sentTextCount /
  // sentImageCount / fallbackLinkCount) は role 別の排他カウンタで、
  // 同じ LineMessage が 2 カラムに入ることはない (role アサインを参照)。
  // 従って合計はそのまま「配信済みメッセージ件数」と等しい。
  //   - sentTextCount: 本文 splitForLine の chunk (role='body_text')
  //   - sentImageCount: 添付画像 (role='attachment_image')
  //   - fallbackLinkCount: 添付の代替 text リンク (role='attachment_link')
  const existingAudit = await db
    .select({
      sentTextCount: eventBroadcastMessages.sentTextCount,
      sentImageCount: eventBroadcastMessages.sentImageCount,
      fallbackLinkCount: eventBroadcastMessages.fallbackLinkCount,
      status: eventBroadcastMessages.status,
      updatedAt: eventBroadcastMessages.updatedAt,
    })
    .from(eventBroadcastMessages)
    .where(
      and(
        eq(eventBroadcastMessages.eventLineBroadcastId, binding.id),
        eq(eventBroadcastMessages.mailMessageId, args.mailMessageId),
      ),
    )
    .limit(1)

  // r-final-1 should_fix: status='sent' な mail を自動配信ループで再度
  // 流すと、previouslyDelivered=0 として全件再送され重複配信になる。
  // 既定は早期 return で skipped を返し、UI からの再配信操作 (force=true)
  // でのみ再送を許可する (r-final-3 should_fix)。
  if (existingAudit[0]?.status === 'sent' && !args.force) {
    logger.info('mail already broadcast successfully; skipping re-send', {
      eventId: args.eventId,
      mailMessageId: args.mailMessageId,
    })
    return {
      status: 'skipped',
      reason: 'already_sent',
      sentTextCount: existingAudit[0].sentTextCount,
      sentImageCount: existingAudit[0].sentImageCount,
      fallbackLinkCount: existingAudit[0].fallbackLinkCount,
    }
  }

  // r-final-12 should_fix: 同じ broadcast/mail の同時実行を弾く。
  // r-final-14 should_fix: ただし stale な sending (プロセス中断で
  // terminal に遷移できなかった行) を永久ロックにしないため、最後の
  // 更新から 15 分以上経った行は reclaim 候補として扱う (skip しない)。
  // 最終的な原子性は下の upsert CAS で確保される。
  // 事前 SELECT は早期 return で「明らかに進行中」の場合だけ DB 更新を
  // 省くための軽量ガード。
  if (existingAudit[0]?.status === 'sending') {
    const STALE_AFTER_MS = 15 * 60 * 1000
    const updatedAtMs = existingAudit[0].updatedAt
      ? new Date(existingAudit[0].updatedAt).getTime()
      : 0
    const isStale = Date.now() - updatedAtMs > STALE_AFTER_MS
    if (!isStale) {
      logger.warn('mail broadcast already in progress; skipping duplicate run', {
        eventId: args.eventId,
        mailMessageId: args.mailMessageId,
      })
      return {
        status: 'skipped',
        reason: 'already_in_progress',
        sentTextCount: existingAudit[0].sentTextCount,
        sentImageCount: existingAudit[0].sentImageCount,
        fallbackLinkCount: existingAudit[0].fallbackLinkCount,
      }
    }
    logger.warn('stale sending detected, will reclaim via CAS', {
      eventId: args.eventId,
      mailMessageId: args.mailMessageId,
      lastUpdatedAt: existingAudit[0].updatedAt,
    })
  }

  // r-final-8 blocker: force 再送 (UI 経由の manualBroadcast) では
  // 「LINE 側で前回成功分が消えていた」等で全件再送したいケースがある。
  // previouslyDelivered=0 にして先頭 skip を無効化する。force でない
  // (自動配信ループ) のときだけ partial の既配信分を skip して重複を防ぐ。
  const previouslyDelivered =
    !args.force && existingAudit[0]?.status === 'partial'
      ? existingAudit[0].sentTextCount +
        existingAudit[0].sentImageCount +
        existingAudit[0].fallbackLinkCount
      : 0

  const inserted = await db
    .insert(eventBroadcastMessages)
    .values({
      eventLineBroadcastId: binding.id,
      mailMessageId: args.mailMessageId,
      status: 'sending',
      isCorrection: args.isCorrection,
    })
    .onConflictDoUpdate({
      target: [
        eventBroadcastMessages.eventLineBroadcastId,
        eventBroadcastMessages.mailMessageId,
      ],
      set: {
        status: 'sending',
        isCorrection: args.isCorrection,
        errorMessage: null,
        updatedAt: sql`now()`,
      },
      // r-final-13 blocker: CAS で「sending じゃない時だけ status を
      // sending に上書き」する。既に sending な行に対しては upsert が
      // 何もせず RETURNING が 0 件になるので、二重実行は send 開始でき
      // ない。force=true の連打や、複数管理者の同時操作でも push が
      // 1 回しか走らない原子性を確保する。
      //
      // r-final-14 should_fix: stale sending (プロセス再起動・デプロイ
      // 等で terminal 状態に遷移できなかった行) を 15 分経過したら
      // 自動 reclaim 可能にする。pdftoppm/libreoffice 込みでも 15 分
      // あれば終わるはずなので、それを過ぎたものは死んだセッションと
      // 見なして上書きを許可する。
      where: sql`${eventBroadcastMessages.status} <> 'sending' OR ${eventBroadcastMessages.updatedAt} < now() - INTERVAL '15 minutes'`,
    })
    .returning({ id: eventBroadcastMessages.id })

  if (!inserted[0]) {
    // CAS 失敗 = 別ワーカーが status='sending' を保持中。早期 return。
    // 既存 audit の counts はそのまま戻して呼び出し元に既配信状況を
    // 伝える (existingAudit を再利用)。
    logger.warn('failed to claim broadcast slot (already sending); skipping', {
      eventId: args.eventId,
      mailMessageId: args.mailMessageId,
    })
    return {
      status: 'skipped',
      reason: 'already_in_progress',
      sentTextCount: existingAudit[0]?.sentTextCount ?? 0,
      sentImageCount: existingAudit[0]?.sentImageCount ?? 0,
      fallbackLinkCount: existingAudit[0]?.fallbackLinkCount ?? 0,
    }
  }
  const broadcastMessageId = inserted[0].id

  try {
    // Build text messages: split the mail body at 5000-char boundaries.
    // For corrections, prefix the body with 「【訂正】「件名」\n」 BEFORE
    // splitting so each resulting chunk is guaranteed to fit under the
    // 5000-character LINE limit (rr2 review blocker: prefixing after split
    // can push the first chunk over the limit).
    const rawBody = mail.bodyText ?? '(本文なし)'
    const prefix = args.isCorrection
      ? `${CORRECTION_PREFIX}${mail.subject ? `「${mail.subject}」\n` : ''}`
      : ''
    const bodyText = prefix + rawBody
    const chunks = splitForLine(bodyText)
    const textMessages: LineMessage[] = chunks.map((chunk) => ({
      type: 'text',
      text: chunk,
    }))

    // rr1 review should_fix: 添付の出力は image / fallback link が交互に
    // 並ぶことがある (Excel リンクの後に PDF 画像、など)。実際の送信順を
    // そのまま追える metadata を message と並走させ、deliveredCount に
    // 対応する metadata だけを数えることで partial 行のカウントを正しく
    // 残す。
    type MessageRole = 'body_text' | 'attachment_image' | 'attachment_link'
    const messages: LineMessage[] = []
    const roles: MessageRole[] = []

    for (const m of textMessages) {
      messages.push(m)
      roles.push('body_text')
    }

    for (const attachment of attachments) {
      // r-final-16 blocker: 添付があるときだけ baseUrl が必要。lazy
      // resolver で初回呼出時に検証する (PUBLIC_BASE_URL が未設定なら
      // ここで例外 → 既存の catch (err) が failed audit に倒す)。
      const result = await renderAttachment(
        db,
        attachment,
        getBaseUrl(),
        logger,
      )
      for (const m of result.messages) {
        messages.push(m)
        roles.push(m.type === 'image' ? 'attachment_image' : 'attachment_link')
      }
    }

    if (messages.length === 0) {
      // Empty mail with no attachments — nothing to send but still mark
      // as sent so the audit row is in a terminal state.
      messages.push({ type: 'text', text: '(本文・添付ともになし)' })
      roles.push('body_text')
    }

    // rr2 review should_fix: partial 再送のとき、既配信 prefix をスキップ。
    // messages の構築順は決定的なので、前回の sentXxxCount 合計分を先頭
    // から落とせば「未送信分の続き」を送れる。
    //
    // r-final-10 should_fix: ただし添付レンダリングは外部プロセス依存で
    // 再試行時に結果が変わる (前回 PDF 5 枚 → 今回失敗で fallback link
    // 1 件等)。前回 audit の role 別 counts と今回 messages の role 別
    // counts を比較し、いずれかが「前回より減っている」なら配信計画が
    // 別物なので partial スキップを諦めて全件再送に切り替える。
    let effectivePreviouslyDelivered = previouslyDelivered
    if (previouslyDelivered > 0 && existingAudit[0]) {
      const currentTextCount = roles.filter((r) => r === 'body_text').length
      const currentImageCount = roles.filter(
        (r) => r === 'attachment_image',
      ).length
      const currentLinkCount = roles.filter(
        (r) => r === 'attachment_link',
      ).length
      const layoutShrunk =
        existingAudit[0].sentTextCount > currentTextCount ||
        existingAudit[0].sentImageCount > currentImageCount ||
        existingAudit[0].fallbackLinkCount > currentLinkCount
      if (layoutShrunk) {
        logger.warn('partial layout shrunk between sends; falling back to full re-send', {
          eventId: args.eventId,
          mailMessageId: args.mailMessageId,
          previousText: existingAudit[0].sentTextCount,
          currentText: currentTextCount,
          previousImage: existingAudit[0].sentImageCount,
          currentImage: currentImageCount,
          previousLink: existingAudit[0].fallbackLinkCount,
          currentLink: currentLinkCount,
        })
        effectivePreviouslyDelivered = 0
      }
    }
    const skipCount = Math.min(effectivePreviouslyDelivered, messages.length)
    const messagesToPush = messages.slice(skipCount)

    // r-final-7 should_fix: pushMessages の直前に binding を再取得し、
    // 最初に読んだ値と一致するか検証する。添付画像化が数十秒かかる
    // 前提なので、その間に管理者が連携解除・再紐付けを行うと、すでに
    // 失効した groupId / channelAccessToken へ送信してしまう。
    const currentBinding = await loadActiveBinding(db, args.eventId)
    const bindingChanged =
      !currentBinding ||
      currentBinding.id !== binding.id ||
      currentBinding.lineChannelId !== binding.lineChannelId ||
      currentBinding.lineGroupId !== binding.lineGroupId ||
      currentBinding.channel.channelAccessToken !==
        binding.channel.channelAccessToken

    if (bindingChanged) {
      logger.warn('binding changed during attachment processing; skipping push', {
        eventId: args.eventId,
        mailMessageId: args.mailMessageId,
        originalChannelId: binding.lineChannelId,
        currentChannelId: currentBinding?.lineChannelId ?? null,
      })
      // 取り消し: audit 行を skipped 相当 (revoked) にして失敗パスを残す。
      // 後段の通常 finalize ロジックを通さないため、ここで terminal 更新。
      await db
        .update(eventBroadcastMessages)
        .set({
          status: 'failed',
          errorMessage: 'binding_changed_during_processing',
          updatedAt: sql`now()`,
        })
        .where(eq(eventBroadcastMessages.id, broadcastMessageId))
      return {
        status: 'skipped',
        reason: 'binding_changed',
        sentTextCount: 0,
        sentImageCount: 0,
        fallbackLinkCount: 0,
      }
    }

    const pushResult = await pushMessages(
      binding.channel.channelAccessToken,
      binding.lineGroupId,
      messagesToPush,
      logger,
    )

    // r3 review should_fix: 部分配信を sent/failed と区別する。例えば
    // 7 件中 5 件成功・後半 2 件失敗のときは status='partial' にして
    // delivered counts を残し、再送ロジックが「全件再送」ではなく
    // 「未送信分のみ」を再送する判断材料を持てるようにする。
    // 再送ケースでは「今回送れた件数 + 前回送信済み件数」が累計の
    // delivered になる。
    const totalDelivered = skipCount + pushResult.deliveredCount
    const allFailed = totalDelivered === 0 && pushResult.error
    const someFailed =
      pushResult.error != null && totalDelivered > 0 && totalDelivered < messages.length
    const allSent =
      pushResult.error == null && totalDelivered === messages.length
    const finalStatus = allFailed
      ? 'failed'
      : allSent
        ? 'sent'
        : someFailed
          ? 'partial'
          : // 想定外の組み合わせ (skipCount = total かつ messagesToPush 空) は
            // 既配信扱いで sent にする
            'sent'

    // 実際の送信順 (`roles`) に沿って累計 deliveredCount 件を数える。
    // image / fallback link が交互に並んでも正しいカウント (rr1 review)。
    let deliveredText = 0
    let deliveredImage = 0
    let deliveredFallback = 0
    for (let i = 0; i < totalDelivered && i < roles.length; i++) {
      switch (roles[i]) {
        case 'body_text':
          deliveredText++
          break
        case 'attachment_image':
          deliveredImage++
          break
        case 'attachment_link':
          deliveredFallback++
          break
      }
    }

    await db
      .update(eventBroadcastMessages)
      .set({
        status: finalStatus,
        sentTextCount: deliveredText,
        sentImageCount: deliveredImage,
        fallbackLinkCount: deliveredFallback,
        // sentAt は 1 件でも届いたタイミングを示す監査値。再送で完走した
        // 場合も、新しい完走時刻に更新したいので totalDelivered で判定。
        sentAt: totalDelivered > 0 ? sql`now()` : null,
        errorMessage: pushResult.error ? pushResult.error.message : null,
        updatedAt: sql`now()`,
      })
      .where(eq(eventBroadcastMessages.id, broadcastMessageId))

    if (pushResult.error) {
      logger.warn('broadcastMailToEvent partial / failed', {
        eventId: args.eventId,
        mailMessageId: args.mailMessageId,
        delivered: pushResult.deliveredCount,
        total: messages.length,
        httpStatus: pushResult.httpStatus,
        error: pushResult.error.message,
      })

      // rr3 review should_fix: LINE API のエラー status に応じて
      // channel / broadcast 状態を遷移させ、運用復旧のフックを残す。
      // 要件 §3.2.9 の表に対応。
      if (pushResult.httpStatus === 401) {
        // Access token 期限切れ / 無効。Bot を disabled にしつつ、
        // r-final-2 should_fix: binding も revoked にして assignedEventId
        // を解放しないと、次の承認メールでも同じ disabled channel に
        // push し続け失敗ループになる。
        //
        // r-final-7 / r-final-16 blocker: revoke は「送信開始時に保持
        // していた binding (lineChannelId + lineGroupId)」が今も active
        // な場合だけ。送信中に管理者が連携解除・再紐付けを完了して新しい
        // binding になっていたら、stale cleanup で新 binding を壊さない。
        // UPDATE が 0 件なら何もしない (channel 解放も連動して skip)。
        await db.transaction(async (tx) => {
          const revoked = await tx
            .update(eventLineBroadcasts)
            .set({
              status: 'revoked',
              revokedAt: sql`now()`,
              revokeReason: 'channel_disabled',
              inviteCode: null,
              inviteCodeExpiresAt: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(eventLineBroadcasts.id, binding.id),
                eq(eventLineBroadcasts.status, 'linked'),
                eq(eventLineBroadcasts.lineChannelId, binding.lineChannelId),
                eq(eventLineBroadcasts.lineGroupId, binding.lineGroupId),
              ),
            )
            .returning({ id: eventLineBroadcasts.id })

          if (revoked.length === 0) {
            logger.warn('stale 401 cleanup skipped (binding changed)', {
              eventId: args.eventId,
              originalChannelId: binding.lineChannelId,
            })
            return
          }

          await tx
            .update(lineChannels)
            .set({
              status: 'disabled',
              assignedEventId: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(lineChannels.id, binding.lineChannelId),
                eq(lineChannels.assignedEventId, args.eventId),
              ),
            )
        })
        logger.warn('LINE channel disabled + binding revoked due to 401', {
          channelId: binding.lineChannelId,
          eventId: args.eventId,
        })
      } else if (
        pushResult.httpStatus != null &&
        pushResult.httpStatus >= 400 &&
        pushResult.httpStatus < 500 &&
        pushResult.httpStatus !== 429 // rate limit はリトライ可能なので残す
      ) {
        // groupId 不正 / Bot kick 済み 等。binding を revoke して channel を
        // プールに戻し、UI 側で再紐付けが必要なことを明示する。
        // r-final-7 / r-final-16 blocker: 送信開始時の lineChannelId /
        // lineGroupId が今も一致する場合だけ revoke。再紐付け済みの新
        // binding は壊さない。UPDATE が 0 件なら channel も触らない。
        await db.transaction(async (tx) => {
          const revoked = await tx
            .update(eventLineBroadcasts)
            .set({
              status: 'revoked',
              revokedAt: sql`now()`,
              revokeReason: 'line_api_4xx',
              inviteCode: null,
              inviteCodeExpiresAt: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(eventLineBroadcasts.id, binding.id),
                eq(eventLineBroadcasts.status, 'linked'),
                eq(eventLineBroadcasts.lineChannelId, binding.lineChannelId),
                eq(eventLineBroadcasts.lineGroupId, binding.lineGroupId),
              ),
            )
            .returning({ id: eventLineBroadcasts.id })

          if (revoked.length === 0) {
            logger.warn('stale 4xx cleanup skipped (binding changed)', {
              eventId: args.eventId,
              originalChannelId: binding.lineChannelId,
              httpStatus: pushResult.httpStatus,
            })
            return
          }

          await tx
            .update(lineChannels)
            .set({
              status: 'available',
              assignedEventId: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(lineChannels.id, binding.lineChannelId),
                eq(lineChannels.assignedEventId, args.eventId),
              ),
            )
        })
        logger.warn('LINE binding revoked due to 4xx (groupId invalid / Bot kicked)', {
          eventId: args.eventId,
          channelId: binding.lineChannelId,
          httpStatus: pushResult.httpStatus,
        })
      }
    }

    return {
      status: finalStatus,
      reason: pushResult.error?.message,
      sentTextCount: deliveredText,
      sentImageCount: deliveredImage,
      fallbackLinkCount: deliveredFallback,
    }
  } catch (err) {
    // 想定外の例外 (renderAttachment / DB エラー等)。pushMessages 自身は
    // throw しないので、ここに来るのは配信前後の周辺処理が落ちたケース。
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.warn('broadcastMailToEvent failed (unexpected)', {
      eventId: args.eventId,
      mailMessageId: args.mailMessageId,
      error: errorMessage,
    })
    await db
      .update(eventBroadcastMessages)
      .set({
        status: 'failed',
        errorMessage,
        updatedAt: sql`now()`,
      })
      .where(eq(eventBroadcastMessages.id, broadcastMessageId))
    return {
      status: 'failed',
      reason: errorMessage,
      sentTextCount: 0,
      sentImageCount: 0,
      fallbackLinkCount: 0,
    }
  }
}
