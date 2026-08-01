import { date, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { gradeEnum, rosterTypeEnum } from './enums'
import { entryGroups } from './entry-groups'
import { mailAttachments } from './mail-attachments'
import { mailMessages } from './mail-messages'
import { users } from './auth'

/**
 * tournament_entry_roster_files: パースせず**原本ファイルのまま採用**した名簿
 * （roster-file-adoption）。
 *
 * 決定論パーサは主催者ごとに無限に多様な様式へ原理的に追随できず、本番の実名簿は
 * 全て採用不能だった。構造化取込（AI 抽出＋承認）は別機能で腰を据えて作るが、
 * それまでも／その後も「抽出できない原本」の受け皿として、申込フェーズを止めない
 * 恒久的な逃げ道をここに持つ。
 *
 * `tournament_entry_rosters` を拡張せず**独立したテーブル**にしてある。あちらへ
 * entries を持たない行を混ぜると、その表を読む既存の消費者（/dashboard の出場者
 * チップは「確定名簿があれば entries から描き、無ければ出欠へフォールバック」する）が
 * 「出場者0人」を表示してしまう。版管理・抽選事実・件数表示も同じく巻き込む。
 * ファイル採用は構造化データではなく**原本へのポインタ**で、版管理も統計寄与も持たない。
 *
 * ファイル実体は複製せず mail_attachments を唯一の正とする（ストレージ肥大対策の
 * 既存方針）。帰属は entry_group なので、グループ内のどの日の大会詳細からも同じ
 * ファイルが見える。
 */
export const tournamentEntryRosterFiles = pgTable(
  'tournament_entry_roster_files',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // ★ON DELETE は **RESTRICT**（tournament_entry_rosters と同じ）。空グループの
    // 削除が採用レコードを道連れにしないための DB 側バックストップ。
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'restrict' }),
    rosterType: rosterTypeEnum('roster_type').notNull(),
    // 取込単位。**NULL = グループ統一名簿**（グループの全級をカバーする 1 ファイル）で、
    // 非 NULL はその級だけをカバーする級別名簿（`['D']` / 複数級をまとめた `['A','B']`）。
    // 名簿は「同グループの全級が 1 Excel」で来るのが基本だが、級ごとに別ファイルで
    // 届く主催者もあるため、どちらの単位でも登録できるようにする。
    //
    // ★既存行（初版で採用済み）は NULL のまま「グループ統一」と解釈される
    // ＝ backfill 不要のスキーマ進化。junction 表にしないのは、読み手 3 箇所すべてに
    // JOIN + 集約が入り `deleteGroupIfEmpty` の依存表も増える一方で、級単位の UNIQUE や
    // SQL での級検索を要求する仕様が無いため（カバレッジ判定は TS 側・表示はラベル連結のみ）。
    // 複数級カバーは 1 行の配列で表現するので `UNIQUE(source_attachment_id)` は維持できる。
    // 保存時に dedupe + A→E 昇順で正規化する（`adoptRosterFile`）。
    grades: gradeEnum('grades').array(),
    // ★ON DELETE は **CASCADE**。mail_attachments は mail_messages から CASCADE
    // なので、ここを RESTRICT にすると将来メール削除機能を作ったとき FK 違反で
    // 落ちる。同じ「添付へのポインタ」である attachment_share_tokens /
    // event_broadcast_guideline_attachments も CASCADE で前例に揃う。ファイルが
    // 消えた採用レコードは意味を持たないので道連れが正しい。
    sourceAttachmentId: integer('source_attachment_id')
      .notNull()
      .references(() => mailAttachments.id, { onDelete: 'cascade' }),
    // 取込元メール（プロビナンス。内部情報なので会員向け payload には出さない）。
    sourceMailMessageId: integer('source_mail_message_id').references(() => mailMessages.id, {
      onDelete: 'set null',
    }),
    // 名簿の発行日（主催者発表日）。任意。既定はメール受信日を UI が入れる。
    publishedAt: date('published_at', { mode: 'string' }),
    note: text('note'),
    adoptedAt: timestamp('adopted_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    adoptedByUserId: text('adopted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 同一添付の二重採用を禁止する（要件 §3.2.1・AC-11）。付け替えは解除→再採用。
    unique('tournament_entry_roster_files_source_attachment_key').on(t.sourceAttachmentId),
    // ボードの hasConfirmedRoster 判定・大会詳細の引きが叩く複合キー。
    index('tournament_entry_roster_files_group_type_idx').on(t.entryGroupId, t.rosterType),
  ],
)
