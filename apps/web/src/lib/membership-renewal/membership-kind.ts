import type { MembershipKind } from '@kagetra/shared'

/**
 * 会員区分（正会員／准会員）の導出（定款第6条・requirements R1・AC-4）。
 *
 * 「対象年度の 3/31 時点（＝事業年度開始日 4/1 の前日）で満 20 歳に達していれば
 * 正会員、達していなければ准会員」。**保存はしない**——年度ごとに機械的に決まる値
 * を毎年更新する運用コストを避けるため、S1/S2 とも表示のたびにこの関数で導出する。
 *
 * `new Date()`（現在時刻・ホストの TZ）には依存しない。`birthDate` はいずれも
 * `YYYY-MM-DD` の文字列で、20 歳の誕生日の日付文字列と基準日の文字列を
 * そのまま比較する（ゼロ埋め桁数が揃っているので辞書式比較＝暦日比較になる）。
 */

const BIRTH_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` が実在する暦日かどうか（うるう年でない年の 2/29 等を弾く）。 */
function isValidBirthDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

export const MEMBERSHIP_KIND_LABELS: Record<MembershipKind, string> = {
  regular: '正会員',
  associate: '准会員',
  unknown: '未判定',
}

/** S1 の導出根拠の添え書き（正会員／准会員の表示に添える）。 */
export const MEMBERSHIP_KIND_NOTE = '3/31 時点で 20 歳以上'

/**
 * `birthDate` と対象年度から会員区分を導出する。
 * `birthDate` が NULL・形式不正・実在しない暦日なら `'unknown'`。
 */
export function resolveMembershipKind(
  birthDate: string | null,
  fiscalYear: number,
): MembershipKind {
  if (!birthDate) return 'unknown'
  const m = BIRTH_DATE_RE.exec(birthDate)
  if (!m) return 'unknown'
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!isValidBirthDate(year, month, day)) return 'unknown'

  // 20 歳の誕生日（YYYY-MM-DD）と、対象年度の 3/31 を文字列のまま比較する。
  const monthDay = `${m[2]}-${m[3]}`
  const twentiethBirthday = `${year + 20}-${monthDay}`
  const referenceDate = `${fiscalYear}-03-31`
  return twentiethBirthday <= referenceDate ? 'regular' : 'associate'
}
