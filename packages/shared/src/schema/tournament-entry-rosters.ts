import { date, foreignKey, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { rosterTypeEnum } from './enums'
import { entryGroups } from './entry-groups'
import { mailAttachments } from './mail-attachments'
import { mailMessages } from './mail-messages'
import { users } from './auth'

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
    // entry-groups: 帰属を event → entry_group へ移した。名簿・抽選結果メールが
    // クラスタ単位（同じ案内メール × 同じ申込締切）で届く実態に合わせるため。
    // グループ内のどの日の詳細からも同一の名簿が見える。
    //
    // ★ON DELETE は **RESTRICT**（events からの cascade とは違う）。空グループの削除が
    // 名簿を道連れにしないため — `deleteGroupIfEmpty` が rosters 0件を確認してから
    // 消す設計で、RESTRICT はその DB 側バックストップ。
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'restrict' }),
    rosterType: rosterTypeEnum('roster_type').notNull(),
    version: integer('version').notNull().default(1),
    // 名簿の発行日（主催者発表日）。任意。
    publishedAt: date('published_at', { mode: 'string' }),
    // 取り込み元のメール添付（プロビナンス）。手動アップロードや添付削除時は null。
    sourceAttachmentId: integer('source_attachment_id').references(() => mailAttachments.id, {
      onDelete: 'set null',
    }),
    sourceMailMessageId: integer('source_mail_message_id'),
    // Self-FK is added by migration 0041 to avoid a TypeScript self-reference.
    supersedesRosterId: integer('supersedes_roster_id'),
    supersededAt: timestamp('superseded_at', { mode: 'date', withTimezone: true }),
    approvedAt: timestamp('approved_at', { mode: 'date', withTimezone: true }),
    approvedByUserId: text('approved_by_user_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // entry-groups: 版管理の一意性はグループ基準へ読み替えた
    // （§3.2.9「版管理の一意性は (グループ, roster_type, version)」）。
    unique('tournament_entry_rosters_entry_group_roster_type_version_key').on(
      table.entryGroupId,
      table.rosterType,
      table.version,
    ),
    foreignKey({
      columns: [table.sourceMailMessageId],
      foreignColumns: [mailMessages.id],
      name: 'ter_source_mail_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.approvedByUserId],
      foreignColumns: [users.id],
      name: 'ter_approved_by_fk',
    }).onDelete('set null'),
  ],
)
