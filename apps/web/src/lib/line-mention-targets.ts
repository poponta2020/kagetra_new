import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'
import type { MentionTarget } from '@/lib/line-mention'

/**
 * line-mention-targets: `@会計` / `@管理者` が誰を指すかを決める**唯一の場所**
 * （requirements §3.1.3）。
 *
 * `line-mention.ts`（pure なメッセージ組み立て）と分けてあるのは、こちらが
 * `@kagetra/shared/schema` と DB ハンドルに依存するため。文面のユニットテストを
 * DB 依存にしないための分離で、`entry-fee.ts`（pure）と `entry-fee-tally.ts`（DB）の
 * 関係と同じ流儀。
 *
 * 共通の絞り込み:
 * ```
 * line_user_id IS NOT NULL AND deactivated_at IS NULL
 * ```
 * - 並び順は `users.id` 昇順（メンションの並びを決定的にするため）
 * - **0件でも呼び出し側はメッセージを送る**。`buildMentionMessage` が
 *   `userIds: []` を素テキストへ倒すので、ここは空配列を返すだけでよい（AC-5）
 * - `line_user_id` が NULL の会計担当は黙って飛ばす（AC-6）
 *
 * ★`is_treasurer` は**認可判断に使わない**（requirements §6）。この列を読むのは
 * 「誰をメンションするか」を決めるこのモジュールだけに留める。
 */

type Database = typeof appDb
// db.transaction(cb) がコールバックへ渡すハンドル型（entry-fee-tally.ts と同じ抽出方法）。
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

/** 管理者メンションの対象ロール（`@管理者`）。会計フラグとは無関係。 */
const ADMIN_ROLES = ['admin', 'vice_admin'] as const

/** メンションできる会員の共通条件（LINE 紐付け済み・未無効化）。 */
function mentionableConditions() {
  return [isNotNull(users.lineUserId), isNull(users.deactivatedAt)]
}

/**
 * `@会計` の対象（`is_treasurer = true`）の `line_user_id` を id 昇順で返す。
 * 該当0人なら空配列。
 */
export async function loadTreasurerLineUserIds(dbc: DbOrTx): Promise<string[]> {
  const rows = await dbc
    .select({ lineUserId: users.lineUserId })
    .from(users)
    .where(and(eq(users.isTreasurer, true), ...mentionableConditions()))
    .orderBy(asc(users.id))
  // isNotNull で絞っているので実際には null は来ないが、型の NULL 許容を潰す。
  return rows.flatMap((r) => (r.lineUserId == null ? [] : [r.lineUserId]))
}

/**
 * `@管理者` の対象（`role IN ('admin','vice_admin')`）の `line_user_id` を
 * id 昇順で返す。該当0人なら空配列。
 */
export async function loadAdminLineUserIds(dbc: DbOrTx): Promise<string[]> {
  const rows = await dbc
    .select({ lineUserId: users.lineUserId })
    .from(users)
    .where(and(inArray(users.role, [...ADMIN_ROLES]), ...mentionableConditions()))
    .orderBy(asc(users.id))
  return rows.flatMap((r) => (r.lineUserId == null ? [] : [r.lineUserId]))
}

/** `buildMentionMessage` へそのまま渡せる形にする糖衣。 */
export function toMentionTarget(userIds: readonly string[]): MentionTarget {
  return { kind: 'users', userIds }
}

/** `@会計` のメンション対象を解決する（label は呼び出し側が持つ）。 */
export async function resolveTreasurerMention(dbc: DbOrTx): Promise<MentionTarget> {
  return toMentionTarget(await loadTreasurerLineUserIds(dbc))
}

/** `@管理者` のメンション対象を解決する。 */
export async function resolveAdminMention(dbc: DbOrTx): Promise<MentionTarget> {
  return toMentionTarget(await loadAdminLineUserIds(dbc))
}
