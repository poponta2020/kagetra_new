import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import { travelSelectionStatusEnum } from './enums'

/**
 * entry_group_selection_statuses: 名簿確定時に管理者が入れる「確定状況」
 * （travel-report R3）。申込グループ × 人で 確定／キャンセル待ち／不参加 を持つ。
 *
 * ★**手入力だけを保存する。** 画面の初期表示に出る値（＝有効な確定状況）は
 * 「手入力 → 取込済み確定名簿の結果 → 確定」の順に導出した値で、導出結果を
 * ここへ書き込んではならない。書き込むと**次の名簿再取込（繰上げ反映）が
 * 手入力に隠れて効かなくなる**。「取込名簿の結果に戻す」は行の DELETE で実装する。
 * 導出の正典は `apps/web/src/lib/travel-report/selection-status.ts`。
 *
 * ★この値は今回**遠征届の対象者判定にだけ**使う。ホームの出場タイムライン・
 * 外部 API・参加費集計・振込連絡には配線しない（requirements §5 Non-goals）。
 * 「確定名簿あり」判定（申込管理ボードのフェーズ）も変えない。
 *
 * ON DELETE はグループ・ユーザーとも CASCADE。どちらが消えてもこの行は意味を失う。
 */
export const entryGroupSelectionStatuses = pgTable(
  'entry_group_selection_statuses',
  {
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: travelSelectionStatusEnum('status').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    /** 最後に更新した管理者。会員削除で記録ごと消さないよう SET NULL。 */
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.entryGroupId, t.userId] })],
)
