'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  entryGroupPaymentNotices,
  entryGroupPaymentReceipts,
  entryGroupPaymentReports,
  events,
} from '@kagetra/shared/schema'
import {
  normalizePaymentDeadline,
  PAYMENT_DEADLINE_KINDS,
  type PaymentDeadlineKind,
} from '@/lib/events/payment-deadline'
import type { Grade } from '@kagetra/shared/types'
import { propagateFieldsToGroup, type PropagatableFields } from '@/lib/entry-groups'
import {
  finalizeLifecycleNotification,
  loadLinkedBindingForGroup,
  pushMessagesToEntryGroup,
} from '@/lib/event-lifecycle-notify'
import type { LineOutgoingMessage } from '@/lib/line-mention'
import {
  applyPaymentsPaidInTx,
  type PaymentsPaidFlipResult,
} from '@/lib/events/apply-payments-paid'
import { resolvePaymentReportAmount } from '@/lib/events/payment-report-amount'
import { buildPaymentReportMessage } from '@/lib/payment-report-message'
import {
  normalizeReceiptImage,
  type NormalizedReceiptImage,
} from '@/lib/payment-receipt/image'
import { resolveTreasurerMention } from '@/lib/line-mention-targets'
import {
  buildPaymentNoticeMessages,
  rowsFromSavedCounts,
  savedCountsFromRows,
} from '@/lib/payment-notice'
import { loadPaymentNoticeContext } from '@/lib/events/payment-notice-context'

/**
 * entry-group-page タスク2: `events/[id]/actions.ts` の同名ヘルパーは export
 * されていないため、このファイル内に同じ実装を置く（呼び出し元も文言も揃える）。
 */
async function requireAdminSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin' && session.user.role !== 'vice_admin') {
    throw new Error('Forbidden')
  }
  return session
}

// entry-group-page §3.2.6: 共通7項目（`PROPAGATABLE_FIELD_KEYS` と同一の集合）。
// Server Action は client から直接 JSON で呼べるため、TypeScript の型だけでは
// 実行時の不正値（改造された fetch 等）を防げない。zod で必ず再検証する
// （`form-schemas.ts` の `eventFormSchema` と同じ規約に倣うが、スキーマはこの
// 画面専用でローカルに置く）。
const optionalDateStr = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です (YYYY-MM-DD)'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((v) => (v ? v : null))
// テキスト3項目は既存 `optionalStr`（form-schemas.ts）と同じ挙動: 空文字は
// null へ正規化するが trim はしない。
const optionalStr = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v && v !== '' ? v : null))

const groupCommonFieldsSchema = z.object({
  entryDeadline: optionalDateStr,
  internalDeadline: optionalDateStr,
  lotteryDate: optionalDateStr,
  paymentDeadline: optionalDateStr,
  paymentDeadlineKind: z
    .union([z.enum(PAYMENT_DEADLINE_KINDS), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v ? v : 'unspecified')),
  paymentMethod: optionalStr,
  paymentInfo: optionalStr,
  entryMethod: optionalStr,
})

export interface GroupCommonFieldsInput {
  entryDeadline: string | null
  internalDeadline: string | null
  lotteryDate: string | null
  paymentDeadline: string | null
  paymentDeadlineKind: PaymentDeadlineKind
  paymentMethod: string | null
  paymentInfo: string | null
  entryMethod: string | null
}

/**
 * entry-group-page タスク2 (AC-19/AC-20): グループ共通7項目を、グループ内の
 * **全イベント（cancelled 含む）へ同一トランザクションで一括保存**する
 * （admin/vice_admin のみ）。要件 §3.2.6。
 *
 * 締切は日別の進行状態ではなく大会の属性なので、日ページの編集フォームの伝播
 * （`diffPropagatableFields` で「変わった値だけ」を選んだ日へ伝播する）とは
 * 目的が違う。ここは「グループ全日をこの入力値へ揃える」操作そのものなので、
 * `diffPropagatableFields` は使わず、7項目すべてを明示的に `changed` として渡す
 * （伝播元という概念も無いので `excludeEventId` も渡さない — entry-groups.ts の
 * 2-0 でこの引数を任意化済み）。
 */
export async function saveGroupCommonFields(
  groupId: number,
  input: GroupCommonFieldsInput,
): Promise<void> {
  await requireAdminSession()

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error('入力が不正です: グループ ID が不正です')
  }

  const parsed = groupCommonFieldsSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(`入力が不正です: ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const data = parsed.data

  // 支払締切: 日付と状態 (payment_deadline_kind) を必ず同じ UPDATE で揃える
  // （events の CHECK 制約。AC-20）。
  const { paymentDeadline, paymentDeadlineKind } = normalizePaymentDeadline(data)

  const changed: PropagatableFields = {
    entryDeadline: data.entryDeadline,
    internalDeadline: data.internalDeadline,
    lotteryDate: data.lotteryDate,
    paymentDeadline,
    paymentDeadlineKind,
    paymentMethod: data.paymentMethod,
    paymentInfo: data.paymentInfo,
    entryMethod: data.entryMethod,
  }

  // グループ内の全イベント id（cancelled も含む）を対象にする。イベント0件の
  // グループ（LINE 紐付け・名簿だけが残った空グループ）は何もせず return。
  const affectedEventIds = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.entryGroupId, groupId))
    if (rows.length === 0) return []

    // `propagateFieldsToGroup` が内部で `lockEventRowsAscending`（id 昇順ロック
    // でデッドロック回避）と `WHERE entry_group_id = groupId` の再検証を行う
    // ので、fail-closed はそのまま効く。7項目以外の列は SET しないので、
    // 日固有項目（title/eventDate/entryStatus/paymentStatus/capacity 等）は
    // 自然に不変。
    await propagateFieldsToGroup(tx, {
      groupId,
      targetEventIds: rows.map((r) => r.id),
      changed,
    })
    return rows.map((r) => r.id)
  })

  revalidatePath(`/admin/entries/${groupId}`)
  for (const id of affectedEventIds) revalidatePath(`/events/${id}`)
  revalidatePath('/events')
  revalidatePath('/admin/entries')
}

// ---------------------------------------------------------------------------
// line-bot-message-revamp: 名簿確定後の振込連絡（要件 §3.3）
// ---------------------------------------------------------------------------

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const satisfies readonly Grade[]

// 級 → 人数。client から直接呼べる Server Action なので、値は実行時に検証する。
// `z.record(z.enum(...), ...)` は全キーの存在を要求するので使わない（人数0の級は
// キーごと落ちてくる）。キーの絞り込みは下の `pickGradeCounts` が行う。
const paymentNoticeCountsSchema = z.record(z.string(), z.number().int().min(0).max(9999))

/** 級として妥当なキーだけを残す（未知のキーは黙って捨てる）。 */
function pickGradeCounts(raw: Record<string, number>): Partial<Record<Grade, number>> {
  const out: Partial<Record<Grade, number>> = {}
  for (const grade of GRADES) {
    const count = raw[grade]
    if (count != null) out[grade] = count
  }
  return out
}

export interface SendPaymentNoticeResult {
  ok?: true
  error?: string
}

/**
 * 振込連絡を送る（§3.3.4）。**手動のみ・再送できる**（要綱再送と同じ扱い）。
 *
 * 流れ:
 *   1. 級ごとの人数を受け取り（管理者が直した値）、単価は `resolveEntryFee` から
 *      **都度導出**する（単価は保存しないし、上書きもさせない・AC-13）
 *   2. 文面を組み立てる（`buildPaymentNoticeMessages`）。全級0名なら送らない（AC-18）
 *   3. 人数を upsert してから push し、**push が成功したときだけ** `last_sent_at` を
 *      進める（失敗時は送信済みにしない＝再送できる状態のまま残す・AC-19）
 *
 * 露出条件（settled ∧ 事前払い ∧ 未振込）は page.tsx が判定するが、Server Action は
 * client から直接叩けるのでここでも再判定する（fail-closed）。
 */
export async function sendPaymentNotice(
  groupId: number,
  counts: Record<string, number>,
): Promise<SendPaymentNoticeResult> {
  const session = await requireAdminSession()

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return { error: '入力が不正です' }
  }
  const parsedCounts = paymentNoticeCountsSchema.safeParse(counts)
  if (!parsedCounts.success) {
    return { error: '人数の入力が不正です' }
  }

  const context = await loadPaymentNoticeContext(groupId)
  if (!context) {
    return { error: '振込連絡の対象ではありません（名簿確定・事前払い・未振込のグループのみ）' }
  }
  if (!context.hasLineBinding) {
    return { error: 'LINE グループが紐付いていません' }
  }

  const rows = rowsFromSavedCounts(pickGradeCounts(parsedCounts.data), context.unitPriceByGrade)
  const mention = await resolveTreasurerMention(db)
  const notice = buildPaymentNoticeMessages({
    mention,
    rows,
    paymentDeadlineIso: context.paymentDeadline,
    paymentInfo: context.paymentInfo,
  })
  if (!notice) {
    return { error: '人数が全級0名です。1名以上にしてください' }
  }

  // 人数は push の前に保存する。送信が失敗しても、管理者が直した人数は残す
  // （やり直しのたびに数え直させない）。`last_sent_at` だけを成否で分ける。
  await db
    .insert(entryGroupPaymentNotices)
    .values({
      entryGroupId: groupId,
      gradeCounts: savedCountsFromRows(notice.rows),
      totalJpy: notice.totalJpy,
    })
    .onConflictDoUpdate({
      target: entryGroupPaymentNotices.entryGroupId,
      set: {
        gradeCounts: savedCountsFromRows(notice.rows),
        totalJpy: notice.totalJpy,
        updatedAt: new Date(),
      },
    })

  const result = await pushMessagesToEntryGroup(db, groupId, notice.messages)
  if (result.outcome !== 'sent') {
    revalidatePath(`/admin/entries/${groupId}`)
    return {
      error:
        result.outcome === 'skipped'
          ? 'LINE グループが紐付いていません'
          : `LINE 送信に失敗しました: ${result.reason ?? '不明なエラー'}`,
    }
  }

  await db
    .update(entryGroupPaymentNotices)
    .set({ lastSentAt: new Date(), lastSentBy: session.user.id, updatedAt: new Date() })
    .where(eq(entryGroupPaymentNotices.entryGroupId, groupId))

  revalidatePath(`/admin/entries/${groupId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// payment-receipt-broadcast: 支払報告（証憑つき）
// ---------------------------------------------------------------------------

/**
 * 1回の支払報告に添えられる証憑の上限（要件 §3.2.2-5）。
 * `'use server'` ファイルは async 関数以外を export できないため非 export にする
 * （このファイル内でしか参照しない。PaymentReportSheet.tsx は自前の定数を持つ）。
 */
const MAX_PAYMENT_RECEIPTS = 3
/**
 * base64 1枚あたりの受け入れ上限。クライアントは長辺 2048px から段階的に寸法と
 * quality を下げてこの内側へ収めてから送る（`PaymentReportSheet.downscaleToJpeg`）。
 * `serverActions.bodySizeLimit`（8mb）の内側で3枚ぶんが通る値。
 *
 * ★**超過は「報告全体を拒否」ではなく「その1枚だけ除外」にする。** 全体を弾くと、
 * 明細を高精細で撮っただけで支払報告そのものが `入力が不正です` で通らなくなる
 * （PDF・HEIC・サイズ超過の扱いを揃える・要件 §3.2.2-7）。
 */
const MAX_RECEIPT_BASE64_CHARS = 2 * 1024 * 1024
/**
 * リクエスト全体としての受け入れ上限（1枚あたり）。`bodySizeLimit` を超える入力は
 * そもそも Server Action へ届かないので、ここは「明らかに過大な値を decode 前に
 * 弾く」ためだけの粗いガード。個別の除外判定は上の `MAX_RECEIPT_BASE64_CHARS`。
 */
const HARD_RECEIPT_BASE64_CHARS = 8 * 1024 * 1024

const receiptInputSchema = z.object({
  filename: z.string().min(1).max(255),
  base64: z.string().min(1).max(HARD_RECEIPT_BASE64_CHARS),
})

const reportPaymentSchema = z.object({
  // ★件数の上限は設けない（`.min(1)` のみ維持。0件は意味を持たない）。
  //   グループの日数に DB 制約は無く、`GroupDayTable` は既定で中止でない全日を
  //   選択するため、根拠のある固定上限を置くと実在するグループが弾かれる
  //   （旧 `setPaymentsPaid` に上限は無かった）。
  eventIds: z.array(z.number().int().positive()).min(1),
  receipts: z.array(receiptInputSchema).max(MAX_PAYMENT_RECEIPTS),
})

/** 支払報告のクライアント入力（1枚ぶん）。 */
export interface PaymentReceiptInput {
  filename: string
  /** データ URL ではなく素の base64（`entry-form` の `fileToBase64` と同じ形）。 */
  base64: string
}

export interface ReportPaymentSuccess {
  ok: true
  reportId: number
  status: 'sent' | 'failed' | 'skipped_unlinked' | 'skipped_no_change'
  /** サイズ超過・対応外形式で送信から外した枚の理由（要件 §3.2.2-7）。 */
  excluded: string[]
  /** LINE 送信に失敗したときの理由（状態変更は巻き戻さない・§3.2.4-16）。 */
  sendError?: string
}

export type ReportPaymentResult = ReportPaymentSuccess | { error: string }

/**
 * `PUBLIC_BASE_URL` を https 絶対 URL として解決する。LINE の画像フェッチャは
 * 裸のホスト・http を取りに来られないので、形式まで検証する
 * （`line-broadcast.ts` / `entry-overdue-alert.ts` の `resolveBaseUrl` と同方針。
 * 重依存を持ち込まないため import せず同じ規則を明示する）。
 */
function resolveBaseUrl(): string {
  const candidate = process.env.PUBLIC_BASE_URL
  if (!candidate) {
    throw new Error(
      'PUBLIC_BASE_URL is not configured. 支払報告の証憑画像には LINE から到達できる絶対 URL が必要。',
    )
  }
  if (!/^https:\/\//i.test(candidate)) {
    throw new Error(
      `PUBLIC_BASE_URL must use https:// (got "${candidate}"). LINE は http や裸のホストの画像を取得しない。`,
    )
  }
  return candidate.replace(/\/$/, '')
}

function receiptImageMessage(token: string, baseUrl: string): LineOutgoingMessage {
  const origin = `${baseUrl}/api/line-broadcast/payment-receipts/${token}`
  return { type: 'image', originalContentUrl: origin, previewImageUrl: `${origin}/preview` }
}

/**
 * payment-receipt-broadcast タスク6: 証憑つきの支払報告（admin/vice_admin のみ）。
 *
 * 1操作で「証憑の検証・保存 → 支払済化 → LINE 送信 → 記録の作成」までを行う。
 * 順序には意味がある:
 *
 * 1. **金額を先に確定する**（要件 §3.2.3-10 / AC-12）。`paid` へ倒してから集計すると、
 *    支払済を除外する集計へ差し替わった瞬間に金額が黙って減る
 * 2. 画像を正規化する。**クライアントの申告を信用しない** —— 枚数・形式・サイズは
 *    すべてサーバー側で再検証し、収まらない1枚だけを除外する（§3.2.6-21 / AC-4/5/7）
 * 3. 支払済へ倒して once-ever を claim する（`applyPaymentsPaid`）
 * 4. 記録（`entry_group_payment_reports` + 証憑）を **送信前に**保存する。画像 URL は
 *    保存したトークンから組むので、保存が先でないと送れない。`status` は
 *    「まだ送っていない」を意味するプレースホルダで入れ、送信結果で更新する
 *    （`claimLifecycleNotification` が `'skipped'` で claim するのと同じ流儀）
 * 5. 送る。**証憑が1枚以上あるときは claim できなくても送る**（要件 §3.2.4-14 /
 *    AC-13）——once-ever は「同じ完了通知を2度流さない」ための仕組みであって、
 *    証憑の配達を止めるためのものではない。証憑0枚のときは現行どおり claim できた
 *    集合だけに送る（AC-14）
 *
 * 送信の失敗は状態変更を巻き戻さない（既存の best-effort 規律・§3.2.4-16）。
 */
export async function reportPayment(
  groupId: number,
  eventIds: number[],
  receipts: PaymentReceiptInput[],
): Promise<ReportPaymentResult> {
  const session = await requireAdminSession()

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return { error: '入力が不正です' }
  }
  const parsed = reportPaymentSchema.safeParse({ eventIds, receipts })
  if (!parsed.success) {
    return {
      error:
        Array.isArray(receipts) && receipts.length > MAX_PAYMENT_RECEIPTS
          ? `証憑は${MAX_PAYMENT_RECEIPTS}枚までです`
          : '入力が不正です',
    }
  }

  const ids = Array.from(new Set(parsed.data.eventIds)).sort((a, b) => a - b)

  // ① 金額は状態を変える前に確定させる（AC-12）。
  const amount = await resolvePaymentReportAmount(db, groupId)

  // ② 画像の再正規化。対応外形式・サイズ超過はその枚だけ除外する（AC-4/5/7）。
  const normalized: { filename: string; image: NormalizedReceiptImage; token: string }[] = []
  const excluded: string[] = []
  for (const receipt of parsed.data.receipts) {
    if (receipt.base64.length > MAX_RECEIPT_BASE64_CHARS) {
      excluded.push(
        `${receipt.filename}: 画像が大きすぎて送信できません（縮小しても上限を超えます）。`,
      )
      continue
    }
    const buffer = Buffer.from(receipt.base64, 'base64')
    if (buffer.byteLength === 0) {
      excluded.push(`${receipt.filename}: 画像データを読み取れませんでした。`)
      continue
    }
    const result = await normalizeReceiptImage(buffer)
    if (!result.ok) {
      excluded.push(`${receipt.filename}: ${result.reason}`)
      continue
    }
    normalized.push({
      filename: receipt.filename,
      image: result.image,
      token: randomBytes(24).toString('base64url'),
    })
  }

  const baseUrl = normalized.length > 0 ? resolveBaseUrl() : null

  // 送信可否は**グループ単位の紐付けで1度だけ**判定する。送信経路
  // （`sendClaimedNotificationBulk` → `loadLinkedBinding`）が解決するのと同じ
  // 紐付けなので、ここでの判定と実際の送信先がズレない（AC-15）。
  const binding = await loadLinkedBindingForGroup(db, groupId)

  const messageText = buildPaymentReportMessage({
    amountJpy: amount.amountJpy,
    source: amount.source,
    unknownGradeCount: amount.unknownGradeCount,
    receiptCount: normalized.length,
  })

  // ③④ **支払済化・claim・記録の保存を1つのトランザクションにまとめる。**
  //     ここを分けると、支払済化と once-ever の消費だけがコミットされて記録の
  //     INSERT が落ちたときに、「支払済なのに履歴も証憑も再送導線も無い」手作業
  //     でしか戻せない状態が残る。LINE 送信だけをコミット後の best-effort にする。
  // ★送信を試みる場合のプレースホルダは `sending`。`failed` で入れていたため、
  //   初回送信中の行が履歴に「送信失敗」と表示され、それを見た別の管理者が再送を
  //   押して初回送信と競合できてしまっていた。
  const placeholderStatus = binding ? 'sending' : 'skipped_unlinked'
  // 中断（検証 NG・変更0件）と成功を1つの戻り値で表すため、コールバックの戻り型を
  // 明示する（`as const` の推論任せだと union がプロパティ単位に潰れる）。
  type SaveResult =
    | { error: string }
    | { reportId: number; flip: PaymentsPaidFlipResult }
  const saved: SaveResult = await db.transaction(async (tx): Promise<SaveResult> => {
    // **全 id をロックしたうえで所属グループを突き合わせる**（fail-closed）。
    // 先頭 id だけを見ると、後続に別グループの id が混ざった呼び出しで
    // 「自グループ側だけが支払済になり、記録の event_ids には他グループの id が
    // 残る」部分適用になる。1件でも他グループなら**1件も変更せずに**弾く。
    const locked = await tx
      .select({ id: events.id, entryGroupId: events.entryGroupId })
      .from(events)
      .where(inArray(events.id, ids))
      .orderBy(asc(events.id))
      .for('update')
    if (locked.length !== ids.length) {
      return { error: '対象の日が見つかりません' }
    }
    if (locked.some((row) => row.entryGroupId !== groupId)) {
      return { error: 'このグループの日ではありません' }
    }

    const flip = await applyPaymentsPaidInTx(tx, ids, groupId)
    // ★**実際に支払済へ変わった日が0件なら、保存も送信もしない。**
    //   claim ではなく flip を見るのが要点 —— 既に支払済の日へ再実行しただけの
    //   呼び出し（二度押し・古い画面・Action 直叩き）でも、証憑があるだけで
    //   `sendPaymentReport` は送ってしまうため、ここで止める。未払へ戻してから
    //   再報告するケース（AC-13）は flip が起きるので影響を受けない。
    if (flip.flippedIds.length === 0) {
      return {
        error: '支払済にできる日がありません（すでに支払済か、事前払いではありません）',
      }
    }

    const [report] = await tx
      .insert(entryGroupPaymentReports)
      .values({
        entryGroupId: groupId,
        eventIds: ids,
        amountJpy: amount.amountJpy,
        amountSource: amount.source,
        unknownGradeCount: amount.unknownGradeCount,
        messageText,
        receiptCount: normalized.length,
        status: placeholderStatus,
        createdBy: session.user.id,
      })
      .returning({ id: entryGroupPaymentReports.id })
    if (!report) throw new Error('支払報告の記録に失敗しました')
    if (normalized.length > 0) {
      await tx.insert(entryGroupPaymentReceipts).values(
        normalized.map((n, index) => ({
          reportId: report.id,
          sortOrder: index,
          filename: n.filename,
          contentType: n.image.contentType,
          data: n.image.data,
          byteSize: n.image.byteSize,
          width: n.image.width,
          height: n.image.height,
          previewData: n.image.previewData,
          token: n.token,
        })),
      )
    }
    return { reportId: report.id, flip }
  })
  if ('error' in saved) return { error: saved.error }
  const reportId = saved.reportId

  // ⑤ 送信。
  const result = await sendPaymentReport({
    entryGroupId: groupId,
    messageText,
    tokens: normalized.map((n) => n.token),
    baseUrl,
    hasBinding: binding != null,
    notifiableCount: saved.flip.notifiableIds.length,
    notificationIds: saved.flip.notificationIds,
  })

  await db
    .update(entryGroupPaymentReports)
    .set({
      status: result.status,
      errorMessage: result.error ?? null,
      lastSentAt: result.status === 'sent' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(entryGroupPaymentReports.id, reportId))

  revalidateAfterPaymentReport(groupId, ids)
  return {
    ok: true,
    reportId,
    status: result.status,
    excluded,
    ...(result.error ? { sendError: result.error } : {}),
  }
}

/** 支払報告のあとに捨てる経路（日ページ・グループページ・申込管理ボード）。 */
function revalidateAfterPaymentReport(groupId: number, eventIds: readonly number[]): void {
  for (const id of eventIds) revalidatePath(`/events/${id}`)
  revalidatePath(`/admin/entries/${groupId}`)
  revalidatePath('/admin/entries')
}

interface SendPaymentReportArgs {
  entryGroupId: number
  messageText: string
  tokens: readonly string[]
  baseUrl: string | null
  hasBinding: boolean
  /** flip できた日のうち `cancelled` でないものの件数（0 なら通知しない）。 */
  notifiableCount: number
  /** claim できた once-ever スロット（送信結果で finalize する）。 */
  notificationIds: readonly number[]
  /**
   * 証憑も claim も無くても送る（再送用）。初回送信では false のままにして、
   * 現行の once-ever 規律（claim できなかった日には送らない・AC-14）を維持する。
   */
  alwaysSend?: boolean
}

/**
 * 支払報告の LINE 送信。証憑の有無で経路が変わる:
 *
 * - **証憑0枚**: 現行の「支払済にする」と同一。claim できた集合だけに1通送る
 *   （既存の once-ever 規律をそのまま維持・AC-14）
 * - **証憑1枚以上**: claim できた日があればその claim を finalize しつつ
 *   `[text, image...]` を1回の push で送り、claim できる日が無ければグループの
 *   紐付けへ直接送る（AC-13）。どちらも宛先は同じグループの Bot
 */
async function sendPaymentReport(
  args: SendPaymentReportArgs,
): Promise<{ status: 'sent' | 'failed' | 'skipped_unlinked' | 'skipped_no_change'; error?: string }> {
  if (!args.hasBinding) return { status: 'skipped_unlinked' }

  const messages: LineOutgoingMessage[] = [{ type: 'text', text: args.messageText }]
  if (args.baseUrl != null) {
    for (const token of args.tokens) messages.push(receiptImageMessage(token, args.baseUrl))
  }

  const hasReceipts = args.tokens.length > 0
  const canClaim = args.notificationIds.length > 0

  if (!args.alwaysSend) {
    // `cancelled` の日しか動かなかった報告は送らない（要件 §3.2.2 #2）。証憑が
    // あっても迂回させない —— 中止になった大会のグループへ「振り込みが完了しました」
    // と明細が流れるのは事故。
    if (args.notifiableCount === 0) return { status: 'skipped_no_change' }
    // 証憑0枚 かつ claim できる日が無い = 現行どおり何も送らない（AC-14）。
    // ★`skipped_unlinked` ではない —— 紐付けはあるので「LINE 未連携」と記録すると嘘になる。
    if (!hasReceipts && !canClaim) return { status: 'skipped_no_change' }
  }

  try {
    // ★**宛先は必ず「保存済みの申込グループ」から引く。** 代表イベントの id を渡す
    //   経路（`sendClaimedNotificationBulk`）は、送信側が `events.entry_group_id` を
    //   **その時点で**引き直すため、保存から送信までの間にその日が別グループへ
    //   付け替えられると、証憑が別の大会の LINE グループへ流れる。送信可否の判定
    //   （`loadLinkedBindingForGroup`）と宛先の解決根拠をグループに一本化する。
    const result = await pushMessagesToEntryGroup(db, args.entryGroupId, messages)
    // claim 済みの once-ever ログは、この push の結果でまとめて finalize する
    // （`sendClaimedNotificationBulk` が内部でやっていたことを、宛先解決だけ
    //   差し替えて再現している）。
    await Promise.all(
      args.notificationIds.map((id) =>
        finalizeLifecycleNotification(db, id, {
          status: result.outcome,
          lineGroupId: result.lineGroupId ?? null,
          errorMessage: result.outcome === 'failed' ? (result.reason ?? null) : null,
        }),
      ),
    )
    if (result.outcome === 'sent') return { status: 'sent' }
    if (result.outcome === 'skipped') return { status: 'skipped_unlinked' }
    return { status: 'failed', error: result.reason ?? '不明なエラー' }
  } catch (e) {
    // best-effort: 送信の失敗で状態変更を巻き戻さない（§3.2.4-16）。
    return { status: 'failed', error: e instanceof Error ? e.message : '不明なエラー' }
  }
}

export interface ResendPaymentReportSuccess {
  ok: true
  status: 'sent' | 'failed' | 'skipped_unlinked' | 'skipped_no_change'
  sendError?: string
}

export type ResendPaymentReportResult = ResendPaymentReportSuccess | { error: string }

/**
 * payment-receipt-broadcast タスク7: 支払報告の再送（admin/vice_admin のみ）。
 *
 * **その回の送信を丸ごと送り直す**（要件 §3.2.5-18 / AC-18）。文面は保存済みの
 * `message_text` をそのまま使い、画像も保存済みのトークンをそのまま使う——
 * つまり**現在の集計値や規定単価が変わっていても、過去の報告の文面は揺れない**。
 * 金額を保存して都度組み直す方式にすると、再送するたびに「伝えた額」が変わって
 * 確認の基準が崩れる。
 *
 * once-ever の claim はしない。再送は「もう一度届ける」操作であって、新しい
 * 完了通知ではないため、グループの紐付けへ直接 push する。
 *
 * ★**送信権を条件付き UPDATE で1つだけ取る。** 履歴を同時に開いた2人が同じ報告を
 * 再送すると、排他が無ければ同じ文面と証憑が2回届く。`status='sending'` を掴めた
 * 実行だけが送る。プロセスが落ちて `sending` が残り続けても、
 * `SENDING_STALE_MS` を過ぎた行は再び掴めるので永久ロックにはならない。
 */
/** `sending` のまま放置された行を再び掴めるようになるまでの時間。 */
const SENDING_STALE_MS = 5 * 60 * 1000
export async function resendPaymentReport(
  reportId: number,
): Promise<ResendPaymentReportResult> {
  await requireAdminSession()

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return { error: '入力が不正です' }
  }

  // 取得と送信権の取得を1文で行う（select → update の間に別の再送が割り込む窓を
  // 作らない）。既に `sending` の行は掴めず、そのとき初めてエラーを返す。
  const staleBefore = new Date(Date.now() - SENDING_STALE_MS)
  const [report] = await db
    .update(entryGroupPaymentReports)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(
      and(
        eq(entryGroupPaymentReports.id, reportId),
        or(
          ne(entryGroupPaymentReports.status, 'sending'),
          lt(entryGroupPaymentReports.updatedAt, staleBefore),
        ),
      ),
    )
    .returning({
      id: entryGroupPaymentReports.id,
      entryGroupId: entryGroupPaymentReports.entryGroupId,
      messageText: entryGroupPaymentReports.messageText,
      eventIds: entryGroupPaymentReports.eventIds,
    })
  if (!report) {
    // 行が無いのか、他の実行が送信中なのかを区別して案内する。
    const [exists] = await db
      .select({ id: entryGroupPaymentReports.id })
      .from(entryGroupPaymentReports)
      .where(eq(entryGroupPaymentReports.id, reportId))
      .limit(1)
    return exists
      ? { error: 'この支払報告は送信中です。しばらく待ってからもう一度お試しください' }
      : { error: '支払報告が見つかりません' }
  }

  const receipts = await db
    .select({ token: entryGroupPaymentReceipts.token })
    .from(entryGroupPaymentReceipts)
    .where(eq(entryGroupPaymentReceipts.reportId, report.id))
    .orderBy(asc(entryGroupPaymentReceipts.sortOrder))

  const binding = await loadLinkedBindingForGroup(db, report.entryGroupId)
  const baseUrl = receipts.length > 0 ? resolveBaseUrl() : null

  const result = await sendPaymentReport({
    entryGroupId: report.entryGroupId,
    messageText: report.messageText,
    tokens: receipts.map((r) => r.token),
    baseUrl,
    hasBinding: binding != null,
    // 再送は claim を消費しない（グループの紐付けへ直接送る）。
    notifiableCount: 0,
    notificationIds: [],
    // 証憑0枚の報告でも再送では必ず送る（「もう一度届ける」が操作の目的なので、
    // 初回送信の once-ever ガードをここへ持ち込まない）。
    alwaysSend: true,
  })

  await db
    .update(entryGroupPaymentReports)
    .set({
      status: result.status,
      errorMessage: result.error ?? null,
      ...(result.status === 'sent' ? { lastSentAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(entryGroupPaymentReports.id, report.id))

  revalidateAfterPaymentReport(report.entryGroupId, report.eventIds)
  return { ok: true, status: result.status, ...(result.error ? { sendError: result.error } : {}) }
}
