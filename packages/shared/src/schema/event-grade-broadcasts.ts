import { integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { gradeEnum } from './enums'
import { events } from './events'

/**
 * event_grade_broadcasts: `(大会, 級)` 単位の級グループ配信記録。
 *
 * `event_lifecycle_notifications` の `type` enum に級を混ぜるとライフサイクル
 * 通知ドメインを汚すため分離した。
 *
 * **claim → push → 確定 / 取消**（Task 2 の共有契約。ここが唯一の正）:
 *
 * 1. claim（送信前）— リースつき upsert を 1 文で撃つ:
 *
 *    ```sql
 *    INSERT INTO event_grade_broadcasts (event_id, grade, claimed_at)
 *    VALUES ($1, $2, now())
 *    ON CONFLICT (event_id, grade) DO UPDATE SET claimed_at = now()
 *      WHERE event_grade_broadcasts.sent_at IS NULL
 *        AND event_grade_broadcasts.claimed_at < now() - interval '5 minutes'
 *    RETURNING id
 *    ```
 *
 *    RETURNING が行を返すのは「新規 claim」か「放置された claim の再取得」のときだけ。
 *      - `sent_at IS NOT NULL`   → 送信済み。2 回目は送らない (AC-8)
 *      - 直近 5 分以内の claim    → 別プロセスが送信中。二重 push を避ける
 * 2. push 成功 → `UPDATE ... SET sent_at = now() WHERE id = $1`
 * 3. push 失敗 → `DELETE ... WHERE id = $1 AND sent_at IS NULL`（未送信のまま残し、
 *    後から紐付け直して再送できるようにする。AC-9 / AC-21）
 *
 * DELETE で戻せない経路（`after()` の途中でコンテナが落ちた等）は
 * `sent_at IS NULL` の claim 行が残るが、5 分のリース期限を過ぎれば再送ボタンが
 * 再 claim できる。ここを単純な `ON CONFLICT DO NOTHING` にすると、その
 * `(大会, 級)` が永久に送信不能になり再送でも静かにスキップされる。
 *
 * `event_id` は ON DELETE CASCADE。この行は外部リソース（チャネル・グループ）を
 * 保持しないので、大会が消えたら送信記録も一緒に消えてよい（`event_line_broadcasts`
 * が RESTRICT なのは、消えると channel が宙に浮くため）。
 */
export const eventGradeBroadcasts = pgTable(
  'event_grade_broadcasts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    grade: gradeEnum('grade').notNull(),
    // claim を取った時刻。リースの基準なので NOT NULL。
    // 確定 (`sent_at`) / 取消 (DELETE) はこの値との一致を条件にする（claim の
    // ownership）。リース失効で別プロセスが再 claim すると `claimed_at` が変わるため、
    // 古いプロセスが後から新しい claim を消してしまう race を弾ける。
    claimedAt: timestamp('claimed_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
    // LINE の `X-Line-Retry-Key`（UUID）。**claim 行に永続化し、一度決めたら
    // 変えない**のが要点。同じ push にまとめた行は同じキーを共有するので、
    // 「まとめて送った後に確定だけ失敗し、後から一部の大会だけ再送する」場合でも
    // 元の送信と同じキーで再開でき、LINE 側の重複排除が効く。
    // キーを都度その場の行集合から導くと、再送で集合が変わった瞬間に別キーになり
    // 重複排除がすり抜ける（review R2 blocker）。
    retryKey: text('retry_key'),
    // push 成功時にだけ刻まれる。NULL = claim 中（または放置された claim）。
    sentAt: timestamp('sent_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('event_grade_broadcasts_event_grade_uq').on(t.eventId, t.grade)],
)
