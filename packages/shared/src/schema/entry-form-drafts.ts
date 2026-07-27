import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import { entryFormDraftStatusEnum } from './enums'

/**
 * PostgreSQL `bytea` ↔ Node `Buffer`. Same rationale as mail-attachments.ts:
 * Drizzle 0.45.x has no built-in `bytea` helper and the `pg` driver already
 * exchanges Buffers in both directions.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * entry_form_drafts: 申込書下書きの作成履歴。1 作成 = 1 行。
 *
 * entry-form-autofill の「プレビュー確定 → Yahoo Draft へ IMAP APPEND」の
 * 成果物コピー。行は **IMAP APPEND の実行前に** `pending` で保存される
 * （requirements §3.2.7 — 失敗してもプレビューで編集した値と生成済み xlsx を
 * 失わない）。APPEND が成功したら `created`、失敗したら `imap_failed` +
 * `imap_error` に更新する。挿入から更新までの間にプロセスが落ちた行は
 * `pending` のまま残り、「成功したかどうか分からない」として扱える
 * （成功で保存すると、実際には下書きが無いのに成功の嘘が残る）。
 *
 * - entry_group_id CASCADE: グループ削除で履歴も消える（申込書はグループの
 *   派生物であり、独立に残す価値がない）
 * - created_by SET NULL: 作成者ユーザーが消えても履歴は残す
 * - xlsx bytea: 生成済み申込書のコピー（再ダウンロード用）。テンプレ xlsx は
 *   数百 KB オーダーで mail_attachments の 30MB 上限より十分小さい
 */
export const entryFormDrafts = pgTable(
  'entry_form_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    attachmentFilename: text('attachment_filename').notNull(),
    xlsx: bytea('xlsx').notNull(),
    memberCount: integer('member_count').notNull(),
    status: entryFormDraftStatusEnum('status').notNull().default('pending'),
    imapError: text('imap_error'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // S1 進行管理は「グループの最新行」を引き当てる（ORDER BY created_at DESC
    // LIMIT 1）。複合 index で index-only の逆順スキャンにする。
    index('entry_form_drafts_group_created_idx').on(t.entryGroupId, t.createdAt),
  ],
)
