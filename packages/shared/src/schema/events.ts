import { integer, pgTable, text, timestamp, date, boolean } from 'drizzle-orm/pg-core'
import {
  eventStatusEnum,
  eventKindEnum,
  gradeEnum,
  eventEntryStatusEnum,
  eventPaymentTypeEnum,
  eventPaymentStatusEnum,
} from './enums'
import { users } from './auth'
import { eventGroups } from './event-groups'

export const events = pgTable('events', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  description: text('description'),
  eventDate: date('event_date', { mode: 'string' }).notNull(),
  location: text('location'),
  capacity: integer('capacity'),
  status: eventStatusEnum('status').notNull().default('draft'),
  createdBy: text('created_by').references(() => users.id),
  formalName: text('formal_name'),
  official: boolean('official').notNull().default(true),
  kind: eventKindEnum('kind').notNull().default('individual'),
  entryDeadline: date('entry_deadline', { mode: 'string' }),
  internalDeadline: date('internal_deadline', { mode: 'string' }),
  eventGroupId: integer('event_group_id').references(() => eventGroups.id, { onDelete: 'set null' }),
  eligibleGrades: gradeEnum('eligible_grades').array(),
  feeJpy: integer('fee_jpy'),
  paymentDeadline: date('payment_deadline', { mode: 'string' }),
  paymentInfo: text('payment_info'),
  paymentMethod: text('payment_method'),
  entryMethod: text('entry_method'),
  organizer: text('organizer'),
  capacityA: integer('capacity_a'),
  capacityB: integer('capacity_b'),
  capacityC: integer('capacity_c'),
  capacityD: integer('capacity_d'),
  capacityE: integer('capacity_e'),
  // event-lifecycle-notify: 会レベルの申込/支払い状態（会員ごとではなく「会が主催者に対して」行う 1 アクション）。
  // 状態変化の初回遷移を LINE 通知トリガーにする。詳細は docs/features/event-lifecycle-notify。
  entryStatus: eventEntryStatusEnum('entry_status').notNull().default('not_applied'),
  entryAppliedAt: timestamp('entry_applied_at', { mode: 'date', withTimezone: true }),
  // payment_type=NULL は「支払い通知なし」。advance=事前払い（締切までに振込）/ onsite=現地払い（当日各自）。
  paymentType: eventPaymentTypeEnum('payment_type'),
  // payment_status / payment_paid_at は payment_type='advance' のときのみ意味を持つ。
  paymentStatus: eventPaymentStatusEnum('payment_status').notNull().default('unpaid'),
  paymentPaidAt: timestamp('payment_paid_at', { mode: 'date', withTimezone: true }),
  // tournament-title-grade-split: AI メール取り込み由来イベントの元ドラフトへのリンク。
  // 1 ドラフト(=1 メール) : N イベント(開催日ごとに分割) を表現する実体側の参照。手動作成・
  // 旧移行イベントでは null。FK (→ tournament_drafts.id, ON DELETE SET NULL) は
  // events↔tournament_drafts の相互参照による TypeScript 型循環を避けるため、migration の
  // raw ALTER で張る (tournament_drafts.superseded_by_draft_id と同じ方針)。
  tournamentDraftId: integer('tournament_draft_id'),
  // 元ドラフト payload 内の該当イベント単位 (unit_key)。部分承認済み単位の突合に使う。
  tournamentDraftUnitKey: text('tournament_draft_unit_key'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
