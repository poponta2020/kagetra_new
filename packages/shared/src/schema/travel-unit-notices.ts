import { date, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { entryGroups } from './entry-groups'

/**
 * travel_unit_notices: 遠征単位ごとの「全員そろった」LINE 通知の記録
 * （travel-report R8）。キーは経路と同じく（グループ, ブロック初日）。
 *
 * 送信の流れは既存の claim → push → finalize と同型:
 * 1. `saveTravelRoute` の tx 内で `entry_groups` 行を `SELECT … FOR UPDATE`
 *    （設定行は無いことがありロックできないため、必ず存在するグループ行を掴む）
 * 2. 「保存前の未入力の対象者集合 == {保存者}」なら遷移とみなし `last_attempted_at` を書く
 * 3. **コミット後に** push する（tx 内で push しない）
 * 4. 成功で `all_entered_notified_at` を進め `last_error` を NULL へ戻す／失敗で `last_error`
 *
 * ★自己回復: `last_error IS NOT NULL` かつ保存後に全員入力済みなら、遷移でなくても
 * 再送する。再送ボタンは置かない（提出係が押しに行く画面ではないため）。
 *
 * ★「最後に通知した対象者集合」は持たない。対象者が増えて未完了に戻り、再びそろえば
 * 遷移判定が改めて成立するので、AC-18 の3条件（1回だけ・再保存で送らない・
 * 対象追加で再送）はこの2列だけで満たせる。
 */
export const travelUnitNotices = pgTable(
  'travel_unit_notices',
  {
    entryGroupId: integer('entry_group_id')
      .notNull()
      .references(() => entryGroups.id, { onDelete: 'cascade' }),
    /** 遠征単位のキー＝連続開催日ブロックの初日（`travel_routes.unit_start_date` と同じ）。 */
    unitStartDate: date('unit_start_date', { mode: 'string' }).notNull(),
    /** 送信を**試みた**日時（tx 内で書く claim。成否を問わない）。 */
    lastAttemptedAt: timestamp('last_attempted_at', { mode: 'date', withTimezone: true }),
    /** 最後に送信できた日時。NULL = 一度も送れていない。 */
    allEnteredNotifiedAt: timestamp('all_entered_notified_at', {
      mode: 'date',
      withTimezone: true,
    }),
    /** 直近の送信失敗の理由。★成功したら NULL へ戻す（画面に成功と失敗が同居しないように）。 */
    lastError: text('last_error'),
    /** 通知時点の対象者数（S5 の表示・監査用のスナップショット）。 */
    notifiedMemberCount: integer('notified_member_count'),
  },
  (t) => [primaryKey({ columns: [t.entryGroupId, t.unitStartDate] })],
)
