import { integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { gradeEnum, lineGradeGroupStatusEnum } from './enums'
import { lineChannels } from './line-channels'

/**
 * line_grade_group_bindings: 級 (A〜E) = 1 LINE グループの**常設**紐付け。
 *
 * event-grade-group-broadcast の中核テーブル。既存 `event_line_broadcasts` は
 * `event_id` が NOT NULL + UNIQUE + FK RESTRICT なので「大会に属さない常設の
 * 紐付け」を表現できず、流用せず新設する。
 *
 * ライフサイクル（`event_line_broadcasts` と同じ流儀）:
 *   invite_pending → (Bot がグループに join)  → joined_waiting_code
 *                  → (6 桁コードを発言)       → linked
 *                  → (Bot kick / 管理者解除)  → revoked
 *
 * **配信対象の定義（Task 2 / Task 4 の共有契約。ここが唯一の正）:**
 *   - 配信するのは `status = 'linked'` かつ `line_group_id IS NOT NULL` の行だけ。
 *     「行が存在すること」で判定してはならない — 解除 (revoked) した級へ送り続けて
 *     しまい AC-19 が壊れる
 *   - 配信側 (`event-grade-broadcast.ts`) が SELECT する列は
 *     `grade` / `line_group_id` / `line_channel_id` と、そこから引く
 *     `line_channels.channel_access_token` のみ
 *   - push 失敗でこの行を revoke してはならない（常設紐付けなので自動解除すると
 *     運用のたびに繋ぎ直しになる）。既存 `line-broadcast.ts` の 401/4xx 自動解放は
 *     持ち込まない
 *
 * `grade` UNIQUE: 1 つの級に 2 グループを同時に紐付けられない (AC-20) を DB 層で
 * 保証する。revoked 済みの級へ招待コードを再発行する操作は**同一行の UPDATE**
 * （新規行を作らない。`event_line_broadcasts` の再紐付けと同じ）。
 *
 * `line_channel_id` UNIQUE: 1 つの Bot が 2 つの級を兼務できないようにする。
 * `event_line_broadcasts` はこれを `line_channels.assigned_event_id` の UNIQUE で
 * 得ているが、級グループには対応する列が無いためこちら側で張る。
 * ON DELETE RESTRICT はチャネルプールの流儀（行は status を切り替えるだけで
 * 消さない。削除は静かに孤立させず失敗させる）に合わせる。
 *
 * `invite_code` partial UNIQUE: `event_line_broadcasts` と同じ理由（有効な招待
 * コードの衝突を DB 層で不可能にする）。Postgres の partial index は IMMUTABLE な
 * 述語しか受け付けないため期限は条件に含めず、検証側で `expires_at > now()` を見る。
 */
export const lineGradeGroupBindings = pgTable(
  'line_grade_group_bindings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    grade: gradeEnum('grade').notNull().unique(),
    lineChannelId: integer('line_channel_id')
      .notNull()
      .unique()
      .references(() => lineChannels.id, { onDelete: 'restrict' }),
    inviteCode: text('invite_code'),
    inviteCodeExpiresAt: timestamp('invite_code_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    lineGroupId: text('line_group_id'),
    status: lineGradeGroupStatusEnum('status').notNull().default('invite_pending'),
    linkedAt: timestamp('linked_at', { mode: 'date', withTimezone: true }),
    revokedAt: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
    // 'manual' / 'bot_kicked'。運用者向けの監査情報で値が増える余地があるため
    // enum にせず text（event_line_broadcasts.revoke_reason と同じ）。
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('line_grade_group_bindings_invite_code_active_uq')
      .on(t.inviteCode)
      .where(sql`${t.inviteCode} IS NOT NULL`),
  ],
)
