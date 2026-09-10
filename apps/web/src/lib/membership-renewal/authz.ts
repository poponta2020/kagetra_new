/**
 * annual-registration-renewal（年度確認）の認可判定（requirements R12）。
 *
 * `travel-report/authz.ts` は DB からフラグ（`is_travel_report_submitter`）を
 * 引く非同期関数だが、年度確認の S2/S3・開始・締切変更・代理回答・登録完了・
 * Bot 転換の権限は `role` だけで決まり（DB の追加フラグを持たない）、
 * DB 非依存の純関数で足りるため、こちらは同期・純関数にしている
 * （実装手順書タスク2の API 契約）。
 *
 * 呼び出し側は `auth()` の実効ロール（`session.user.role`）をそのまま渡す。
 */
export function isRenewalAdmin(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'vice_admin'
}
