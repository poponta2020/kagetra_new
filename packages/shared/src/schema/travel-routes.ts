import { date, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import { travelWayKindEnum } from './enums'
import type { TravelLeg } from '../types'

/**
 * travel_routes: 1 人 × 1 遠征単位の経路（travel-report R6）。
 *
 * **遠征単位**＝申込グループ内の非 cancelled な開催日を日付順に並べ、連続する日を
 * まとめたブロック。単位テーブルは持たず都度導出し、**ブロック初日**
 * （`unit_start_date`）をキーにする。開催日の増減でブロックが割れたら、古いキーの
 * 行は読まれなくなるだけ（再キー付けはしない）。新しいブロックは未入力・未通知
 * として扱われ、そろえば改めて通知が飛ぶ——これが望ましい挙動。
 *
 * 出場行（「大会出場」）は**保存しない**。その人の出欠「参加」の日から導出するので、
 * 出欠が変わっても経路が stale にならない。
 */
export const travelRoutes = pgTable(
  'travel_routes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    /** 遠征単位のキー＝連続開催日ブロックの初日（`YYYY-MM-DD`）。 */
    unitStartDate: date('unit_start_date', { mode: 'string' }).notNull(),
    /** 経路の持ち主（代理入力でも対象者本人の id が入る）。 */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 行き: sapporo=札幌から / hometown=帰省先から出場 / other=その他。 */
    departureKind: travelWayKindEnum('departure_kind').notNull(),
    /** 行きが `other` のときの地名。それ以外は NULL。 */
    departurePlace: text('departure_place'),
    /** 帰り: sapporo=札幌へ戻る / hometown=そのまま帰省 / other=その他。 */
    returnKind: travelWayKindEnum('return_kind').notNull(),
    /** 帰りが `other` のときの地名。それ以外は NULL。 */
    returnPlace: text('return_place'),
    /**
     * 移動行の並び（順序を保持）。`int[]` ではなく **jsonb** を使うのは
     * `entry_group_payment_notices.grade_counts` と同じ理由（raw SQL の配列
     * バインドの罠を持ち込まない）。入力検証は Server Action 境界の zod で行う
     * （日付は単位の前後 ±14 日以内・地名 1〜40 文字・行数上限 30）。
     * 移動 0 行でも「入力済み」として扱う（R5）。
     */
    legs: jsonb('legs').$type<TravelLeg[]>().notNull(),
    savedAt: timestamp('saved_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    /**
     * 実際に保存操作をした人（代理入力なら提出権限者）。`user_id` とは別物。
     * 会員削除で経路ごと消さないよう SET NULL。
     */
    savedByUserId: text('saved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [unique('travel_routes_unit_user_unique').on(t.entryGroupId, t.unitStartDate, t.userId)],
)
