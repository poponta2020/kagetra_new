import { date, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { gradeEnum, openChatSourceEnum } from './enums'
import { entryGroups } from './entry-groups'
import { mailMessages } from './mail-messages'

/**
 * entry_group_open_chats: 大会当日用 LINE オープンチャットの招待 URL
 * （openchat-broadcast）。1 行 = オープンチャット 1 つ。
 *
 * 帰属は **申込グループ**。LINE 紐付け（`event_line_broadcasts.entry_group_id` が
 * UNIQUE）と同じ単位に揃えてあるので、グループ内のどの開催日の大会詳細を開いても
 * 同じ全行が見える（requirements §3.2.6。開催日での絞り込みは意図的にしない —
 * 「別の日のオプチャが見つからない」事故を防ぐ方を優先した）。
 *
 * 1 グループに複数行を持てる。実データの分かれ方は「級別」「開催日別」「部門別
 * （団体戦 / 1年 / 選抜の部）」の 3 種で、前 2 つを `grades` / `event_date` に
 * 構造化し、3 つ目は `label` で吸収する。
 */
export const entryGroupOpenChats = pgTable(
  'entry_group_open_chats',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // ★ON DELETE は **CASCADE**。オープンチャットは招待 URL への薄いポインタで
    // 版管理も統計寄与も持たず、グループが消えたら意味を失う。名簿ファイル採用
    // （RESTRICT）と違い、空グループ削除のバックストップにする価値が無い。
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    // `https://line.me/ti/g2/...` 直リンク、または短縮 URL（x.gd / ourl.jp /
    // lin.ee / bit.ly / tinyurl）。短縮 URL はサーバーで展開しない（外部 HTTP
    // 依存を持ち込まない。requirements §3.2.2）。
    url: text('url').notNull(),
    // 対象級。**NULL = 全級共通**。表現は `events.eligible_grades` /
    // `tournament_entry_roster_files.grades` と同じ（新表現を発明しない）。
    grades: gradeEnum('grades').array(),
    // 対象開催日。**NULL = 全日共通**。グループ内の開催日のみ許す（AC-27。
    // 判定は Server Action 側 — グループ内の日の集合は SQL 制約で書けない）。
    eventDate: date('event_date', { mode: 'string' }),
    // 表示ラベル。**NULL / 空なら級・開催日から自動生成**する（`label.ts`）。
    // 最終ラベル（＝自動生成後の値）はグループ内で一意でなければならないが、
    // 生成後の値なので **DB 制約にできない** — Server Action で判定する（AC-47）。
    label: text('label'),
    // 参加コード（合言葉）。現行コーパスに実例ゼロのため、推定できなくても正常。
    password: text('password'),
    source: openChatSourceEnum('source').notNull(),
    // 取込元メール（プロビナンス。会員向け表示には出さない）。
    sourceMailMessageId: integer('source_mail_message_id').references(() => mailMessages.id, {
      onDelete: 'set null',
    }),
    // ★Flex のボタン順・大会詳細の表示順の正（AC-52）。読み手は
    // `ORDER BY sort_order, id` で取り、取得順のまま消費する（ローカル再ソート禁止）。
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 同一グループ内で同じ URL を 2 行持てない（AC-25）。本文と添付の両方に
    // 同じ URL が出るのは普通なので、抽出側でも 1 候補にまとめる（AC-9）。
    unique('entry_group_open_chats_group_url_unique').on(t.entryGroupId, t.url),
    index('entry_group_open_chats_group_idx').on(t.entryGroupId),
  ],
)
