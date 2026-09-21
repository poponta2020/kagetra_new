const PHONE_RE = /^[0-9-]+$/

/**
 * 'YYYY-MM-DD', a real calendar date, year ≥ 1900, not in the future.
 *
 * roster-claim: `apps/web/src/app/register/[token]/actions.ts` の
 * `validateBirthDate` から挙動そのままで移設。呼び出し元は trim 済みの
 * 文字列を渡す前提。
 */
export function validateBirthDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '生年月日を入力してください'
  const parts = s.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return '生年月日が正しくありません'
  }
  if (y < 1900) return '生年月日が正しくありません'
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (dt.getTime() > todayUtc) return '生年月日に未来の日付は指定できません'
  return null
}

/**
 * 電話番号の検証。`apps/web/src/app/register/[token]/actions.ts` の
 * インライン検証と同じ規則。呼び出し元は trim 済みの文字列を渡す前提。
 */
export function validatePhone(s: string): string | null {
  if (!PHONE_RE.test(s)) {
    return '電話番号は数字とハイフンで入力してください'
  }
  const digits = s.replace(/-/g, '')
  if (digits.length < 10 || digits.length > 13) {
    return '電話番号の桁数が不正です（10〜13桁）'
  }
  return null
}
