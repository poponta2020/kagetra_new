import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { lineChannels } from './line-channels'
import { users } from './auth'

/**
 * club_line_groups: 会 LINE グループ（登録会員全員が居るグループ）の設定。
 * 実質 1 行のシングルトンだが、`line_channel_id` の UNIQUE 以外に行数制約は
 * 置かない（設定画面が 1 行を load/save するだけで、増える経路が無い）。
 *
 * 2 系統の ID を持つのが要点:
 *   - `oam_chat_room_id` … LINE Official Account Manager 側のルーム ID（`C…`）。
 *     ワーカーが Playwright で開くチャットの識別子で、URL
 *     `https://chat.line.biz/<U…>/chat/<C…>` から取り出す。
 *   - `line_group_id` … Messaging API の webhook が送ってくるグループ ID（`C…`）。
 *     **OAM 側の値とは別物**で、メンション解決（表示名取得 API）に使う。
 *     Bot が招待された `join` イベントでしか取れないので NULL 可。未捕捉の間は
 *     リマインドが全員テキスト列挙になる（requirements R10・AC-16c）。
 *
 * `line_channel_id` は RESTRICT。設定が生きている Bot 行を消せてしまうと、
 * 送信タスクの宛先が黙って消える。プールへ戻す操作（S3）を先に通す。
 */
export const clubLineGroups = pgTable('club_line_groups', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  /** 転換した Bot（`line_channels.purpose='club_chat'`）。 */
  lineChannelId: integer('line_channel_id')
    .notNull()
    .unique()
    .references(() => lineChannels.id, { onDelete: 'restrict' }),
  /** OAM のアカウントパス（`U` + 32 hex）。URL から取り出す。 */
  oamAccountPath: text('oam_account_path').notNull(),
  /** OAM のチャットルーム ID（`C` + 32 hex）。URL から取り出す。 */
  oamChatRoomId: text('oam_chat_room_id').notNull(),
  /**
   * OAM の見出しと**完全一致**するグループ表示名。ワーカーがルームを開いた
   * あと見出しで照合するため、人数の括弧（例「(67)」）を含めない。
   */
  chatRoomName: text('chat_room_name').notNull(),
  /** webhook 側のグループ ID。`join` で捕捉するまで NULL。 */
  lineGroupId: text('line_group_id'),
  lineGroupCapturedAt: timestamp('line_group_captured_at', {
    mode: 'date',
    withTimezone: true,
  }),
  /** 最後に保存した管理者。会員削除で設定ごと消さないよう SET NULL。 */
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
})
