import { date, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { rosterTypeEnum } from './enums'
import { events } from './events'
import { mailAttachments } from './mail-attachments'

/**
 * tournament_entry_rosters: 大会の名簿ヘッダ（tournament-entry-rosters PR-3）。
 *
 * 1 大会(event) につき applicant(申込者名簿) 0..1 / confirmed(確定名簿) 0..1。主催者が出す
 * 名簿ファイル（メール添付 or 手動アップロード）を取り込んで保持する。**名簿は「外部事実」**で、
 * 出欠(event_attendances=意思) / events.entryStatus(会の操作) とは分離（判断3＝突合は表示のみ・
 * 自動更新しない）。対象は個人戦のみ（events.kind=individual）。
 */
export const tournamentEntryRosters = pgTable(
  'tournament_entry_rosters',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    rosterType: rosterTypeEnum('roster_type').notNull(),
    // 名簿の発行日（主催者発表日）。任意。
    publishedAt: date('published_at', { mode: 'string' }),
    // 取り込み元のメール添付（プロビナンス）。手動アップロードや添付削除時は null。
    sourceAttachmentId: integer('source_attachment_id').references(() => mailAttachments.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1 大会につき各 roster_type 0..1（再取込は置換）。
    unique('tournament_entry_rosters_event_id_roster_type_key').on(table.eventId, table.rosterType),
  ],
)
