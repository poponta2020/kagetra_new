import type { EntryFlowInput } from './entry-flow'
import { aggregateGroupCommonFields, type GroupCommonFieldsDay } from './group-common-fields'

/**
 * 申込グループページの申込フロー帯の入力を、日別イベントの配列から集約する
 * 純関数（要件 §3.2.4「申込フロー帯の集約規則」）。
 *
 * `buildEntryFlow`（entry-flow.ts）は既存の日別ロジックのまま**変更しない**。
 * ここはその入力（`EntryFlowInput`）をグループから組み立てるだけの層。
 */

export interface GroupFlowDay extends GroupCommonFieldsDay {
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  paymentType: 'advance' | 'onsite' | null
  paymentStatus: 'unpaid' | 'paid'
}

export function aggregateGroupFlowInput(
  days: readonly GroupFlowDay[],
  todayStr: string,
  hasConfirmedRoster: boolean,
): EntryFlowInput | null {
  // 判定母集団（対象日）= cancelled を除いた日。0件なら呼び出し側がフロー帯自体を
  // 描かない（AC-14）。group-common-fields.ts の「空なら全日へフォールバック」とは
  // 意図的に異なる——要件が「この場合はフロー帯を出さない」と明示しているため。
  const targetDays = days.filter((d) => d.status !== 'cancelled')
  if (targetDays.length === 0) return null

  const eventDate = targetDays.reduce(
    (min, d) => (d.eventDate < min ? d.eventDate : min),
    targetDays[0]!.eventDate,
  )

  // 申込対象日 = 対象日のうち「申し込まない」を除いた日。会として申し込む意思が
  // ある日だけで entryStatus / 支払を集約する。
  const applyingDays = targetDays.filter((d) => d.entryStatus !== 'not_applying')

  const entryStatus: EntryFlowInput['entryStatus'] =
    applyingDays.length === 0
      ? 'not_applying'
      : applyingDays.every((d) => d.entryStatus === 'applied')
        ? 'applied'
        : 'not_applied'

  const paymentType: EntryFlowInput['paymentType'] = applyingDays.some((d) => d.paymentType === 'advance')
    ? 'advance'
    : applyingDays.some((d) => d.paymentType === 'onsite')
      ? 'onsite'
      : null

  const advanceDays = applyingDays.filter((d) => d.paymentType === 'advance')
  // advance の日が0件のときは 'unpaid' に倒す。buildEntryFlow 側で
  // paymentType !== 'advance' が neutral 判定に効くので支払ステップは中立になり、
  // この 'unpaid' 自体は表示に影響しない（AC-11）。
  const paymentStatus: EntryFlowInput['paymentStatus'] =
    advanceDays.length > 0 && advanceDays.every((d) => d.paymentStatus === 'paid') ? 'paid' : 'unpaid'

  const common = aggregateGroupCommonFields(targetDays, todayStr)
  // targetDays は空でないことを既に確認済みなので aggregateGroupCommonFields が
  // null を返すことはない（days.length === 0 のときだけ null を返す関数のため）。
  if (!common) {
    throw new Error('assertion failed: 対象日が非空なのに共通項目集約が null を返しました')
  }

  return {
    internalDeadline: common.internalDeadline.value,
    entryDeadline: common.entryDeadline.value,
    lotteryDate: common.lotteryDate.value,
    paymentDeadline: common.paymentDeadline.value,
    eventDate,
    entryStatus,
    paymentType,
    paymentStatus,
    hasConfirmedRoster,
    todayStr,
  }
}
