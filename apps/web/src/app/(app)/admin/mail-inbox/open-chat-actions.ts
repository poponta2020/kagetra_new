'use server'

import { and, asc, count, desc, eq, gt } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  entryGroupOpenChatBroadcasts,
  entryGroupOpenChats,
  events,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import { deriveEntryGroupName } from '@/lib/entry-groups'
import {
  applyPushFailureRecovery,
  assertBindingUnchangedByEntryGroup,
  loadActiveBindingByEntryGroup,
  pushMessages,
} from '@/lib/line-broadcast'
import { collectOpenChatCandidates } from '@/lib/open-chat/collect'
import { buildOpenChatFlexMessage } from '@/lib/open-chat/flex'
import {
  findDuplicateOpenChatLabelIds,
  resolveOpenChatLabel,
  type OpenChatGrade,
} from '@/lib/open-chat/label'

/**
 * 大会オープンチャットの抽出・保存・配信（openchat-broadcast）。
 *
 * 抽出のトリガーは**人間**（管理者がメールを大会に紐付ける既存操作の延長）。
 * 自動検知にしない理由は feasibility.md（本番286件の実測）を参照。
 *
 * ★配信の記録は `entry_group_open_chat_broadcasts` に持ち、
 * **`event_broadcast_messages` には一切書かない**（requirements §6 の契約）。
 * 同テーブルの UNIQUE(event_line_broadcast_id, mail_message_id) は「1メール=1配信」を
 * DB レベルで強制するため、「再配信は毎回全件を送る」と原理的に両立しない。
 */

/**
 * `actions.ts` の同名関数と同じガード。あちらは非 export のためここで再定義する
 * （このディレクトリの Server Action ファイルは各自でガードを持つ既存の流儀）。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

/**
 * 表示ラベルの上限。LINE Flex のボタン（action.label）には文字数上限があり、
 * 超えると push 全体が 400 で落ちる。保存時に弾いて「配信しようとして初めて
 * 全件失敗する」状態を作らない。
 */
const LABEL_MAX_LENGTH = 40

const gradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

/** 保存する1行の入力。UI（抽出候補シート）から受け取る形。 */
const openChatRowSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL を入力してください')
    // AC-26: LINE Flex の uri アクションは https 必須。
    .refine((v) => v.startsWith('https://'), 'URL は https:// で始まる必要があります'),
  grades: z.array(gradeSchema).nullable(),
  eventDate: z.string().nullable(),
  label: z.string().trim().max(LABEL_MAX_LENGTH, 'ラベルが長すぎます').nullable(),
  password: z.string().trim().nullable(),
  source: z.enum(['body', 'attachment_text', 'qr', 'manual']),
})

const saveInputSchema = z.object({
  entryGroupId: z.number().int().positive(),
  mailMessageId: z.number().int().positive().nullable(),
  rows: z.array(openChatRowSchema),
})

export type OpenChatSaveInput = z.infer<typeof saveInputSchema>

export type OpenChatActionResult =
  | { ok: true; savedCount: number; broadcast: OpenChatBroadcastOutcome }
  | { ok: false; error: string; duplicateLabelIndexes?: number[] }

export type OpenChatBroadcastOutcome =
  /** LINE 紐付けが無いので保存だけした（AC-37）。 */
  | { status: 'not_linked' }
  | { status: 'sent'; sentCount: number }
  | { status: 'failed'; error: string }
  /** 配信直前に紐付けが変わっていたので中止した（AC-39）。 */
  | { status: 'binding_changed' }

/** グループ内の開催日（YYYY-MM-DD 昇順）と導出表示名を引く。 */
async function loadGroupContext(entryGroupId: number) {
  const rows = await db
    .select({ id: events.id, title: events.title, eventDate: events.eventDate })
    .from(events)
    .where(eq(events.entryGroupId, entryGroupId))
    .orderBy(asc(events.eventDate), asc(events.id))

  const eventDates = [...new Set(rows.map((r) => r.eventDate))]
  const displayName =
    deriveEntryGroupName(rows.map((r) => r.title)) ?? rows[0]?.title ?? '大会'
  return { eventDates, displayName, eventIds: rows.map((r) => r.id) }
}

/**
 * メール本文＋添付から候補を集める（AC-6, AC-11〜AC-14, AC-20）。
 * 保存はしない — 候補を確認シートへ返すだけ。
 */
export async function extractOpenChatCandidatesFromMail(args: {
  mailMessageId: number
  entryGroupId: number
}) {
  await requireAdminSession()

  const [mail] = await db
    .select({ bodyText: mailMessages.bodyText, bodyHtml: mailMessages.bodyHtml })
    .from(mailMessages)
    .where(eq(mailMessages.id, args.mailMessageId))
    .limit(1)
  if (!mail) throw new Error('Mail not found')

  const attachments = await db
    .select({
      filename: mailAttachments.filename,
      contentType: mailAttachments.contentType,
      data: mailAttachments.data,
      extractedText: mailAttachments.extractedText,
    })
    .from(mailAttachments)
    .where(eq(mailAttachments.mailMessageId, args.mailMessageId))
    .orderBy(asc(mailAttachments.id))

  const { eventDates } = await loadGroupContext(args.entryGroupId)

  // 本文は text を優先し、無ければ html をそのまま渡す。URL の正規表現照合には
  // タグが混ざっていても支障がなく（`<https://...>` の二重表記も extract 側で
  // 同一視される）、HTML を落とす処理を足すと壊れた URL を作る危険の方が大きい。
  const bodyText = mail.bodyText ?? mail.bodyHtml ?? ''

  return collectOpenChatCandidates({
    bodyText,
    attachments,
    groupEventDates: eventDates,
  })
}

/** 保存済み行を表示順（Flex のボタン順と同一）で引く。★AC-52 の並び順の正。 */
export async function listOpenChatsForGroup(entryGroupId: number) {
  return db
    .select({
      id: entryGroupOpenChats.id,
      url: entryGroupOpenChats.url,
      grades: entryGroupOpenChats.grades,
      eventDate: entryGroupOpenChats.eventDate,
      label: entryGroupOpenChats.label,
      password: entryGroupOpenChats.password,
      source: entryGroupOpenChats.source,
      createdAt: entryGroupOpenChats.createdAt,
    })
    .from(entryGroupOpenChats)
    .where(eq(entryGroupOpenChats.entryGroupId, entryGroupId))
    .orderBy(asc(entryGroupOpenChats.sortOrder), asc(entryGroupOpenChats.id))
}

/** 再配信の確認ダイアログ用のサマリー（AC-35, AC-53）。 */
export async function loadOpenChatBroadcastSummary(entryGroupId: number) {
  await requireAdminSession()

  const [countRow] = await db
    .select({ value: count() })
    .from(entryGroupOpenChatBroadcasts)
    .where(eq(entryGroupOpenChatBroadcasts.entryGroupId, entryGroupId))
  const broadcastCount = countRow?.value ?? 0

  const [last] = await db
    .select({ sentAt: entryGroupOpenChatBroadcasts.sentAt })
    .from(entryGroupOpenChatBroadcasts)
    .where(eq(entryGroupOpenChatBroadcasts.entryGroupId, entryGroupId))
    .orderBy(desc(entryGroupOpenChatBroadcasts.sentAt))
    .limit(1)

  const rows = await listOpenChatsForGroup(entryGroupId)

  // 「前回配信以降に増えた行」= created_at > 直近の sent_at（AC-53 の「（今回追加）」印）。
  // 初回配信では全行が「新規」だが、印を付けるのは2回目以降だけなので isNew は false。
  const lastSentAt = last?.sentAt ?? null
  return {
    broadcastCount,
    lastSentAt,
    rows: rows.map((r) => ({
      id: r.id,
      label: resolveOpenChatLabel({
        grades: r.grades as OpenChatGrade[] | null,
        eventDate: r.eventDate,
        freeLabel: r.label,
      }).label,
      isNew: lastSentAt != null && r.createdAt > lastSentAt,
    })),
  }
}

/**
 * 候補を保存し、LINE グループへ Flex を1通配信する（AC-25〜AC-29, AC-35〜AC-41）。
 *
 * ★保存と配信は**別々に扱う**。配信の失敗（LINE API エラー等）は保存を
 * ロールバックしない（AC-38。design-spec「抽出のやり直しという徒労をさせない」）。
 */
export async function saveAndBroadcastOpenChats(
  rawInput: OpenChatSaveInput,
  options: { broadcast: boolean } = { broadcast: true },
): Promise<OpenChatActionResult> {
  const session = await requireAdminSession()

  const parsed = saveInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }
  const input = parsed.data

  if (input.rows.length === 0) {
    return { ok: false, error: '保存するオープンチャットがありません' }
  }

  const { eventDates, displayName, eventIds } = await loadGroupContext(input.entryGroupId)
  if (eventDates.length === 0) {
    return { ok: false, error: '対象の大会が見つかりません' }
  }

  // AC-27: グループ外の開催日は拒否する。グループ内の日の集合は SQL 制約で
  // 書けないため（events 側にあるため）ここで判定する。
  const outOfGroup = input.rows.findIndex(
    (r) => r.eventDate != null && !eventDates.includes(r.eventDate),
  )
  if (outOfGroup >= 0) {
    return { ok: false, error: 'この大会に無い開催日が指定されています' }
  }

  // AC-25: 同一 URL を2行に入れて保存させない。DB の UNIQUE でも弾けるが、
  // 「どの行が重複か」を返せないのでここでも見る。
  const urls = input.rows.map((r) => r.url)
  if (new Set(urls).size !== urls.length) {
    return { ok: false, error: '同じ URL が複数の行にあります' }
  }

  // AC-47〜AC-49: 最終ラベル（自動生成後の値）の重複は保存できない。
  // 同じ名前のボタンが並ぶ Flex を配信させないための唯一のゲート。
  const duplicateIndexes = [
    ...findDuplicateOpenChatLabelIds(
      input.rows.map((r, index) => ({
        id: index,
        grades: r.grades,
        eventDate: r.eventDate,
        freeLabel: r.label,
      })),
    ),
  ]
  if (duplicateIndexes.length > 0) {
    return {
      ok: false,
      error: '表示ラベルが重複しています。重複している行にラベルを入力してください',
      duplicateLabelIndexes: duplicateIndexes.sort((a, b) => a - b),
    }
  }

  // 保存。既存行との URL 重複（AC-25）は DB の UNIQUE(entry_group_id, url) が正で、
  // 違反は 23505 として拾ってユーザー向けメッセージに変える。
  // sort_order は既存の最大値の続きにして、追記が既存の並びを崩さないようにする
  // （AC-52: 大会詳細の並び順と Flex のボタン順が一致し続ける）。
  const existing = await listOpenChatsForGroup(input.entryGroupId)
  const baseSortOrder = existing.length

  try {
    await db.insert(entryGroupOpenChats).values(
      input.rows.map((r, index) => ({
        entryGroupId: input.entryGroupId,
        url: r.url,
        grades: r.grades,
        eventDate: r.eventDate,
        label: r.label,
        password: r.password,
        source: r.source,
        sourceMailMessageId: input.mailMessageId,
        sortOrder: baseSortOrder + index,
      })),
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'すでに登録されている URL があります' }
    }
    throw err
  }

  const savedCount = input.rows.length
  revalidateOpenChatPaths(eventIds)

  if (!options.broadcast) {
    return { ok: true, savedCount, broadcast: { status: 'not_linked' } }
  }

  const broadcast = await broadcastOpenChats({
    entryGroupId: input.entryGroupId,
    displayName,
    sentByUserId: session.user.id,
  })
  return { ok: true, savedCount, broadcast }
}

/**
 * 保存済み全件を Flex 1通で配信する（AC-30〜AC-34）。**毎回全件を送る**
 * （差分配信は「前に何が送られたか」を受け手が覚えている前提になるため）。
 *
 * 再配信でも `event_broadcast_messages` を触らないので、同一メールから
 * 2回配信しても DB 制約違反にならない（AC-40, AC-41）。
 */
export async function broadcastOpenChats(args: {
  entryGroupId: number
  displayName?: string
  sentByUserId?: string
}): Promise<OpenChatBroadcastOutcome> {
  const session = await requireAdminSession()
  const sentByUserId = args.sentByUserId ?? session.user.id

  const rows = await listOpenChatsForGroup(args.entryGroupId)
  if (rows.length === 0) return { status: 'failed', error: '配信するオープンチャットがありません' }

  const displayName =
    args.displayName ?? (await loadGroupContext(args.entryGroupId)).displayName

  const binding = await loadActiveBindingByEntryGroup(db, args.entryGroupId)
  // AC-37: LINE 未紐付けでは配信しない（保存は既に済んでいる）。履歴も残さない
  // ——「配信した」記録が無いのが正しく、N 回配信済みのカウントを汚さない。
  if (!binding) return { status: 'not_linked' }

  const message = buildOpenChatFlexMessage(
    rows.map((r) => ({
      url: r.url,
      label: resolveOpenChatLabel({
        grades: r.grades as OpenChatGrade[] | null,
        eventDate: r.eventDate,
        freeLabel: r.label,
      }).label,
      password: r.password,
    })),
    displayName,
  )

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

/** グループ内の全大会詳細ページを再検証する（保存済み欄が即座に出るように）。 */
function revalidateOpenChatPaths(eventIds: readonly number[]): void {
  for (const id of eventIds) {
    revalidatePath(`/events/${id}`)
  }
  revalidatePath('/admin/mail-inbox')
}

/**
 * 前回配信以降に追加された行があるかを判定するためのヘルパー
 * （UI が「（今回追加）」印を出すのに使う。AC-53）。
 */
export async function countOpenChatsAddedSinceLastBroadcast(
  entryGroupId: number,
): Promise<number> {
  const [last] = await db
    .select({ sentAt: entryGroupOpenChatBroadcasts.sentAt })
    .from(entryGroupOpenChatBroadcasts)
    .where(eq(entryGroupOpenChatBroadcasts.entryGroupId, entryGroupId))
    .orderBy(desc(entryGroupOpenChatBroadcasts.sentAt))
    .limit(1)
  if (!last) return 0

  const [row] = await db
    .select({ value: count() })
    .from(entryGroupOpenChats)
    .where(
      and(
        eq(entryGroupOpenChats.entryGroupId, entryGroupId),
        gt(entryGroupOpenChats.createdAt, last.sentAt),
      ),
    )
  return row?.value ?? 0
}
