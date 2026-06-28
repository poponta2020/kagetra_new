import {
  integer,
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  uniqueIndex,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  eventStatusEnum,
  eventKindEnum,
  gradeEnum,
  eventEntryStatusEnum,
  eventPaymentTypeEnum,
  eventPaymentStatusEnum,
} from './enums'
import { users } from './auth'
import { tournamentSeriesEditions } from './tournament-series-editions'

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
  // tournament-entry-rosters PR-1a: 開催（edition）へのハブ。複数日/級の events が同一
  // edition を指す（N:1）。flow①（案内承認）で設定する（PR-2）。ON DELETE SET NULL。
  // 旧 event_group_id（手動・任意ラベル）は PR-1b で撤去し、束ねは edition に一本化。
  editionId: integer('edition_id'),
  eligibleGrades: gradeEnum('eligible_grades').array(),
  feeJpy: integer('fee_jpy'),
  paymentDeadline: date('payment_deadline', { mode: 'string' }),
  // entry-notify-lottery-treasurer: 抽選日。NULL=抽選なし（先着・全員参加）。申込完了通知の
  // 参加者向け文面に「抽選日は M/D です」を差し込む。手動入力（AI 抽出は別 follow-up）。
  lotteryDate: date('lottery_date', { mode: 'string' }),
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
}, (table) => [
  // tournament-title-grade-split (review CRITICAL-4): a draft unit (unit_key)
  // materializes into exactly one events row. SELECT-then-INSERT in
  // approveDraftUnits is not concurrency-safe on its own (a double-submit or
  // two parallel approvals could both pass the existence check and insert two
  // rows for the same unit). This partial unique index makes the DB the final
  // arbiter; approveDraftUnits pairs it with onConflictDoNothing on the same
  // target. Partial (WHERE both columns NOT NULL) so manually-created / legacy
  // events with NULL draft links are unaffected.
  uniqueIndex('events_tournament_draft_unit_key_uniq')
    .on(table.tournamentDraftId, table.tournamentDraftUnitKey)
    .where(
      sql`${table.tournamentDraftId} IS NOT NULL AND ${table.tournamentDraftUnitKey} IS NOT NULL`,
    ),
  // tournament-entry-rosters PR-1a: events:edition は N:1。ON DELETE SET NULL で
  // edition 削除時に紐付けだけ外す（events は残す）。名前は _fkey 規約に合わせる。
  foreignKey({
    columns: [table.editionId],
    foreignColumns: [tournamentSeriesEditions.id],
    name: 'events_edition_id_fkey',
  }).onDelete('set null'),
  // tournament-entry-rosters (Codex R3 should_fix): edition をハブに events を引く参照列に
  // btree index（FK 列に PG は自動 index を作らない）。
  index('events_edition_id_idx').on(table.editionId),
])
