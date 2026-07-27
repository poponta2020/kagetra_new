import type { Grade } from '@kagetra/shared/types'
import { surname } from '@/lib/surname'

/**
 * entry-form-autofill タスク7 (UI): `@/lib/entry-form/mail-template.ts` の
 * クライアントセーフな複製（設計要求3・(a)案）。
 *
 * あちらは `import 'server-only'` を持つため EntryFormWizard から値 import すると
 * 実行時に throw する。ステップ3（メール確認）の初期値はテンプレ選択後にクライアント側で
 * 組み立て直す必要があるため、同じロジックをここに複製する。
 *
 * **文言はここと `lib/entry-form/mail-template.ts` の両方が一致していなければならない**
 * ——`mail-template-client.test.ts` で両モジュールを直接比較し、片方だけ変わる事故を防ぐ。
 * 本文・件名・ファイル名の文言を変える場合は両ファイルを同時に直すこと。
 */

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

export function buildDefaultEntrySubject(tournamentName: string, clubName: string): string {
  return `${tournamentName}申込み（${clubName}）`
}

export function buildAttachmentFilename(originalFilename: string, clubName: string): string {
  const prefix = `【${clubName}】`
  return originalFilename.startsWith(prefix) ? originalFilename : `${prefix}${originalFilename}`
}

export interface GradeCountSummary {
  total: number
  breakdown: string
}

export function summarizeGradeCounts(
  grades: readonly (Grade | null | undefined)[],
): GradeCountSummary {
  const counts = new Map<Grade, number>()
  for (const grade of grades) {
    if (!grade) continue
    counts.set(grade, (counts.get(grade) ?? 0) + 1)
  }
  const breakdown = GRADE_ORDER.filter((grade) => (counts.get(grade) ?? 0) > 0)
    .map((grade) => `${grade}級${counts.get(grade)}名`)
    .join('、')
  return { total: grades.length, breakdown }
}

export interface BuildEntryMailBodyInput {
  organizer: string | null
  clubName: string
  representativeName: string
  grades: readonly (Grade | null | undefined)[]
}

export function buildEntryMailBody(input: BuildEntryMailBodyInput): string {
  const salutation =
    input.organizer && input.organizer.trim().length > 0
      ? `${input.organizer}　ご担当者様`
      : 'ご担当者様'
  const { total, breakdown } = summarizeGradeCounts(input.grades)
  const breakdownText = breakdown.length > 0 ? `（${breakdown}）` : ''
  const fullName = input.representativeName.replace(/[\s　]+/g, '')
  const signature = surname(input.representativeName)

  return [
    salutation,
    '',
    'いつもお世話になっております。',
    `${input.clubName}連絡責任者の${fullName}と申します。`,
    '',
    `弊会所属${total}名${breakdownText}分の参加申込書を添付ファイルにてお送りいたします。`,
    'お手数おかけしますが、ご確認のほどよろしくお願いします。',
    '',
    signature,
  ].join('\n')
}
