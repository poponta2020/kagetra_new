import type { Grade } from '@kagetra/shared/types'

/**
 * entry-form-autofill: 申込書の参加級（自由文字列）を A〜E の標準級へ寄せる。
 *
 * 参加級は `users.grade` を初期値にしつつ、F級など大会独自級・当日昇級のために
 * 自由編集できる（requirements §3.2.1）。シートへの振分と級別集計は標準級だけを
 * 対象にするので、その判定をここに一本化する。
 *
 * `fill.ts`（server-only）とプレビュー画面（client）の両方が使うため、
 * **`import 'server-only'` を付けない**モジュールとして切り出している——同じ
 * 規則で判定しないと「画面の人数」と「生成した xlsx の中身」が食い違う。
 */
const STANDARD_GRADES: readonly string[] = ['A', 'B', 'C', 'D', 'E']

export function asStandardGrade(value: string | null | undefined): Grade | null {
  if (!value) return null
  const normalized = value.trim().replace(/級$/, '').toUpperCase()
  return STANDARD_GRADES.includes(normalized) ? (normalized as Grade) : null
}
