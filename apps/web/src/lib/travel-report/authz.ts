import 'server-only'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import { db } from '@/lib/db'

/**
 * travel-report（遠征届）の**唯一の**認可ヘルパー。
 *
 * 提出権限者の定義（requirements R2・R12、implementation-plan 技術計画）:
 *
 *   admin ∪ vice_admin ∪ (role === 'member' ∧ is_travel_report_submitter ∧ deactivated_at IS NULL)
 *
 * `role` は呼び出し側が `auth()` から得た**実効ロール**（`session.user.role`）を
 * そのまま渡す想定。role-preview-switch でプレビュー中はここに下位ロールが
 * 入るため、admin が member としてプレビュー中に自分自身のフラグが立って
 * いれば、この関数は true を返す（＝提出権限者向け UI が出る）。これは
 * バグではなく実効ロールの既存規律どおりの挙動（`lib/role-preview.ts` 参照）。
 * `id` はプレビュー中も本物の user id のままなので、フラグは常にその
 * 本人（プレビューしている管理者自身）の DB 行から読まれる。
 *
 * ゲスト（`role === 'guest'`）にフラグが付いても権限にはならない
 * （`role === 'member'` の判定がここで効く。会員編集画面もゲストには
 * このチェックボックスを出さない）。
 *
 * `is_travel_report_submitter` は `users.is_treasurer`（line-bot-message-revamp
 * の「@会計」メンション解決専用・**認可には使わない**）と扱いが**逆**である
 * ことに注意する。こちらは通知先の識別と認可判定の**両方**に使う
 * （requirements §6・§7）。
 *
 * フラグは呼び出しのたびに DB から引く（`session` には載せない）。理由は
 * 退会・フラグ剥奪を次のリクエストから即座に効かせるため（JWT は古い値を
 * 運びうる）。同一 RSC ツリー内で複数回呼ばれても DB 問い合わせが1回に
 * 束ねられるよう `loadSubmitterFlag` を React `cache()` でラップする。
 *
 * このヘルパーは**ページ（RSC）／Server Action／route handler の三箇所
 * すべて**で使う。呼び出し側が結果の boolean を見て、それぞれの作法
 * （redirect / throw / 403 レスポンス）で拒否する。
 */

/** `isTravelReportSubmitter` に渡すセッション情報の最小形。 */
export interface TravelReportAuthSession {
  user?: {
    id?: string | null
    /** 実効ロール（`session.user.role`）。本物のロールではない点に注意。 */
    role?: string | null
  } | null
}

/**
 * `users.is_travel_report_submitter` と `deactivated_at` を id 引きで読む。
 * 対象ユーザーが見つからない場合は false（fail-closed）。
 */
const loadSubmitterFlag = cache(async (userId: string): Promise<boolean> => {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isTravelReportSubmitter: true, deactivatedAt: true },
  })
  if (!row) return false
  if (row.deactivatedAt) return false
  return row.isTravelReportSubmitter
})

/**
 * 提出権限者か判定する。
 *
 * @param session `auth()` の戻り値（または同形のモック）。null/未ログインは false。
 */
export async function isTravelReportSubmitter(
  session: TravelReportAuthSession | null | undefined,
): Promise<boolean> {
  const user = session?.user
  if (!user?.id) return false
  if (user.role === 'admin' || user.role === 'vice_admin') return true
  if (user.role !== 'member') return false
  return loadSubmitterFlag(user.id)
}
