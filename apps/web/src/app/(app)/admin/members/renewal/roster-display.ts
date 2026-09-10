import type { RenewalSnapshot, RosterField } from '@kagetra/shared'
import { formatRosterValue } from '@/lib/membership-renewal/diff'
import type { RosterDiffEntry } from '@/lib/membership-renewal/diff'

/**
 * annual-registration-renewal タスク9（S2 `/admin/members/renewal`）専用の
 * 表示ユーティリティ。
 *
 * 名簿の列を「氏名」「ふりがな」のように隣接ペアへまとめて見せる（design-mock
 * `renewal-admin.html`）のは S2 の画面表現であって `diffRoster` の関心では
 * ないため、store/diff 層ではなくここ（screen 側）に置く。
 */

/** `formatRosterValue` が要求する最小限の形（`RenewalSnapshot` / `RenewalSnapshotSource` の両方が満たす）。 */
type RosterLike = Pick<RenewalSnapshot, RosterField>

interface ChangeGroup {
  label: string
  fields: readonly RosterField[]
}

/** 名簿の列を表示グループへまとめる（変更あり/なしの要約ラベル用）。 */
const CHANGE_GROUPS: readonly ChangeGroup[] = [
  { label: '氏名', fields: ['familyName', 'givenName'] },
  { label: 'ふりがな', fields: ['familyKana', 'givenKana'] },
  { label: '生年月日', fields: ['birthDate'] },
  { label: '性別', fields: ['gender'] },
  { label: '段位', fields: ['dan'] },
  { label: '級', fields: ['grade'] },
  { label: '住所', fields: ['postalCode', 'address1', 'address2'] },
  { label: '電話番号', fields: ['phone'] },
]

/** 変更のあったグループ名（行右の状態語。design-mock「住所」「氏名・ふりがな」等）。 */
export function changedGroupLabels(diff: readonly RosterDiffEntry[]): string[] {
  const changed = new Set(diff.map((d) => d.field))
  return CHANGE_GROUPS.filter((g) => g.fields.some((f) => changed.has(f))).map((g) => g.label)
}

const UNCHANGED_LABEL_DISPLAY_LIMIT = 4

/** 「変更のない項目」開閉行の要約テキスト（多い場合は先頭のみ＋「ほか」）。 */
export function unchangedGroupSummary(diff: readonly RosterDiffEntry[]): string {
  const changed = new Set(diff.map((d) => d.field))
  const labels = CHANGE_GROUPS.filter((g) => !g.fields.some((f) => changed.has(f))).map(
    (g) => g.label,
  )
  if (labels.length === 0) return ''
  if (labels.length <= UNCHANGED_LABEL_DISPLAY_LIMIT) return labels.join('・')
  return `${labels.slice(0, UNCHANGED_LABEL_DISPLAY_LIMIT).join('・')} ほか`
}

/** 姓名を結合した表示値（`familyName`/`givenName` のどちらかがあれば返す）。 */
export function combinedNameValue(source: RosterLike): string | null {
  const parts = [formatRosterValue('familyName', source), formatRosterValue('givenName', source)]
  const joined = parts.filter((v): v is string => v != null).join(' ')
  return joined.length > 0 ? joined : null
}

/** ふりがなを結合した表示値。 */
export function combinedKanaValue(source: RosterLike): string | null {
  const parts = [formatRosterValue('familyKana', source), formatRosterValue('givenKana', source)]
  const joined = parts.filter((v): v is string => v != null).join(' ')
  return joined.length > 0 ? joined : null
}

export interface DisplayDiffRow {
  label: string
  before: string | null
  after: string | null
}

const NAME_KANA_FIELDS = new Set<RosterField>(['familyName', 'givenName', 'familyKana', 'givenKana'])

/**
 * 「変更あり」タブの展開表示（design-mock 準拠）: 氏名／ふりがなはどちらかの
 * 列が変わっていれば結合1行、それ以外は `diffRoster` が返した粒度のまま
 * 前→後で並べる（例: 郵便番号・住所1・住所2 は個別行のまま）。
 */
export function buildDisplayDiffRows(
  diff: readonly RosterDiffEntry[],
  snapshot: RosterLike,
  current: RosterLike,
): DisplayDiffRow[] {
  const changedFields = new Set(diff.map((d) => d.field))
  const rows: DisplayDiffRow[] = []
  if (changedFields.has('familyName') || changedFields.has('givenName')) {
    rows.push({ label: '氏名', before: combinedNameValue(snapshot), after: combinedNameValue(current) })
  }
  if (changedFields.has('familyKana') || changedFields.has('givenKana')) {
    rows.push({ label: 'ふりがな', before: combinedKanaValue(snapshot), after: combinedKanaValue(current) })
  }
  for (const entry of diff) {
    if (NAME_KANA_FIELDS.has(entry.field)) continue
    rows.push({ label: entry.label, before: entry.before, after: entry.after })
  }
  return rows
}
