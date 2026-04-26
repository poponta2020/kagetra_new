import { z } from 'zod'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です (YYYY-MM-DD)')
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, '時刻形式が不正です (HH:mm)')
const optionalDateStr = z
  .union([dateStr, z.literal(''), z.null(), z.undefined()])
  .transform((v) => (v ? v : null))
const optionalTimeStr = z
  .union([timeStr, z.literal(''), z.null(), z.undefined()])
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

export const eventFormSchema = z.object({
  title: z.string().min(1, 'タイトルは必須').max(200, 'タイトルは200文字以内'),
  description: optionalStr,
  eventDate: dateStr,
  startTime: optionalTimeStr,
  endTime: optionalTimeStr,
  location: optionalStr,
  capacity: optionalPositiveInt,
  status: z.enum(['draft', 'published', 'cancelled', 'done']),
  formalName: optionalStr,
  official: z.boolean(),
  kind: z.enum(['individual', 'team']),
  entryDeadline: optionalDateStr,
  internalDeadline: optionalDateStr,
  eventGroupId: optionalPositiveInt,
  feeJpy: optionalPositiveInt,
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
  startTime: optionalTimeStr,
  endTime: optionalTimeStr,
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
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    location: formData.get('location'),
    capacity: formData.get('capacity'),
    status: formData.get('status') || 'draft',
    formalName: formData.get('formalName'),
    official: formData.get('official') === 'on',
    kind: formData.get('kind') || 'individual',
    entryDeadline: formData.get('entryDeadline'),
    internalDeadline: formData.get('internalDeadline'),
    eventGroupId: formData.get('eventGroupId'),
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

export function extractScheduleFormData(formData: FormData): Record<string, unknown> {
  return {
    date: formData.get('date'),
    name: formData.get('name'),
    kind: formData.get('kind') || 'other',
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
    location: formData.get('location'),
    description: formData.get('description'),
  }
}
