import {
  ROSTER_FIELDS,
  ROSTER_FIELD_LABELS,
  type Gender,
  type RenewalSnapshot,
  type RosterField,
} from '@kagetra/shared'
import { formatDanKanji } from './dan-kanji'
import type { RenewalSnapshotSource } from './snapshot'

/**
 * 名簿の列（`ROSTER_FIELDS`）の差分導出（requirements R3・AC-7）。
 *
 * 「変更の有無」は本人の宣言ではなく、開始時のスナップショットと現在値の
 * 機械的な差分から導く（管理者が年度中に会員編集で直した分も拾う）。
 */

export type RosterDiffEntry = {
  field: RosterField
  label: string
  before: string | null
  after: string | null
}

/** `ROSTER_FIELDS` の値を持つ最小限の形。`RenewalSnapshot` と `RenewalSnapshotSource` の両方が満たす。 */
type RosterValues = Pick<RenewalSnapshot, RosterField>

const GENDER_LABELS: Record<Gender, string> = { male: '男', female: '女' }

/** 郵便番号の比較用正規化。全角数字を半角へ寄せ、数字以外（ハイフン等）を除いて 7 桁の数字列にする。 */
function normalizePostalCode(value: string): string {
  const halfWidth = value.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )
  return halfWidth.replace(/[^0-9]/g, '')
}

/**
 * 比較前の正規化。空文字と `null` を同一視し、郵便番号だけ追加でハイフン・全角を除いた
 * 数字列へ寄せる（表示 `formatRosterValue` は保存値のまま出すので、ここでは比較専用）。
 */
function normalizeForCompare(
  field: RosterField,
  value: string | number | null,
): string | number | null {
  if (value === null || value === '') return null
  if (field === 'postalCode' && typeof value === 'string') return normalizePostalCode(value)
  return value
}

/**
 * 名簿の列 1 項目を表示用文字列へ整形する。
 * 段位は漢数字（`dan-kanji.ts`）、性別は 男/女、級は `A級` のように整形し、
 * それ以外（氏名・かな・生年月日・郵便番号・住所・電話）は保存値のまま返す。
 * 値が `null`（未入力）なら `null`。
 */
export function formatRosterValue(field: RosterField, source: RosterValues): string | null {
  const value = source[field]
  if (value == null) return null
  switch (field) {
    case 'dan':
      return formatDanKanji(value as number)
    case 'gender':
      return GENDER_LABELS[value as Gender]
    case 'grade':
      return `${value}級`
    default:
      return String(value)
  }
}

/**
 * スナップショット（開始時点）と現在値の差分を `ROSTER_FIELDS` の順で返す。
 * 差分が無い項目は含めない（差分ゼロ配列＝「継続・変更なし」）。
 * 学年セクションの 3 項目（`facultyKind`/`faculty`/`schoolYear`）は名簿の列では
 * ないため `ROSTER_FIELDS` に含まれず、この関数の対象外（R3）。
 */
export function diffRoster(
  snapshot: RenewalSnapshot,
  current: RenewalSnapshotSource,
): RosterDiffEntry[] {
  const entries: RosterDiffEntry[] = []
  for (const field of ROSTER_FIELDS) {
    const before = normalizeForCompare(field, snapshot[field])
    const after = normalizeForCompare(field, current[field])
    if (before === after) continue
    entries.push({
      field,
      label: ROSTER_FIELD_LABELS[field],
      before: formatRosterValue(field, snapshot),
      after: formatRosterValue(field, current),
    })
  }
  return entries
}
