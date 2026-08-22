import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  entryGroups,
  events,
  mailMessages,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { db } from '@/lib/db'

/**
 * confirmed-roster-signal: 「確定名簿あり」判定の**正典**。
 *
 * この判定は申込管理ボードの区画分類（`classify`）と申込フロー帯（`buildEntryFlow`）の
 * 両方が入力として受け取る boolean で、以前は3画面（`/admin/entries`・
 * `/admin/entries/[groupId]`・`/events/[id]`）でそれぞれ個別に組まれていた。
 * 判定材料が 2 → 4 に増えたので、条件がずれて再発しないよう1箇所へ寄せる（要件 §6）。
 *
 * ★`classify` / `buildEntryFlow` の内部ロジックは**一切変えない**。変えるのは
 * 「`hasConfirmedRoster` という入力の作り方」だけ。
 *
 * ★出場者解決（`lib/upcoming-entrants.ts`・外部API）はここを使わない **意図した非対称**。
 * あちらは名簿の**中身**（誰が出るか）が要るが、シグナル3/4 は中身を持たないため、
 * 混ぜると出場者が空リストになる。メール連動／手動フラグだけのグループは、ボードでは
 * 「名簿確定・要振込」でもホームでは「希望」表示になる（要件 §3.2.5 / AC-14）。
 */

/** 4つの判定材料。どれか1つでも立てば「確定名簿あり」（要件 §3.2.1）。 */
export interface ConfirmedRosterSignals {
  /** ① パース済み確定名簿（`roster_type='confirmed'` ∧ `superseded_at IS NULL`）。 */
  hasParsedRoster: boolean
  /** ② 採用済み原本ファイル（`roster_type='confirmed'`。版管理は持たない）。 */
  hasAdoptedFile: boolean
  /**
   * ③ 確定名簿メール（`mail_kind='confirmed_roster'` ∧ `triage_status='processed'`）。
   * **添付の有無・採用の有無を問わない**（本文だけの確定連絡を拾うのが導入の動機）。
   */
  hasConfirmedRosterMail: boolean
  /** ④ 手動フラグ（`entry_groups.confirmed_roster_override`）。単独で成立する。 */
  override: boolean
}

/** グループ単位の判定結果。 */
export interface ConfirmedRosterState {
  /** `classify` / `buildEntryFlow` へ渡す `hasConfirmedRoster`。 */
  settled: boolean
  /**
   * `confirmed_roster_override` の**生値**。トグル UI が自分の状態を描くのに要る。
   * ここで返さないと UI 側が4つ目の場当たりクエリを足し、「判定の正典は1つ」という
   * この関数の存在理由が崩れる（要件 §6）。
   */
  override: boolean
}

/** 材料がすべて無いグループの既定値（クエリに1行も出てこなかったグループ）。 */
const NO_SIGNALS: ConfirmedRosterSignals = {
  hasParsedRoster: false,
  hasAdoptedFile: false,
  hasConfirmedRosterMail: false,
  override: false,
}

/** 4材料の OR。純関数（DB に触れない）。 */
export function isConfirmedRosterSettled(signals: ConfirmedRosterSignals): boolean {
  return (
    signals.hasParsedRoster ||
    signals.hasAdoptedFile ||
    signals.hasConfirmedRosterMail ||
    signals.override
  )
}

/**
 * 複数グループの判定を一度に引く（申込管理ボード用）。
 *
 * 返る Map は**渡した groupIds を必ず全て含む**（材料が1つも無いグループも
 * `{ settled: false, override: false }` で入る）ので、呼び出し側で `?? false` の
 * フォールバックを書かなくてよい。
 */
export async function loadConfirmedRosterStates(
  groupIds: readonly number[],
): Promise<Map<number, ConfirmedRosterState>> {
  const ids = [...new Set(groupIds)]
  const result = new Map<number, ConfirmedRosterState>()
  // `inArray` に空配列を渡すと不正な SQL になるので早期リターン（既存 3 箇所の規律）。
  if (ids.length === 0) return result

  const signals = new Map<number, ConfirmedRosterSignals>(
    ids.map((id) => [id, { ...NO_SIGNALS }]),
  )
  const mark = (groupId: number, key: keyof ConfirmedRosterSignals) => {
    const s = signals.get(groupId)
    if (s) s[key] = true
  }

  const [rosterRows, rosterFileRows, mailRows, groupRows] = await Promise.all([
    // ① パース済み確定名簿。差し替え済みの版（superseded_at）は数えない。
    db
      .select({ entryGroupId: tournamentEntryRosters.entryGroupId })
      .from(tournamentEntryRosters)
      .where(
        and(
          inArray(tournamentEntryRosters.entryGroupId, ids),
          eq(tournamentEntryRosters.rosterType, 'confirmed'),
          isNull(tournamentEntryRosters.supersededAt),
        ),
      ),
    // ② 採用済み原本ファイル。applicant は分類に影響させない（confirmed のみ）。
    db
      .select({ entryGroupId: tournamentEntryRosterFiles.entryGroupId })
      .from(tournamentEntryRosterFiles)
      .where(
        and(
          inArray(tournamentEntryRosterFiles.entryGroupId, ids),
          eq(tournamentEntryRosterFiles.rosterType, 'confirmed'),
        ),
      ),
    // ③ 確定名簿メール。帰属は `linked_event_id → events.entry_group_id` の**間接**
    //    （シグナル②が entry_group_id を直接持つのと違う）。イベントが後から別グループへ
    //    移されるとシグナルもイベントに付いて移動するが、どの瞬間を取ってもグループ内の
    //    全日で判定は一致するので AC-8 は保たれる（要件 §6）。
    //    `mail_kind='confirmed_roster'` を書くのは `processMail` だけで、
    //    `triage_status='processed'` は同一トランザクションで立つため併記しても偽陰性にならない。
    db
      .select({ entryGroupId: events.entryGroupId })
      .from(mailMessages)
      .innerJoin(events, eq(events.id, mailMessages.linkedEventId))
      .where(
        and(
          inArray(events.entryGroupId, ids),
          eq(mailMessages.mailKind, 'confirmed_roster'),
          eq(mailMessages.triageStatus, 'processed'),
        ),
      ),
    // ④ 手動フラグ。
    db
      .select({ id: entryGroups.id, override: entryGroups.confirmedRosterOverride })
      .from(entryGroups)
      .where(inArray(entryGroups.id, ids)),
  ])

  for (const r of rosterRows) mark(r.entryGroupId, 'hasParsedRoster')
  for (const r of rosterFileRows) mark(r.entryGroupId, 'hasAdoptedFile')
  for (const r of mailRows) mark(r.entryGroupId, 'hasConfirmedRosterMail')
  for (const r of groupRows) if (r.override) mark(r.id, 'override')

  for (const id of ids) {
    const s = signals.get(id)!
    result.set(id, { settled: isConfirmedRosterSettled(s), override: s.override })
  }
  return result
}

/** 単一グループ版（グループページ・大会詳細用）。 */
export async function loadConfirmedRosterState(
  groupId: number,
): Promise<ConfirmedRosterState> {
  const states = await loadConfirmedRosterStates([groupId])
  return states.get(groupId) ?? { settled: false, override: false }
}
