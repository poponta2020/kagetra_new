import { eq } from 'drizzle-orm'
import { users } from '@kagetra/shared/schema'
import type { db as appDb } from '@/lib/db'

/**
 * line-chat-commands（LINE グループでの申込/支払ステータス進行）専用の認可ヘルパー。
 *
 * `requireAdminSession()` 等の既存パターンを使わないのは、呼び出し元が Auth.js の
 * セッションを持たない LINE webhook だから。ここで判定するのは「Next.js にログイン
 * しているか」ではなく「その LINE アカウントの発言者は誰で、どのロールか」であり、
 * セッション前提のヘルパーは使えない（requirements §6）。
 *
 * また「LINE グループに在籍している」こと自体は権限にならない点にも注意する。
 * 大会別グループには一般会員や非会員（ゲスト参加者・外部関係者）も普通に居るため、
 * 発言が Bot に届いた＝実行してよい、では fail-open になってしまう。実行可否は
 * 必ず `users.line_user_id` から引いた本人の DB 上のロールで決める。
 *
 * 判定は毎回 DB から引く（結果をキャッシュしない）。理由は travel-report/authz.ts と
 * 同じで、退会・ロール変更を次のメッセージから即座に効かせるため。webhook は
 * 1リクエストにつき高々数回しか呼ばないので React `cache()` によるリクエスト内の
 * 問い合わせ束ねも不要。
 */

/** LINE 起点で実行できるアクション。 */
export type LineChatAction = 'entry' | 'payment'

export interface LineChatActorPermissions {
  /** 解決できた会員の id（監査ログ用。解決できなければ null）。 */
  userId: string | null
  /** 申込済みへ進められるか。 */
  entry: boolean
  /** 支払済みへ進められるか。 */
  payment: boolean
}

/** 解決できなかった場合の全 false（fail-closed）。 */
const DENY_ALL: LineChatActorPermissions = { userId: null, entry: false, payment: false }

/**
 * LINE userId から発言者を解決し、アクションごとの実行可否を返す。
 *
 * 権限表（requirements §3.2.3）:
 *   - admin      : entry ○ / payment ○
 *   - vice_admin : entry × / payment ○
 *   - member/guest/未紐付け/退会者 : entry × / payment ×
 *
 * `users.is_treasurer` はここでは**読まない**（`columns` に含めていない）。会計担当の
 * 識別と認可判定は別物として扱う既存方針（travel-report/authz.ts 参照）を、この関数
 * では「そもそもカラムを取得しない」ことで構造的に保証する。
 *
 * 解決できない（該当行なし・退会済み）場合は必ず全 false を返す（fail-closed）。
 */
export async function resolveLineChatPermissions(
  dbc: typeof appDb,
  lineUserId: string | null | undefined,
): Promise<LineChatActorPermissions> {
  if (!lineUserId) return DENY_ALL

  const row = await dbc.query.users.findFirst({
    where: eq(users.lineUserId, lineUserId),
    columns: { id: true, role: true, deactivatedAt: true },
  })
  if (!row) return DENY_ALL
  // 退会者は「解決できなかった」と同じ扱い（userId も null で返す）。
  if (row.deactivatedAt) return DENY_ALL

  if (row.role === 'admin') return { userId: row.id, entry: true, payment: true }
  if (row.role === 'vice_admin') return { userId: row.id, entry: false, payment: true }
  // member / guest / 未知の値は全 false。
  return { userId: row.id, entry: false, payment: false }
}
