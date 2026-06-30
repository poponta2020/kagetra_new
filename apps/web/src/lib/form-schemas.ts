import { z } from 'zod'

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

export const scheduleFormSchema = z.object({
  date: dateStr,
  name: z.string().min(1, '名前は必須').max(100, '名前は100文字以内'),
  kind: z.enum(['practice', 'meeting', 'social', 'other']),
  location: optionalStr,
  description: optionalStr,
})

export type EventFormData = z.infer<typeof eventFormSchema>
export type ScheduleFormData = z.infer<typeof scheduleFormSchema>

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
    data: Record<string, unknown>
  }> = []

  for (const unitKey of unitKeys) {
    if (formData.get(`${unitKey}__register`) !== 'on') continue

    const p = (field: string) => formData.get(`${unitKey}__${field}`)
    const eligibleGrades = (['A', 'B', 'C', 'D', 'E'] as const).filter(
      (g) => formData.get(`${unitKey}__grade_${g}`) === 'on',
    )

    result.push({
      unitKey,
      eligibleGrades,
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

export function extractScheduleFormData(formData: FormData): Record<string, unknown> {
  return {
    date: formData.get('date'),
    name: formData.get('name'),
    kind: formData.get('kind') || 'other',
    location: formData.get('location'),
    description: formData.get('description'),
  }
}
