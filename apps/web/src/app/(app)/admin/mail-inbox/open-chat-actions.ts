'use server'

import { and, asc, count, desc, eq } from 'drizzle-orm'
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
import { listOpenChatsForGroup } from '@/lib/open-chat/queries'

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
 *
 * ★**LINE 側の正確な上限は未検証**（ドキュメント上 20 と 40 の記述が混在する）。
 * ここは**保守側の 20** に倒してある — 上限を大きく取って実際が 20 だった場合、
 * 25 文字のラベルが保存を通ったうえで**約50名への配信が丸ごと失敗する**のに対し、
 * 小さく取りすぎた場合の害は「長いラベルが保存できない」だけで、しかも自動生成
 * ラベル（`6/20(土) C級` ＝ 約10文字）はどれも余裕で収まる。
 * AC-46 の実機 push で長いラベルのケースも通して、実際の上限を確認すること。
 */
const LABEL_MAX_LENGTH = 20

/**
 * URL・パスワード・1グループの行数の上限。
 *
 * ★これが無いと2段階で壊れる:
 * 1. 極端に長い URL は `UNIQUE(entry_group_id, url)` の btree エントリ上限
 *    （約2704バイト）を超え、未処理の DB エラーになる
 * 2. ★より重い: DB を通る長さでも Flex のペイロード上限を超えると LINE が 400 を返し、
 *    `applyPushFailureRecovery` が「401 以外の 4xx ＝ groupId 不正 / Bot kick」と
 *    見なして**正常な LINE 紐付けを revoke する**。するとオープンチャットだけでなく
 *    以降の既存メール配信まで、再紐付けするまで止まる
 *
 * そこで「過大なペイロードをそもそも送らない」を保存時に担保する。
 * LINE 招待 URL は実測33文字トークンで 60 文字前後、短縮 URL はさらに短いので
 * 500 文字あれば実運用は通る。
 */
const URL_MAX_LENGTH = 500
const PASSWORD_MAX_LENGTH = 100
const ROWS_PER_GROUP_MAX = 30

/**
 * Flex メッセージ JSON のバイト長上限（LINE の上限 30KB に対する余裕込みの値）。
 *
 * ★固定の文字数・行数だけでは足りない。上限いっぱいの多バイト URL（1文字3バイト）を
 * 上限いっぱいの行数ぶん保存すると、個々の制限を全て通過したうえで合計が 30KB を
 * 超え得る。そうなると LINE が 400 を返し、`applyPushFailureRecovery` が
 * 「401 以外の 4xx ＝ groupId 不正」と見なして**正常な紐付けを revoke** し、
 * オープンチャットだけでなく以降のメール配信まで止まる。
 * そこで**実際に組み立てた Flex のバイト長**を保存前と配信前の両方で検証する。
 */
const FLEX_PAYLOAD_MAX_BYTES = 25_000

/** 保存済み/保存予定の行から Flex を組み立て、バイト長が上限内かを判定する。 */
function isFlexPayloadWithinLimit(
  rows: readonly { url: string; label: string; password: string | null }[],
  displayName: string,
): boolean {
  if (rows.length === 0) return true
  const message = buildOpenChatFlexMessage([...rows], displayName)
  return Buffer.byteLength(JSON.stringify(message), 'utf8') <= FLEX_PAYLOAD_MAX_BYTES
}

const gradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

/** 保存する1行の入力。UI（抽出候補シート）から受け取る形。 */
/**
 * AC-26: LINE Flex の uri アクションは https 必須。
 *
 * ★前方一致だけでは不十分。`https://` 単体や解析不能な文字列がすり抜け、
 * LINE API が Flex 全体を拒否して**全件配信が失敗する**。`URL` で構文解析し、
 * スキームが https でホストが空でないことまで確認する。
 *
 * ホストの allowlist（line.me ＋ 短縮 URL 5ドメイン）は**入れない**（ユーザー判断）。
 * 手入力欄は「URL がメールに存在しない大会」を救う唯一の入口なので、
 * 別の短縮サービスで届いたケースを弾く方が実害が大きい。
 */
function isValidHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.length > 0
  } catch {
    return false
  }
}

const openChatRowSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL を入力してください')
    .max(URL_MAX_LENGTH, 'URL が長すぎます')
    .refine(isValidHttpsUrl, 'URL は https:// で始まる有効な URL である必要があります'),
  grades: z.array(gradeSchema).nullable(),
  eventDate: z.string().nullable(),
  label: z.string().trim().max(LABEL_MAX_LENGTH, 'ラベルが長すぎます').nullable(),
  password: z.string().trim().max(PASSWORD_MAX_LENGTH, 'パスワードが長すぎます').nullable(),
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
 *
 * 返り値には**QR を走査したが読めなかった添付名**も含む（requirements §3.2.3）。
 * これを画面に出さないと「読めなかった」が「QR が無かった」と同じ見え方になり、
 * QR にしか URL が無い大会で管理者が取りこぼしに気づけない。
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

  // ★text と html の**両方**を抽出対象にする。`bodyText ?? bodyHtml` だと、
  // plain part に案内文だけがあり招待 URL は HTML の <a href> にしか無い
  // multipart メールで、plain が存在するというだけで HTML を丸ごと捨ててしまい
  // 候補ゼロになる。URL の正規表現照合はタグが混ざっていても支障がなく
  // （`<https://...>` の二重表記も extract 側で同一視される）、同一 URL は
  // マージで1候補にまとまるので両方渡して困らない。
  const bodyText = [mail.bodyText, mail.bodyHtml].filter(Boolean).join('\n')

  return collectOpenChatCandidates({
    bodyText,
    attachments,
    groupEventDates: eventDates,
  })
}

/**
 * 再配信の確認ダイアログ用のサマリー（AC-35, AC-53）＋シートの初期状態。
 *
 * ★配信済み回数・前回配信時刻は **`status = 'sent'` の行だけ**から算出する。
 * 失敗（failed）や紐付け変更による中止（skipped）は「配信した」ではないので、
 * 数に入れると1度も届いていないのに「すでに1回配信しています」と出るうえ、
 * 未配達の行から「（今回追加）」の印まで消えてしまう。
 *
 * 返す行に `url` を含めるのは、シートが**保存済み URL を抽出候補から除く**ために
 * 必要なため（同じ URL を再 INSERT すると UNIQUE 違反で配信まで到達しない）。
 */
export async function loadOpenChatBroadcastSummary(entryGroupId: number) {
  await requireAdminSession()

  const sentOnly = and(
    eq(entryGroupOpenChatBroadcasts.entryGroupId, entryGroupId),
    eq(entryGroupOpenChatBroadcasts.status, 'sent'),
  )

  const [countRow] = await db
    .select({ value: count() })
    .from(entryGroupOpenChatBroadcasts)
    .where(sentOnly)
  const broadcastCount = countRow?.value ?? 0

  const [last] = await db
    .select({ sentAt: entryGroupOpenChatBroadcasts.sentAt })
    .from(entryGroupOpenChatBroadcasts)
    .where(sentOnly)
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
      url: r.url,
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

  const existing = await listOpenChatsForGroup(input.entryGroupId)

  // 1グループの行数上限（既存＋今回）。Flex のボタンが青天井に増えて
  // ペイロード上限を超えると、上記のとおり LINE の 400 が紐付けの revoke まで
  // 波及するため、保存の時点で止める。
  if (existing.length + input.rows.length > ROWS_PER_GROUP_MAX) {
    return {
      ok: false,
      error: `1つの大会に登録できるオープンチャットは ${ROWS_PER_GROUP_MAX} 件までです`,
    }
  }

  // AC-47〜AC-49: 最終ラベル（自動生成後の値）の重複は保存できない。
  // 同じ名前のボタンが並ぶ Flex を配信させないための唯一のゲート。
  //
  // ★判定には**既にグループに保存されている行も含める**。入力行どうしだけを
  // 見ていると「既に C級 が保存済みのグループへ、別 URL で最終ラベルが C級 に
  // なる行を追加する」ケースが素通りし、requirements §3.2.1 の
  // 「同一グループ内で表示ラベルが重複してはならない」に違反した状態で配信される。
  // 既存行には負の id を振り、返すのは**入力行の index だけ**にする
  // （UI が行単位でエラーを出せるのは入力行だけなので）。
  //
  // ※同一グループへの2リクエストが同時に走った場合の取りこぼしは残る。
  //   行ロックは入れない（管理者は実質1名で同時保存の可能性が極めて低い、
  //   というユーザー判断）。
  const duplicateIds = findDuplicateOpenChatLabelIds([
    ...existing.map((r, i) => ({
      id: -(i + 1),
      grades: r.grades as OpenChatGrade[] | null,
      eventDate: r.eventDate,
      freeLabel: r.label,
    })),
    ...input.rows.map((r, index) => ({
      id: index,
      grades: r.grades,
      eventDate: r.eventDate,
      freeLabel: r.label,
    })),
  ])
  const duplicateIndexes = [...duplicateIds].filter((id) => id >= 0)
  if (duplicateIndexes.length > 0) {
    return {
      ok: false,
      error: '表示ラベルが重複しています。重複している行にラベルを入力してください',
      duplicateLabelIndexes: duplicateIndexes.sort((a, b) => a - b),
    }
  }

  // ★実際に組み立てた Flex のバイト長を保存前に検証する（上記の revoke 波及を防ぐ）。
  // 既存行＋今回行の全件で組む — 配信は毎回全件送るため、合計で判定しないと意味がない。
  const prospectiveRows = [
    ...existing.map((r) => ({
      url: r.url,
      label: resolveOpenChatLabel({
        grades: r.grades as OpenChatGrade[] | null,
        eventDate: r.eventDate,
        freeLabel: r.label,
      }).label,
      password: r.password,
    })),
    ...input.rows.map((r) => ({
      url: r.url,
      label: resolveOpenChatLabel({
        grades: r.grades,
        eventDate: r.eventDate,
        freeLabel: r.label,
      }).label,
      password: r.password,
    })),
  ]
  if (!isFlexPayloadWithinLimit(prospectiveRows, displayName)) {
    return {
      ok: false,
      error: '登録内容が多すぎて LINE で送れません。URL やパスワードを短くするか件数を減らしてください',
    }
  }

  // 保存。既存行との URL 重複（AC-25）は DB の UNIQUE(entry_group_id, url) が正で、
  // 違反は 23505 として拾ってユーザー向けメッセージに変える。
  // sort_order は既存の最大値の続きにして、追記が既存の並びを崩さないようにする
  // （AC-52: 大会詳細の並び順と Flex のボタン順が一致し続ける）。
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

  const broadcast = await runOpenChatBroadcast({
    entryGroupId: input.entryGroupId,
    displayName,
    sentByUserId: session.user.id,
  })
  return { ok: true, savedCount, broadcast }
}

/**
 * 保存済み全件を Flex 1通で配信する公開 Server Action（AC-30〜AC-34）。
 *
 * ★引数は **`entryGroupId` だけ**。送信者は認証セッションから、大会名は DB から
 * 必ず導出する。以前は `sentByUserId` / `displayName` を引数で受けていたが、
 * 公開 Action は**呼び出し元の申告を信頼できない** — 監査行の送信者を別人に
 * 偽装できたうえ、存在しないユーザー ID を渡すと LINE への push が成功した**後**に
 * 履歴 INSERT だけが外部キー違反で落ち、配信が未記録になった。
 */
export async function broadcastOpenChats(
  entryGroupId: number,
): Promise<OpenChatBroadcastOutcome> {
  const session = await requireAdminSession()
  return runOpenChatBroadcast({ entryGroupId, sentByUserId: session.user.id })
}

/**
 * 配信の実処理。**非 export の内部ヘルパー**（`'use server'` ファイルで export すると
 * それ自体が公開エンドポイントになり、引数を絞った意味が無くなる）。
 *
 * **毎回全件を送る**（差分配信は「前に何が送られたか」を受け手が覚えている前提に
 * なるため）。再配信でも `event_broadcast_messages` を触らないので、同一メールから
 * 2回配信しても DB 制約違反にならない（AC-40, AC-41）。
 */
async function runOpenChatBroadcast(args: {
  entryGroupId: number
  /** 保存経路から呼ぶときの再取得の節約用。未指定なら DB から導出する。 */
  displayName?: string
  /** 認証セッション由来の値だけを渡すこと（呼び出し元の申告を入れない）。 */
  sentByUserId: string
}): Promise<OpenChatBroadcastOutcome> {
  const sentByUserId = args.sentByUserId

  const rows = await listOpenChatsForGroup(args.entryGroupId)
  if (rows.length === 0) return { status: 'failed', error: '配信するオープンチャットがありません' }

  const displayName =
    args.displayName ?? (await loadGroupContext(args.entryGroupId)).displayName

  const binding = await loadActiveBindingByEntryGroup(db, args.entryGroupId)
  // AC-37: LINE 未紐付けでは配信しない（保存は既に済んでいる）。履歴も残さない
  // ——「配信した」記録が無いのが正しく、N 回配信済みのカウントを汚さない。
  if (!binding) return { status: 'not_linked' }

  const flexRows = rows.map((r) => ({
    url: r.url,
    label: resolveOpenChatLabel({
      grades: r.grades as OpenChatGrade[] | null,
      eventDate: r.eventDate,
      freeLabel: r.label,
    }).label,
    password: r.password,
  }))

  // ★push する直前にもペイロード長を検証する。ここが**実際の防波堤** — 保存時の
  // 検証をすり抜けた行（別経路で入った古いデータ等）でも、過大な Flex を LINE へ
  // 投げない。投げると 400 が返り、`applyPushFailureRecovery` が正常な紐付けを
  // revoke してしまい、以降のメール配信まで止まる。
  if (!isFlexPayloadWithinLimit(flexRows, displayName)) {
    await db.insert(entryGroupOpenChatBroadcasts).values({
      entryGroupId: args.entryGroupId,
      sentCount: 0,
      status: 'failed',
      errorMessage: 'flex_payload_too_large',
      sentByUserId,
    })
    return {
      status: 'failed',
      error: '登録内容が多すぎて LINE で送れません。件数を減らすか URL を短くしてください',
    }
  }

  const message = buildOpenChatFlexMessage(flexRows, displayName)

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
