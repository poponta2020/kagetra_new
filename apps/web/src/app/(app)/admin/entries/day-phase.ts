import type { EventStatus } from '@kagetra/shared/types'
import { AREAS, classify, type AreaId, type EntryBoardItem } from './entry-board-utils'

/**
 * グループページの日程表（design-spec §3.3-1「案C: 進行フェーズ1語」）が行に出す
 * 進行フェーズの1語判定。申込管理ボードと**同じ語彙**にする（design-spec §8 の
 * 忠実度チェックリストが「この画面だけの造語を作らない」ことを要求している）。
 *
 * `entry-board-utils.ts` の兄弟モジュールとして `app/(app)/admin/entries/` 直下に
 * 置く（`lib/` から app ディレクトリを import しないため）。`entry-board-utils.ts`
 * は client バンドル安全（DB 依存を持たない）モジュールなので、ここから import
 * しても group-common-fields.ts と同種の DB 依存漏れは起きない。
 */

export interface DayPhaseDay extends EntryBoardItem {
  /** `events.status`。`'cancelled'` の日は classify にかけず「中止」固定。 */
  status: EventStatus
}

/**
 * フェーズ語の色づけ（design-mock `_grp.css` の `.opt-c .ph` 4種と1対1）:
 * - `action` … 朱＋太字（`.ph.act`）。**要対応フェーズ**＝`AREAS.actionable`。
 *   忠実度チェックリスト「朱を使うのは 期限超過・要対応フェーズ・共通項目の
 *   食い違いの3つだけ」の2つ目がこれ
 * - `done` … 藍（`.ph.done`）。完了
 * - `wait` … 中立色（`.ph.wait`）。締切前・抽選待ち
 * - `na` … 砂（`.ph.na`）。申込なし・中止（判定対象外）
 */
export type DayPhaseTone = 'action' | 'done' | 'wait' | 'na'

export interface DayPhase {
  label: string
  tone: DayPhaseTone
}

export const NO_APPLICANTS_PHASE_LABEL = '申込なし'
export const CANCELLED_PHASE_LABEL = '中止'

/**
 * `AREAS`（entry-board-utils.ts）から定義を引く。`no_applicants` を除く
 * {@link AreaId} は必ず {@link AREAS} に載っている契約なので、見つからなければ
 * 呼び出し側のバグ（`AREAS` の定義漏れ等）として fail-fast にする
 * （既存 `pickGroupArea` と同じ流儀）。
 */
function areaDefOf(area: Exclude<AreaId, 'no_applicants'>) {
  const def = AREAS.find((a) => a.id === area)
  if (!def) {
    throw new Error(`assertion failed: AREAS に見つからない area です: ${area}`)
  }
  return def
}

/**
 * `AREAS` の `label` から短縮ラベルを機械的に導出する。ハードコードのマップを
 * 作らないのは、`AREAS` の label を改称したときにこのモジュールの語彙が自動で
 * ずれる（＝テストが落ちて気付ける）ようにするため。
 * 例: '申込完了・抽選待ち' → '抽選待ち'（'・' 区切りの最後の要素）。
 */
function shortLabelOf(area: Exclude<AreaId, 'no_applicants'>): string {
  return areaDefOf(area).label.split('・').at(-1)!
}

export function dayPhase(day: DayPhaseDay, todayStr: string): DayPhase {
  if (day.status === 'cancelled') {
    return { label: CANCELLED_PHASE_LABEL, tone: 'na' }
  }

  const area = classify(day, todayStr)
  if (area === 'no_applicants') {
    return { label: NO_APPLICANTS_PHASE_LABEL, tone: 'na' }
  }

  // 色も語彙と同じく `AREAS` から導出する（この画面だけの分岐表を持たない）。
  const def = areaDefOf(area)
  const tone: DayPhaseTone = def.actionable ? 'action' : area === 'done' ? 'done' : 'wait'
  return { label: shortLabelOf(area), tone }
}
