/**
 * mail-inbox-mailer (2026-08-02 改修: 統合処理フォーム) タスク2:
 * メール詳細の統合フォームで「対象の大会」候補（申込グループ単位）を
 * 種別（未選択 / 申込名簿 / 確定名簿）で出し分ける純関数群（AC-5, AC-6, AC-7, AC-18）。
 *
 * ★このファイルは `'use client'` のフォームコンポーネントから import される
 * **DB 非依存の leaf** でなければならない。`@kagetra/shared/schema` /
 * `@/lib/*` / `drizzle-orm` などの値 import（型 import も含む）を書くと、
 * client バンドルへ DB 依存が漏れる。これは eslint / vitest / check-types の
 * どれでも検知できず `next build` で初めて壊れる（既知の罠。`roster-adopt-utils.ts`
 * 冒頭のコメント参照）。そのため `Grade` 相当も `roster-adopt-utils.ts` の
 * `RosterAdoptGrade`（既に client-safe）を再利用し、shared からは取らない。
 *
 * `Date.now()` / `new Date()` も読まない（cutoff はサーバーが注入する既存規約。
 * `roster-adopt-utils.ts` / `entry-board-utils.ts` と同じ方針）。
 */

import {
  groupGradeSet,
  listUnifiedCandidates,
  type RosterAdoptExistingFile,
  type RosterAdoptGrade,
  type RosterAdoptGroup,
  type RosterAdoptRosterType,
} from './roster-adopt-utils'

/** 種別。'none' = 未選択（その他）。'tournament_notice'（大会案内）はこの候補リストを使わないので含めない。 */
export type ProcessCandidateKind = 'none' | 'applicant_roster' | 'confirmed_roster'

/**
 * グループ内の 1 日。
 * ★母集団は「status<>'cancelled'」の全日で、開催日 cutoff は掛かっていない
 * （サーバーが「cutoff を満たす日が 1 つ以上あるグループ」だけを渡すことを
 * 保証するので、この純関数は母集団の再チェックをしない）。
 */
export interface ProcessCandidateDay {
  /** YYYY-MM-DD。 */
  eventDate: string
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  eligibleGrades: RosterAdoptGrade[] | null
  kind: 'individual' | 'team'
}

export interface ProcessCandidateGroup {
  groupId: number
  /** サーバーで導出済みの表示名（`loadRosterAdoptableGroups` と同一規約）。 */
  displayName: string
  /** メールの linked_event_id に入れる代表イベント。必ず「cutoff 以降 ∧ 非 cancelled」の日から選ばれている。 */
  representativeEventId: number
  days: ProcessCandidateDay[]
  files: RosterAdoptExistingFile[]
  /** LINE 配信可否。`broadcastMailToEvent` の `loadActiveBinding` と同じ述語。 */
  lineLinked: boolean
}

const ROSTER_TYPE_BY_KIND: Record<'applicant_roster' | 'confirmed_roster', RosterAdoptRosterType> = {
  applicant_roster: 'applicant',
  confirmed_roster: 'confirmed',
}

/**
 * `ProcessCandidateGroup` を `roster-adopt-utils.ts` の既存判定へ渡すための変換。
 *
 * ★`days` を **`kind === 'individual'` の日だけ**に絞る。`roster-adopt-utils` の
 * `groupGradeSet` / `isGroupApplied` は日を kind で絞らないため、団体戦の日の
 * `eligibleGrades` が混ざるとサーバー側 `adoptRosterFile` の級集合（個人戦 ∧
 * 非 cancelled の日の和集合。cutoff は掛けない）とズレて「UI で選べるのに
 * サーバーが弾く級」が生まれる。
 */
export function toRosterAdoptGroup(group: ProcessCandidateGroup): RosterAdoptGroup {
  return {
    groupId: group.groupId,
    displayName: group.displayName,
    days: group.days
      .filter((d) => d.kind === 'individual')
      .map((d) => ({
        eventDate: d.eventDate,
        entryStatus: d.entryStatus,
        eligibleGrades: d.eligibleGrades,
      })),
    files: group.files,
  }
}

/** 級チップ用の薄いラッパ。 */
export function selectableGradesForGroup(group: ProcessCandidateGroup): RosterAdoptGrade[] {
  return groupGradeSet(toRosterAdoptGroup(group))
}

/**
 * 候補行に添える開催日レンジ（同名グループの取り違え防止。既存
 * `RosterFileAdoptSheet.tsx` の `formatGroupDays` と同じ書式）。
 * 非 cancelled の全日を対象にする（呼び出し側が `days` をそのまま渡す）。
 */
export function formatGroupDayRange(days: readonly ProcessCandidateDay[]): string {
  if (days.length === 0) return ''
  const dates = days.map((d) => d.eventDate).sort()
  const first = dates[0]!
  const last = dates[dates.length - 1]!
  return first === last ? first : `${first}〜${last}`
}

/**
 * グループの申込状態ラベル。いずれかの日が applied なら申込済み扱い
 * （`isGroupApplied` と同じ判定を人間向けの語にしたもの）。候補行と選択済み
 * チップの両方で使う。
 */
export function formatGroupEntryStatus(group: ProcessCandidateGroup): string {
  if (group.days.some((d) => d.entryStatus === 'applied')) return '申込済み'
  if (group.days.some((d) => d.entryStatus === 'not_applying')) return '申込なし'
  return '未申込'
}

/**
 * 種別ごとに「対象の大会」候補を絞り込む（AC-5, AC-6, AC-7）。入力の並び順を
 * 保つ（サーバー側で開催日順に並べてある）。
 */
export function listProcessCandidates(
  groups: readonly ProcessCandidateGroup[],
  opts: { kind: ProcessCandidateKind; cutoffStr: string; showAll: boolean },
): ProcessCandidateGroup[] {
  const { kind, cutoffStr, showAll } = opts

  if (kind === 'none') {
    // 未選択には既定フィルタが存在しない（showAll は無関係）。団体戦のみの
    // グループも含めるため kind は問わず、cutoff 以降の日が1つ以上あるかだけ見る。
    return groups.filter((g) => g.days.some((d) => d.eventDate >= cutoffStr))
  }

  // 名簿種別: 「kind === 'individual' ∧ eventDate >= cutoffStr」を**同一の日
  // オブジェクトが同時に満たす**日を1つ以上持つグループに限る。★3条件を
  // 別々の存在判定に分けてはならない（「団体戦だけが cutoff 内で個人戦は
  // 30日より古い」グループが通る穴になる）。
  const gated = groups.filter((g) =>
    g.days.some((d) => d.kind === 'individual' && d.eventDate >= cutoffStr),
  )

  if (showAll) {
    // showAll=true のとき listUnifiedCandidates は全グループを素通しするので、
    // 既定フィルタの絞り込みは不要（gated がそのまま結果）。
    return gated
  }

  const rosterType = ROSTER_TYPE_BY_KIND[kind]
  // 既存の4象限フィルタ（申込済み ∧ 統一ファイル未採用 ∧ 級別ファイルで全級
  // カバー済みでない）をそのまま再利用する。ロジックを写経しない — groupId の
  // 集合だけを取り出し、元の ProcessCandidateGroup を残す。
  const allowedIds = new Set(
    listUnifiedCandidates(gated.map(toRosterAdoptGroup), rosterType, false).map(
      (c) => c.groupId,
    ),
  )
  return gated.filter((g) => allowedIds.has(g.groupId))
}
