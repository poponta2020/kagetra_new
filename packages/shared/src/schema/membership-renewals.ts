import { date, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { membershipRenewalStatusEnum } from './enums'
import { users } from './auth'

/**
 * membership_renewals: 年度確認 1 回分（annual-registration-renewal）。
 *
 * `fiscal_year` の UNIQUE が「同一年度を 2 回開始できない」を DB 層で保証する
 * （完了後のやり直しも Non-goal）。「同時に進行できるのは 1 つ」は値の組み合わせ
 * 制約（`status='open'` の行が高々 1 行）なので開始 Action の tx 内で確認する
 * —— 部分 UNIQUE を張ると「年度をまたいだ再開始」など将来の運用変更まで
 * DB で塞いでしまうため、ここは要件どおりアプリ側で拒否する（AC-3）。
 *
 * 締切（`deadline`）はリマインド日程の計算元。日程そのものは保存せず、開始日と
 * 締切から都度導出する（requirements R7・R8）。
 */
export const membershipRenewals = pgTable(
  'membership_renewals',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    /** 対象年度（例: 2026 年度＝2026）。 */
    fiscalYear: integer('fiscal_year').notNull(),
    /** 回答締切（JST の日付）。開始後も変更できる（R8）。 */
    deadline: date('deadline', { mode: 'string' }).notNull(),
    /** 案内文に添える管理者の一言（任意・200 字まで）。 */
    note: text('note'),
    status: membershipRenewalStatusEnum('status').notNull().default('open'),
    startedBy: text('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    completedBy: text('completed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('membership_renewals_fiscal_year_unique').on(t.fiscalYear)],
)
