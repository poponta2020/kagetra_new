import type { Grade } from '@kagetra/shared/types'
import { asStandardGrade } from '@/lib/entry-form/grade-normalize'

/**
 * entry-form-autofill タスク7 (UI): プレビューの表示専用フォーマッタ。
 *
 * `@/lib/entry-form/*` は `import 'server-only'` を持つため EntryFormWizard から
 * 値 import できない。ここに置く関数は表示専用の純関数（DB・env・I/O に触らない）
 * ——xlsx へ書き込む値の整形（`lib/entry-form/fill.ts` の `formatDan` 等）とは別物で、
 * 記入先テンプレの `danFormat` には依存しない固定表記（画面上はいつも「n段」表記）。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function monthDay(dateStr: string): { month: number; day: number } | null {
  const m = DATE_RE.exec(dateStr)
  if (!m) return null
  return { month: Number(m[2]), day: Number(m[3]) }
}

/**
 * `context.eventDates`（YYYY-MM-DD 昇順配列）からサブタイトルの日程表記を作る。
 * 単日は `M/D`、同月内の複数日は `M/D〜D`、月をまたぐ場合は `M/D〜M/D`
 * （先頭と末尾のみを見る——中間の日付は表示しない。b-step1.html の実例と同型）。
 */
export function formatEventDateRange(dates: readonly string[]): string {
  if (dates.length === 0) return '日程未定'
  const first = monthDay(dates[0]!)
  const last = monthDay(dates[dates.length - 1]!)
  if (!first || !last) return dates[0] ?? '日程未定'
  if (first.month === last.month && first.day === last.day) {
    return `${first.month}/${first.day}`
  }
  if (first.month === last.month) {
    return `${first.month}/${first.day}〜${last.day}`
  }
  return `${first.month}/${first.day}〜${last.month}/${last.day}`
}

/** テンプレ候補の「M/D受信」表記。`receivedAt` は ISO 日時文字列（JST で解釈する）。 */
export function formatReceivedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const map: Partial<Record<string, string>> = {}
  for (const part of parts) map[part.type] = part.value
  return `${Number(map.month ?? '0')}/${Number(map.day ?? '0')}`
}

const DAN_LABELS: Record<number, string> = {
  1: '初段',
  2: '2段',
  3: '3段',
  4: '4段',
  5: '5段',
  6: '6段',
  7: '7段',
  8: '8段',
  9: '9段',
  10: '10段',
}

/** 会員一覧・編集シートの表示専用。`null`/`0` は「無段」。 */
export function formatDanDisplay(dan: number | null): string {
  if (dan == null || dan === 0) return '無段'
  if (dan >= 1 && dan <= 10) return DAN_LABELS[dan]!
  return `${dan}段`
}

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/** ステップ2の集計行（級別人数＋計）。級未設定は集計に出さないが計には含める。 */
export function tallyGrades(grades: readonly (string | null)[]): {
  /** A〜E の標準級。GRADE_ORDER 順。 */
  byGrade: { grade: Grade; count: number }[]
  /** 大会独自級（F級等）。入力された表記のまま、出現順で数える。 */
  byCustomGrade: { grade: string; count: number }[]
  /** 参加級が未登録（null / 空欄）の人数（AC-5b）。 */
  unset: number
  total: number
} {
  const counts = new Map<Grade, number>()
  const customCounts = new Map<string, number>()
  let unset = 0
  for (const grade of grades) {
    const trimmed = grade?.trim() ?? ''
    if (trimmed.length === 0) {
      unset += 1
      continue
    }
    const standard = asStandardGrade(trimmed)
    if (!standard) {
      // 独自級は「未設定」に混ぜない——F級と明記した会員を未登録として
      // 表示すると、警告の意味が壊れる。A〜E の人数にも混ぜない。
      customCounts.set(trimmed, (customCounts.get(trimmed) ?? 0) + 1)
      continue
    }
    counts.set(standard, (counts.get(standard) ?? 0) + 1)
  }
  const byGrade = GRADE_ORDER.filter((g) => (counts.get(g) ?? 0) > 0).map((grade) => ({
    grade,
    count: counts.get(grade)!,
  }))
  const byCustomGrade = [...customCounts.entries()].map(([grade, count]) => ({ grade, count }))
  return { byGrade, byCustomGrade, unset, total: grades.length }
}

/**
 * ブラウザの `File` を base64 文字列へ変換する（Server Action の境界を Buffer が
 * 越えないため）。チャンク分割して `String.fromCharCode` に渡す——大きな xlsx を
 * 一度に展開すると呼び出しスタック上限を超え得るため。
 */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
