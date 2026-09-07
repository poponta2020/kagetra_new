import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'
import { users } from './auth'
import { travelDestinationSourceEnum } from './enums'

/**
 * entry_group_travel_settings: 申込グループ 1 行の遠征届設定（travel-report R4・R5・R7）。
 *
 * **行が無ければ既定値**（`required = true` ／ 経路入力 未開始 ／ 開催地 未設定）。
 * すべてのグループへ先回りで行を作らないのは、遠征届が「既定で必要」だからで、
 * 行の有無が意味を持たない設計にしてある（`entry_group_open_chats` と同じ規律）。
 *
 * ★1 グループ 1 行なので `entry_group_id` そのものを PK にする。
 * `entry_group_payment_notices` は identity id + UNIQUE だが、あちらは将来の履歴化を
 * 想定した形。こちらは履歴を持たない確定仕様（設定は「いまの値」しか意味がない）。
 */
export const entryGroupTravelSettings = pgTable('entry_group_travel_settings', {
  entryGroupId: integer('entry_group_id')
    .primaryKey()
    .references(() => entryGroups.id, { onDelete: 'cascade' }),
  /**
   * 遠征届が必要か（R4）。既定 true。提出権限者が「不要」に切り替えると
   * S7/S9 の導線・LINE 通知が止まる。入力済みの経路・作成物は消さない
   * （「必要」に戻すとそのまま復活する）。
   */
  required: boolean('required').notNull().default(true),
  /**
   * 提出権限者が「経路入力を開始」を押した日時。NULL でも「確定名簿あり」判定が
   * 成立していれば経路入力は開く（R5 は OR 条件）。この列は手動の開始だけを記録する。
   */
  routeInputStartedAt: timestamp('route_input_started_at', { mode: 'date', withTimezone: true }),
  destinationPrefecture: text('destination_prefecture'),
  destinationCity: text('destination_city'),
  /** 経路表記に使う短い地名（例「八戸」）。既定行の「札幌→{ここ}」に入る。 */
  destinationLabel: text('destination_label'),
  /**
   * 開催地の出所。`ai` のときだけ S5 に「AI推定」バッジを出す。提出権限者が
   * 修正すると `manual` になり、以後 AI 推定で上書きしない（R7）。
   */
  destinationSource: travelDestinationSourceEnum('destination_source'),
  /**
   * ★AI 推定を**試みた**日時（成否を問わない claim）。
   * これが無いと「まだ試していない」と「試したが失敗して空欄のまま」を区別できず、
   * 自動オープンのグループを開くたびに推定 API を呼び続けてしまう。
   * `UPDATE … SET destination_attempted_at = now() WHERE destination_attempted_at IS NULL`
   * を claim にして 1 回だけ走らせる。
   */
  destinationAttemptedAt: timestamp('destination_attempted_at', {
    mode: 'date',
    withTimezone: true,
  }),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  /** 最後に更新した人。会員削除で設定ごと消さないよう SET NULL。 */
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
})
