import 'server-only'
import type { Grade } from '@kagetra/shared/types'

/**
 * entry-form-autofill タスク3: 件名・添付ファイル名・本文の定型生成。
 *
 * 純関数のみ（DB・env・I/O に触らない）。会の定数（所属会名・責任者姓）や
 * 大会名・対象会員の級リストは呼び出し側（タスク7 の Server Action。会定数の
 * 読み出しはタスク6 `settings.ts` の責務）がすべて引数で渡す。
 *
 * 本文の文面は design-mock/b-step3.html（送信済み実例に基づく定型）に揃えて
 * いる。会名は "北海道大学かるた会" をハードコードせず、必ず `clubName`
 * 引数を使う（要件の文言はあくまで設定値の一例であって既定値ではない）。
 */

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/**
 * 主催者指定が案内メール本文・xlsx から見つからなかった場合の定型件名。
 * `<大会名>申込み（<所属会名>）`。
 */
export function buildDefaultEntrySubject(tournamentName: string, clubName: string): string {
  return `${tournamentName}申込み（${clubName}）`
}

/**
 * 添付ファイル名に「【<所属会名>】」プレフィックスを付与する。
 * 主催者指定のファイル名が既に同じプレフィックスを持っている場合は
 * 二重に付けない（元テンプレ名をそのまま使い回すケースを想定）。
 */
export function buildAttachmentFilename(originalFilename: string, clubName: string): string {
  const prefix = `【${clubName}】`
  return originalFilename.startsWith(prefix) ? originalFilename : `${prefix}${originalFilename}`
}

export interface GradeCountSummary {
  /** 対象会員の総数。級未設定（null）の会員も含む。 */
  total: number
  /** `A級3名、B級5名` のような内訳文字列。0名の級は出さない。全員級未設定なら空文字。 */
  breakdown: string
}

/**
 * 対象会員の級リストから人数・級別内訳を集計する。
 *
 * 級が未設定（null）の会員は総数 `total` には含めるが、級別内訳
 * `breakdown` には出さない（「弊会所属N名」の N は在籍者数として数えたい
 * 一方、級別の内訳は級が確定している人数の分だけ書く方が実態に合うため。
 * 内訳の合計人数が `total` と一致しない場合があり得るが、それは
 * 「級未定の会員がいる」という実態の反映であり不整合ではない）。
 */
export function summarizeGradeCounts(grades: readonly (Grade | null | undefined)[]): GradeCountSummary {
  const counts = new Map<Grade, number>()
  for (const grade of grades) {
    if (!grade) continue
    counts.set(grade, (counts.get(grade) ?? 0) + 1)
  }
  const breakdown = GRADE_ORDER
    .filter((grade) => (counts.get(grade) ?? 0) > 0)
    .map((grade) => `${grade}級${counts.get(grade)}名`)
    .join('、')
  return { total: grades.length, breakdown }
}

export interface BuildEntryMailBodyInput {
  /** events.organizer 相当。未設定（null/空文字）なら「ご担当者様」のみの宛名にする。 */
  organizer: string | null
  clubName: string
  /** 申込責任者氏名の姓のみ（設定値 `settings.ts` から呼び出し側が渡す）。挨拶の名乗り・署名の両方に使う。 */
  representativeSurname: string
  grades: readonly (Grade | null | undefined)[]
}

/**
 * 下書きメール本文を生成する。
 * 宛名（主催者名＋「　ご担当者様」）＋挨拶＋定型の一文（級別人数集計込み）＋結び＋署名（責任者姓）。
 */
export function buildEntryMailBody(input: BuildEntryMailBodyInput): string {
  const salutation = input.organizer && input.organizer.trim().length > 0
    ? `${input.organizer}　ご担当者様`
    : 'ご担当者様'
  const { total, breakdown } = summarizeGradeCounts(input.grades)
  const breakdownText = breakdown.length > 0 ? `（${breakdown}）` : ''

  return [
    salutation,
    '',
    'いつもお世話になっております。',
    `${input.clubName}連絡責任者の${input.representativeSurname}と申します。`,
    '',
    `弊会所属${total}名${breakdownText}分の参加申込書を添付ファイルにてお送りいたします。`,
    'お手数おかけしますが、ご確認のほどよろしくお願いします。',
    '',
    input.representativeSurname,
  ].join('\n')
}
