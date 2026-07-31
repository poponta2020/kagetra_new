import { z } from 'zod'
import {
  normalizePaymentDeadline,
  PAYMENT_DEADLINE_KINDS,
} from '@/lib/events/payment-deadline'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です (YYYY-MM-DD)')
const optionalDateStr = z
  .union([dateStr, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v ? v : null))
const optionalStr = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v && v !== '' ? v : null))
const optionalPositiveInt = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v && v !== '' ? Number(v) : null))
  .refine((v) => v === null || (Number.isInteger(v) && v > 0), {
    message: '正の整数を指定してください',
  })
const optionalNonNegativeInt = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v && v !== '' ? Number(v) : null))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0), {
    message: '0以上の整数を指定してください',
  })

export const eventFormSchema = z.object({
  title: z.string().min(1, 'タイトルは必須').max(200, 'タイトルは200文字以内'),
  description: optionalStr,
  eventDate: dateStr,
  location: optionalStr,
  capacity: optionalPositiveInt,
  status: z.enum(['published', 'cancelled', 'done']),
  formalName: optionalStr,
  official: z.boolean(),
  kind: z.enum(['individual', 'team']),
  entryDeadline: optionalDateStr,
  internalDeadline: optionalDateStr,
  // entry-notify-lottery-treasurer: 抽選日（任意・NULL=抽選なし）。申込完了通知に差し込む。
  // 承認画面 (extractEventUnitsFormData) では受け取らない＝NULL のまま、編集画面で後入力。
  lotteryDate: optionalDateStr,
  feeJpy: optionalNonNegativeInt,
  paymentDeadline: optionalDateStr,
  // mail-ai-extract-refinements: 振込締切の状態。フォームから来なければ
  // `unspecified` 扱いにし、下の `.transform` で日付と必ず整合させる。
  paymentDeadlineKind: z
    .union([z.enum(PAYMENT_DEADLINE_KINDS), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v ? v : 'unspecified')),
  paymentInfo: optionalStr,
  paymentMethod: optionalStr,
  entryMethod: optionalStr,
  organizer: optionalStr,
  capacityA: optionalPositiveInt,
  capacityB: optionalPositiveInt,
  capacityC: optionalPositiveInt,
  capacityD: optionalPositiveInt,
  capacityE: optionalPositiveInt,
})
  // mail-ai-extract-refinements AC-43: 振込締切の「日付」と「状態」の整合は
  // **サーバー側で**取る。events には CHECK が張ってあるので、人が「後日連絡」の
  // まま日付を入れたフォームをそのまま INSERT すると 500 になる。作成・編集・
  // メール承認の3経路がすべてこの schema を通るため、ここに1箇所置けば全経路を
  // 覆える（伝播経路だけは entry-groups.ts 側で束ねている）。
  .transform((data) => ({
    ...data,
    ...normalizePaymentDeadline(data),
  }))

export type EventFormData = z.infer<typeof eventFormSchema>

export function extractEventFormData(formData: FormData): Record<string, unknown> {
  return {
    title: formData.get('title'),
    description: formData.get('description'),
    eventDate: formData.get('eventDate'),
    location: formData.get('location'),
    capacity: formData.get('capacity'),
    status: formData.get('status') || 'published',
    formalName: formData.get('formalName'),
    official: formData.get('official') === 'on',
    kind: formData.get('kind') || 'individual',
    entryDeadline: formData.get('entryDeadline'),
    internalDeadline: formData.get('internalDeadline'),
    lotteryDate: formData.get('lotteryDate'),
    feeJpy: formData.get('feeJpy'),
    paymentDeadline: formData.get('paymentDeadline'),
    paymentDeadlineKind: formData.get('paymentDeadlineKind'),
    paymentInfo: formData.get('paymentInfo'),
    paymentMethod: formData.get('paymentMethod'),
    entryMethod: formData.get('entryMethod'),
    organizer: formData.get('organizer'),
    capacityA: formData.get('capacityA'),
    capacityB: formData.get('capacityB'),
    capacityC: formData.get('capacityC'),
    capacityD: formData.get('capacityD'),
    capacityE: formData.get('capacityE'),
  }
}

/**
 * tournament-title-grade-split: parse a multi-unit approval form.
 *
 * The ApprovalForm renders one {@link EventForm} per AI-extracted event unit,
 * namespacing every field as `${unitKey}__<field>`. Each unit also emits a
 * hidden `unit_key` input (so the full set of keys is `formData.getAll('unit_key')`)
 * and a `${unitKey}__register` checkbox; only checked units are returned.
 *
 * For each registered unit the `data` map is built with the exact same key
 * shape as {@link extractEventFormData}, so callers can feed it straight into
 * `eventFormSchema.parse`. Grades are collected from `${unitKey}__grade_A..E`
 * (mirroring how events/new and the single-unit approveDraft collect them).
 */
export function extractEventUnitsFormData(
  formData: FormData,
): Array<{
  unitKey: string
  eligibleGrades: ('A' | 'B' | 'C' | 'D' | 'E')[]
  /**
   * entry-groups タスク7: `${unitKey}__group_key`。同じ値を持つ unit は承認時に
   * 同一の entry_group へ割り当てるという意味だけを持つ不透明なキー（値そのものに
   * 意味はない・呼び出し側は同値関係だけを見る）。フォームに無い/空文字は null
   * （承認フォームがユニット1件のみで UI を出さなかった場合 = シングルトン扱い）。
   */
  groupKey: string | null
  data: Record<string, unknown>
}> {
  // getAll → may contain duplicates if the same key somehow rendered twice;
  // de-dup so we never build two records for one unit (defensive — the form
  // emits one hidden input per unit).
  const unitKeys = Array.from(
    new Set(
      formData
        .getAll('unit_key')
        .filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  )

  const result: Array<{
    unitKey: string
    eligibleGrades: ('A' | 'B' | 'C' | 'D' | 'E')[]
    groupKey: string | null
    data: Record<string, unknown>
  }> = []

  for (const unitKey of unitKeys) {
    if (formData.get(`${unitKey}__register`) !== 'on') continue

    const p = (field: string) => formData.get(`${unitKey}__${field}`)
    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(
      (g) => formData.get(`${unitKey}__grade_${g}`) === 'on',
    )
    const groupKeyRaw = formData.get(`${unitKey}__group_key`)
    const groupKey = typeof groupKeyRaw === 'string' && groupKeyRaw !== '' ? groupKeyRaw : null

    result.push({
      unitKey,
      eligibleGrades,
      groupKey,
      data: {
        title: p('title'),
        description: p('description'),
        eventDate: p('eventDate'),
        location: p('location'),
        capacity: p('capacity'),
        status: p('status') || 'published',
        formalName: p('formalName'),
        official: p('official') === 'on',
        kind: p('kind') || 'individual',
        entryDeadline: p('entryDeadline'),
        internalDeadline: p('internalDeadline'),
        feeJpy: p('feeJpy'),
        paymentDeadline: p('paymentDeadline'),
        paymentDeadlineKind: p('paymentDeadlineKind'),
        paymentInfo: p('paymentInfo'),
        paymentMethod: p('paymentMethod'),
        entryMethod: p('entryMethod'),
        organizer: p('organizer'),
        capacityA: p('capacityA'),
        capacityB: p('capacityB'),
        capacityC: p('capacityC'),
        capacityD: p('capacityD'),
        capacityE: p('capacityE'),
      },
    })
  }

  return result
}
