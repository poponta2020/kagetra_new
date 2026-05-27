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

const ATTACHMENT_BASE_URL =
  process.env.PUBLIC_BASE_URL ?? 'https://new.hokudaicarta.com'

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
    return { deliveredCount: messages.length, error: null }
  }

  let delivered = 0
  for (let i = 0; i < messages.length; i += LINE_BATCH_SIZE) {
    const batch = messages.slice(i, i + LINE_BATCH_SIZE)
    try {
      const res = await fetch(LINE_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, messages: batch }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return {
          deliveredCount: delivered,
          error: new Error(
            `LINE push failed: ${res.status} ${body.slice(0, 200)}`,
          ),
        }
      }
      delivered += batch.length
    } catch (err) {
      return {
        deliveredCount: delivered,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
    if (i + LINE_BATCH_SIZE < messages.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, LINE_BATCH_SLEEP_MS))
    }
  }
  return { deliveredCount: delivered, error: null }
}

function attachmentDownloadUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/api/line-broadcast/attachments/${token}`
}

function attachmentImageUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/api/line-broadcast/images/${token}`
}

function buildRenderedImageMessages(
  pages: Buffer[],
  baseUrl: string,
): LineMessage[] {
  const messages: LineMessage[] = []
  for (const buffer of pages) {
    const token = randomBytes(16).toString('base64url')
    setCachedImage(token, buffer, RENDERED_IMAGE_CONTENT_TYPE)
    const url = attachmentImageUrl(token, baseUrl)
    messages.push({
      type: 'image',
      originalContentUrl: url,
      // Preview can be the same URL — LINE clients downscale on the device.
      previewImageUrl: url,
    })
  }
  return messages
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

  const imageMessages = buildRenderedImageMessages(rendered.pages, baseUrl)
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
  },
  options: BroadcastMailOptions = {},
): Promise<BroadcastResult> {
  const baseUrl = options.baseUrl ?? ATTACHMENT_BASE_URL
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
  const existingAudit = await db
    .select({
      sentTextCount: eventBroadcastMessages.sentTextCount,
      sentImageCount: eventBroadcastMessages.sentImageCount,
      fallbackLinkCount: eventBroadcastMessages.fallbackLinkCount,
      status: eventBroadcastMessages.status,
    })
    .from(eventBroadcastMessages)
    .where(
      and(
        eq(eventBroadcastMessages.eventLineBroadcastId, binding.id),
        eq(eventBroadcastMessages.mailMessageId, args.mailMessageId),
      ),
    )
    .limit(1)
  const previouslyDelivered =
    existingAudit[0]?.status === 'partial'
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
    })
    .returning({ id: eventBroadcastMessages.id })
  const broadcastMessageId = inserted[0]!.id

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
      const result = await renderAttachment(db, attachment, baseUrl, logger)
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
    const skipCount = Math.min(previouslyDelivered, messages.length)
    const messagesToPush = messages.slice(skipCount)

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
        error: pushResult.error.message,
      })
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
