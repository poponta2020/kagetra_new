import { formatEventDate } from '@/lib/event-date'

/**
 * LINE 送信タスクの本文テンプレ（requirements R7・AC-16）。
 *
 * 締切の表記は既存の `formatEventDate`（`M/D(曜)`）を再利用する（同じ表記を
 * 二重実装しない）。本文はここで完成形（案内＝一言まで含む・リマインド＝
 * 未回答者の氏名を列挙済み）にし、送信時に再計算しない
 * （implementation-plan「送信タスクの本文は生成時に確定」）。
 */

/**
 * 開始時の案内メッセージ。
 * S1 の絶対 URL と「ログイン後はホームの『登録確認』から開けます」を必ず含める
 * （ログイン後の戻り先指定は Non-goal のため、案内文で代替する）。
 * `note`（管理者の一言）が空/null なら行を出さない。
 */
export function buildAnnouncementMessage(input: {
  fiscalYear: number
  deadlineJst: string
  note: string | null
  url: string
}): string {
  const deadline = formatEventDate(input.deadlineJst)
  const lines = [
    `【${input.fiscalYear}年度 全日協登録確認のお願い】`,
    `今年度も登録会に所属を継続するかどうかの確認です。回答締切は ${deadline} です。`,
    'ご自身の登録情報の確認・回答は以下のリンクから行ってください。',
    input.url,
    'ログイン後はホームの「登録確認」から開けます。',
  ]
  if (input.note) lines.push(input.note)
  return lines.join('\n')
}

/**
 * リマインドメッセージ。未回答者の氏名を全員テキストで列挙した完成形にする
 * （メンションはワーカーがこの氏名文字列を `@` 候補選択へ置き換える形。
 * 置き換えられなければテキストのまま＝フォールバックとして成立する。AC-16）。
 * `splitCount` が 2 以上（分割あり）のときだけ `(分割 n/m)` を本文に出す。
 */
export function buildReminderMessage(input: {
  fiscalYear: number
  deadlineJst: string
  url: string
  names: readonly string[]
  splitIndex?: number
  splitCount?: number
}): string {
  const deadline = formatEventDate(input.deadlineJst)
  const lines = [
    `【${input.fiscalYear}年度 全日協登録確認 リマインド】`,
    `回答締切は ${deadline} です。以下の方はまだご回答が確認できていません。`,
    input.names.join('、'),
    '以下のリンクから回答してください。',
    input.url,
  ]
  if (input.splitCount != null && input.splitCount >= 2) {
    lines.push(`(分割 ${(input.splitIndex ?? 0) + 1}/${input.splitCount})`)
  }
  return lines.join('\n')
}
