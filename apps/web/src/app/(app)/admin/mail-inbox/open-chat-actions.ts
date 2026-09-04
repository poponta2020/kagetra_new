'use server'

import { asc, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  entryGroupOpenChatBroadcasts,
  entryGroupOpenChats,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db-errors'
import {
  isFlexPayloadWithinLimit,
  runOpenChatBroadcast,
  type OpenChatBroadcastOutcome,
} from '@/lib/open-chat/broadcast'
import { collectOpenChatCandidates } from '@/lib/open-chat/collect'
import {
  findDuplicateOpenChatLabelIds,
  resolveOpenChatLabel,
  type OpenChatGrade,
} from '@/lib/open-chat/label'
import { listOpenChatsForGroup, loadOpenChatGroupContext } from '@/lib/open-chat/queries'

/**
 * 大会オープンチャットの抽出・保存（openchat-broadcast）。
 *
 * 抽出のトリガーは**人間**（管理者がメールを大会に紐付ける既存操作の延長）。
 * 自動検知にしない理由は feasibility.md（本番286件の実測）を参照。
 *
 * ★2026-09-04 改修: **抽出シートは保存だけを行い、その場では配信しない。**
 * 配信はメール詳細の統合処理フォーム（`processMail`）の「LINE 配信」に相乗りし、
 * メール本文・添付と同じタイミングで送る。配信の実処理は `lib/open-chat/broadcast.ts`
 * に置き、この経路とグループページの再配信ボタンで共有する。
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
  | { ok: true; savedCount: number }
  | { ok: false; error: string; duplicateLabelIndexes?: number[] }

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

  const { eventDates } = await loadOpenChatGroupContext(args.entryGroupId)

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
 * 配信状況のサマリー（AC-35, AC-53）＋シート・配信チェックの初期状態。
 *
 * ★配信済み回数・前回配信時刻は **`status = 'sent'` の行だけ**から算出する。
 * 失敗（failed）や紐付け変更による中止（skipped）は「配信した」ではないので、
 * 数に入れると1度も届いていないのに「すでに1回配信しています」と出るうえ、
 * 未配達の行から「（今回追加）」の印まで消えてしまう。
 *
 * ★`lastAttempt` は **status を問わない直近の1件**。配信がメール実行側
 * （`processMail` の `after()`）へ移ったため、失敗しても呼び出し元へ結果を返せる
 * 相手がいない。ここで拾って画面に出さないと「保存は成功・配信は失敗として記録して
 * 再試行できる」という設計契約が、記録はされるが**どこにも出ない**状態になる。
 *
 * 返す行に `url` を含めるのは、シートが**保存済み URL を抽出候補から除く**ために
 * 必要なため（同じ URL を再 INSERT すると UNIQUE 違反で保存できない）。
 */
export async function loadOpenChatBroadcastSummary(entryGroupId: number) {
  await requireAdminSession()

  // ★配信履歴は**1クエリで全件読み**、件数・前回成功時刻・直近試行をそこから算出する
  // （Codex R3 blocker）。集計と直近1件を別クエリで引くと、その間に別リクエストの
  // 配信履歴 INSERT が挟まったとき「broadcastCount=0 なのに lastSentAt は配信済み」
  // という矛盾したサマリーを返し、UI が初回扱いで確認なしの全件再送に進んでしまう。
  // 1グループあたりの履歴は配信回数ぶん（実運用で数件）なので全件読みで足りる。
  const attempts = await db
    .select({
      id: entryGroupOpenChatBroadcasts.id,
      status: entryGroupOpenChatBroadcasts.status,
      errorMessage: entryGroupOpenChatBroadcasts.errorMessage,
      sentAt: entryGroupOpenChatBroadcasts.sentAt,
    })
    .from(entryGroupOpenChatBroadcasts)
    .where(eq(entryGroupOpenChatBroadcasts.entryGroupId, entryGroupId))
    .orderBy(desc(entryGroupOpenChatBroadcasts.sentAt), desc(entryGroupOpenChatBroadcasts.id))

  const sentAttempts = attempts.filter((a) => a.status === 'sent')
  const broadcastCount = sentAttempts.length
  const lastAttemptRow = attempts[0] ?? null

  const rows = await listOpenChatsForGroup(entryGroupId)

  // 「前回配信以降に増えた行」= created_at > 直近の sent_at（AC-53 の「（今回追加）」印）。
  // 初回配信では全行が「新規」だが、印を付けるのは2回目以降だけなので isNew は false。
  const lastSentAt = sentAttempts[0]?.sentAt ?? null
  return {
    broadcastCount,
    lastSentAt,
    lastAttempt: lastAttemptRow
      ? {
          status: lastAttemptRow.status,
          errorMessage: lastAttemptRow.errorMessage,
          at: lastAttemptRow.sentAt,
        }
      : null,
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
 * 候補を保存する（AC-25〜AC-29）。**配信はしない。**
 *
 * ★配信を伴わないので、保存の失敗＝この操作の失敗。以前はここで push まで行い
 * 「保存は成功・配信は失敗」を戻り値で伝えていたが、配信はメール実行側
 * （`processMail`）へ移した（2026-09-04 改修）。
 */
export async function saveOpenChats(
  rawInput: OpenChatSaveInput,
): Promise<OpenChatActionResult> {
  await requireAdminSession()

  const parsed = saveInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }
  const input = parsed.data

  if (input.rows.length === 0) {
    return { ok: false, error: '保存するオープンチャットがありません' }
  }

  const { eventDates, displayName, eventIds } = await loadOpenChatGroupContext(input.entryGroupId)
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

  revalidateOpenChatPaths(eventIds)
  return { ok: true, savedCount: input.rows.length }
}

/**
 * 保存済み全件を Flex 1通で配信する公開 Server Action（AC-30〜AC-34）。
 *
 * ★引数は **`entryGroupId` だけ**。送信者は認証セッションから、大会名は DB から
 * 必ず導出する。公開 Action は**呼び出し元の申告を信頼できない** — 監査行の
 * 送信者を別人に偽装できたうえ、存在しないユーザー ID を渡すと LINE への push が
 * 成功した**後**に履歴 INSERT だけが外部キー違反で落ち、配信が未記録になった。
 *
 * 通常運用の配信はメール詳細の統合処理フォーム（`processMail`）が起こす。この
 * Action は**申込グループページの再送ボタン専用**（`processMail` の配信が失敗した
 * とき、メール詳細の処理フォームは既に消えていて再試行できないため）。
 */
export async function broadcastOpenChats(
  entryGroupId: number,
): Promise<OpenChatBroadcastOutcome> {
  const session = await requireAdminSession()
  return runOpenChatBroadcast({ entryGroupId, sentByUserId: session.user.id })
}

/** グループ内の全大会詳細ページを再検証する（保存済み欄が即座に出るように）。 */
function revalidateOpenChatPaths(eventIds: readonly number[]): void {
  for (const id of eventIds) {
    revalidatePath(`/events/${id}`)
  }
  revalidatePath('/admin/mail-inbox')
}
