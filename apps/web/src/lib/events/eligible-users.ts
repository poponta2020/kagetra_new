import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'

/**
 * admin-attendance-edit: 「出欠の対象ユーザー」の where 条件の**正典**。
 *
 * `isInvited=true` ∩（対象級があればその級）。`eligibleGrades` が null / 空なら
 * 全級が対象で、そのときだけ級未設定（`grade IS NULL`）の会員も含まれる
 * （`IN` は NULL に対して NULL = 偽になるため、対象級ありの大会では自動的に
 * 除外される）。この「NULL の落ち方」は SQL の意味論に依存しているので、
 * TypeScript 側で同じ判定を書き直すと必ずずれる —— 条件は必ずこの1本を通す。
 *
 * 3箇所で共有する（要件 §6「候補の絞り込み定義の同一性」）:
 *   - `/events/[id]` の分母 `eligibleUsers`（参加者一覧から対象級外の stale な
 *     `attend=true` 行を除外する）
 *   - `adminAddAttendee` のサーバー側 fail-closed 検証
 *   - 編集画面の追加候補（`lib/events/attendance-edit.ts`）
 */
export function eligibleUsersWhere(
  eligibleGrades: readonly Grade[] | null | undefined,
): SQL | undefined {
  return eligibleGrades?.length
    ? and(eq(users.isInvited, true), inArray(users.grade, [...eligibleGrades]))
    : eq(users.isInvited, true)
}
