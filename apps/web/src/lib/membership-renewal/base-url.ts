/**
 * 年度確認（S1）の絶対 URL の解決。
 *
 * `PUBLIC_BASE_URL` を読む既存ヘルパー（`entry-overdue-alert.ts` /
 * `event-grade-broadcast.ts` / `travel-report/notify.ts`）はいずれもモジュール
 * ローカルで、**重依存を避けるため import せずコピーする**のがこのリポジトリの
 * 慣行。ここでも同じ規則（https 必須・末尾スラッシュを落とす・`process.env` は
 * 呼び出しごとに読む）で 1 つだけ持つ。
 *
 * ★年度確認では未設定を `null` で返し、**開始を拒否する材料**にする（AC-3）。
 * 案内・リマインドの本文は S1 の URL が要（リンクが無いと会員がたどり着けない）
 * なので、リンク行を省いて送る遠征届の方針とは分ける。
 */
export function resolveRenewalBaseUrl(): string | null {
  const candidate = process.env.PUBLIC_BASE_URL
  if (!candidate || !/^https:\/\//i.test(candidate)) return null
  return candidate.replace(/\/$/, '')
}

/** S1（`/renewal`）の絶対 URL。`PUBLIC_BASE_URL` 未設定なら `null`。 */
export function resolveRenewalPageUrl(): string | null {
  const base = resolveRenewalBaseUrl()
  return base === null ? null : `${base}/renewal`
}
