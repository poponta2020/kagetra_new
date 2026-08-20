'use server'

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events } from '@kagetra/shared/schema'
import {
  normalizePaymentDeadline,
  PAYMENT_DEADLINE_KINDS,
  type PaymentDeadlineKind,
} from '@/lib/events/payment-deadline'
import { propagateFieldsToGroup, type PropagatableFields } from '@/lib/entry-groups'

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
