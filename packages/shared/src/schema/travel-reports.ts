import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'

/**
 * PostgreSQL `bytea` ↔ Node `Buffer`。`mail-attachments.ts` / `entry-form-drafts.ts`
 * の同名 customType と同じ実装（Drizzle 0.45.x に組み込みの bytea ヘルパーが無い）。
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * travel_report_batches: 「遠征届を作成する」を1回押した記録（travel-report R9）。
 *
 * 1 回の作成で遠征単位（S6 で統合・分割した結果）ごとに docx が生成されるので、
 * batch 1 行 : documents N 行。**追記専用の履歴**で、作り直しても過去の版は残る。
 * LINE 通知は batch 単位で1回（N ファイルまとめて1通）。
 */
export const travelReportBatches = pgTable(
  'travel_report_batches',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    /** 作成した提出権限者。会員削除で履歴ごと消さないよう SET NULL。 */
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    /**
     * 作成通知を送れた日時。NULL = 未送信または失敗。
     * ★通知が失敗しても documents は保存済みのまま（R13・AC-28）。
     */
    notifiedAt: timestamp('notified_at', { mode: 'date', withTimezone: true }),
    /** 通知失敗の理由（S5 に表示する）。 */
    notifyError: text('notify_error'),
  },
  (t) => [index('travel_report_batches_group_idx').on(t.entryGroupId)],
)

/**
 * travel_report_documents: 生成した遠征届 1 ファイル = 1 行。
 *
 * 生成物はファイルシステムではなく **DB（bytea）** に置き、認可つき route
 * （`/api/admin/travel-reports/[id]`）からだけ配る。全員の電話番号が入るため
 * 公開 URL は作らない（requirements §6・AC-27）。
 */
export const travelReportDocuments = pgTable(
  'travel_report_documents',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    batchId: integer('batch_id')
      .notNull()
      .references(() => travelReportBatches.id, { onDelete: 'cascade' }),
    /**
     * このファイルに含めた開催日（events.id の配列）。★`int[]` ではなく **jsonb**
     * （`entry_group_payment_reports.event_ids` と同型。raw SQL の配列バインドを避ける）。
     */
    eventIds: jsonb('event_ids').$type<number[]>().notNull(),
    filename: text('filename').notNull(),
    docx: bytea('docx').notNull(),
    /**
     * 作成時に確定した届のヘッダ値のスナップショット（目的・場所・遠征先連絡者・
     * 留守連絡先・届の日付・承認日・期間・団体代表者・顧問教員）。docx を読み直さずに
     * 履歴を説明できるようにするための記録で、再生成には使わない。
     */
    header: jsonb('header').$type<Record<string, unknown>>().notNull(),
    /** このファイルの名簿人数（＝出場者数）。 */
    memberCount: integer('member_count').notNull(),
  },
  (t) => [index('travel_report_documents_batch_idx').on(t.batchId)],
)
